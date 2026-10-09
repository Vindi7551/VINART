import type {
  ChatMessage,
  ChatChunk,
  Attachment,
  TokenUsage,
  ToolDef,
  ToolCallDelta,
} from '../gateway/type/chat';
import type { ChatGateway } from '../gateway/index';
import type { ChatContext } from '../context/index';
import { foldToolCallDeltas } from '../gateway/util/toolcalls';
import { buildUserMessage } from '../context/chat-context';
import type { AgentTool } from '../subagent/types';
import type { ChatSession, SessionUsage } from './types';

interface SessionConfig {
  /** Agent 的 system prompt，会话创建时确定，reset 后保留 */
  systemPrompt: string;
  /** 注入的 Gateway 实例（依赖反转） */
  gateway: ChatGateway;
  /** 上下文管理器（依赖反转） */
  context: ChatContext;
  /**
   * 主 AI 的工具表（可选）。给了 → send() 走工具循环（模型控制多轮）；
   * 不给 → 单轮流式（与旧行为完全一致）。
   * 工具接口与子 agent 同一套（AgentTool）——循环壳不共用，能力件共用。
   */
  tools?: AgentTool[];
  /** 采样温度，默认 1.0 */
  temperature?: number;
  /** 最大输出 token 数，默认 32768 */
  maxTokens?: number;
  /** 指定会话 id(持久化键;缺省自动生成) */
  id?: string;
}

/** 工具循环轮数上限：到达后最后一轮不再下发 tools，强制模型文本收尾 */
const MAX_TOOL_ROUNDS = 6;

/**
 * 审计摘录：压平空白 + 超长截断。
 * 转录事件只存摘要不存全量——read_spec 之类返回整个 spec 的结果会把
 * JSONL 账本撑到难看，而审计需要的是「调了什么、成没成、多久」。
 */
function clip(s: string | undefined, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/**
 * 创建 ChatSession 实例。
 *
 * Session 只管对话生命周期：维护历史、调用 context 组装请求、调用 gateway、中止控制。
 * 有工具表时，单轮流式升级为工具循环：流 → tool_calls → 执行 → 回喂 → 续流，
 * 中间轮的正文照常流式透传（前端能看到主 AI「说要做什么」再看到执行后的总结）。
 *
 * ⚠️ 中间轮（assistant(tool_calls) + tool 结果）只活在本次请求的 requestMessages 里，
 * **不进持久历史**——工具参数/结果的大 JSON 会烧上下文，事后审计走账本事件
 * （agent-spawn / agent-result）与子 transcript，对话重放只需要最终文本。
 */
export function createChatSession(config: SessionConfig): ChatSession {
  const { systemPrompt, gateway, context, tools = [], temperature = 1.0, maxTokens = 32768, id: fixedId } = config;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  const toolDefs: ToolDef[] = tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const usage: SessionUsage = { promptTokens: 0, completionTokens: 0 };
  let aborted = false;
  let streaming = false;
  /** 当前 send 的取消控制器——abort() 同时停模型流与长工具（如 spawn 批次） */
  let activeController: AbortController | null = null;

  return {
    id: fixedId ?? crypto.randomUUID(),

    get messages() {
      return [...messages];
    },

    get isStreaming() {
      return streaming;
    },

    get usage() {
      return { ...usage };
    },

    async *send(
      userMessage: string,
      attachments?: Attachment[],
      opts?: {
        systemNote?: string;
        /** 进度事件回调：工具执行中的中间状态（如子 agent spawn/result）实时上抛 */
        onEvent?: (evt: Record<string, unknown>) => void;
      },
    ) {
      // ── 并发防护 ──
      if (streaming) {
        throw new Error('Another send() is already in progress. Call abort() first.');
      }

      streaming = true;
      aborted = false;
      const controller = new AbortController();
      activeController = controller;

      try {
        // 1. context 组装请求消息
        const build = await context.build(messages, userMessage, attachments);

        if (build.compacted) {
          console.warn(
            `[session] Context compacted: ${build.compactedCount} messages → summary, ` +
            `~${build.estimatedTokens} tokens`,
          );
        }
        if (build.truncated) {
          console.warn(
            `[session] Context trimmed: ${build.truncatedCount} messages dropped, ` +
            `~${build.estimatedTokens} tokens remaining`,
          );
        }

        // 2. 追加用户消息到历史。带附件时存 content parts（与发给模型的形状一致）——
        //    否则下一轮起模型就看不到之前贴的图（附件只活在 build 的本轮请求里）。
        //    组装函数与 context.build 同源（buildUserMessage），防止两处漂移。
        messages.push(buildUserMessage(userMessage, attachments));

        // 2.5 动态上下文注入:附加 system 消息(system 主提示之后、user 之前)。
        // 只进本轮请求,不进持久历史——每轮按最新状态重算(如当前打开的版式)
        const requestMessages = [...build.messages];
        if (opts?.systemNote) {
          const sysIdx = requestMessages.findIndex((m) => m.role === 'system');
          requestMessages.splice(sysIdx + 1, 0, { role: 'system', content: opts.systemNote });
        }

        // 3. 工具循环：单轮流式 → 有 tool_calls 就执行回喂再续一轮
        let fullContent = '';
        let totalPrompt = 0;
        let totalCompletion = 0;

        for (let round = 0; ; round++) {
          let roundContent = '';
          const deltas: ToolCallDelta[] = [];
          let roundUsage: TokenUsage | null = null;

          // 到达轮数上限的最后一轮不下发 tools——模型只能文本收尾
          const withTools = tools.length > 0 && round < MAX_TOOL_ROUNDS;
          for await (const chunk of gateway.stream(requestMessages, {
            temperature,
            maxTokens,
            ...(withTools ? { tools: toolDefs } : {}),
          })) {
            // ── 中止检查 ──
            if (aborted || controller.signal.aborted) break;

            roundContent += chunk.content;
            if (chunk.toolCallDeltas?.length) deltas.push(...chunk.toolCallDeltas);
            if (chunk.usage) {
              roundUsage = chunk.usage;
            } else {
              yield chunk; // 中间正文照常流式透传（usage chunk 是记账用的，不透传）
            }
          }

          fullContent += roundContent;
          if (roundUsage) {
            totalPrompt += roundUsage.promptTokens;
            totalCompletion += roundUsage.completionTokens;
          }

          if (aborted || controller.signal.aborted) break;

          const calls = foldToolCallDeltas(deltas);
          if (calls.length === 0) break; // 自然收尾：纯文本回复

          // assistant 消息回喂：正文与 tool_calls 同条消息共存（协议要求），丢正文破坏协议
          requestMessages.push({
            role: 'assistant',
            content: roundContent || null,
            tool_calls: calls,
          });

          // 逐个执行工具（顺序；未知工具 / 参数损坏 / 异常一律 ERROR 回喂，fail-loud）
          for (const call of calls) {
            if (controller.signal.aborted) break;

            const tool = tools.find((t) => t.name === call.function.name);
            const t0 = Date.now();
            let resultContent: string;
            if (!tool) {
              resultContent = `ERROR: 未知工具 "${call.function.name}"。可用工具：${tools.map((t) => t.name).join(', ')}`;
            } else {
              try {
                const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
                // 主 AI 的工具自管路径（如 spawn 内部取 workDir），dir 仅满足接口形状；
                // onEvent 把工具的进度事件上抛给 send 的调用方（SSE → 前端卡片）
                const result = await tool.execute(args, {
                  dir: process.cwd(),
                  signal: controller.signal,
                  onEvent: opts?.onEvent,
                });
                resultContent = (result.isError ? 'ERROR: ' : '') + result.content;
              } catch (e) {
                resultContent = `ERROR: 工具调用失败：${e instanceof Error ? e.message : String(e)}`;
              }
            }
            // 中间轮记账：上抛给调用方落转录 + SSE 实时推——否则刷新会话后
            // 「AI 调过工具」这件事完全蒸发（委派有 agent-spawn/result 账本兜底，
            // render/generate/edit 此前没有）。中间轮照旧不进模型上下文
            // （大 JSON 烧 token），这里只是审计摘要。
            opts?.onEvent?.({
              kind: 'tool-call',
              name: call.function.name,
              args: clip(call.function.arguments, 400),
              ok: !resultContent.startsWith('ERROR: '),
              ms: Date.now() - t0,
              result: clip(resultContent, 600),
            });
            requestMessages.push({ role: 'tool', tool_call_id: call.id, content: resultContent });
          }
          if (controller.signal.aborted) break;
        }

        // 4. 收集 token 用量（多轮累加）
        if (totalPrompt || totalCompletion) {
          usage.promptTokens += totalPrompt;
          usage.completionTokens += totalCompletion;
          context.updateUsage(totalPrompt);
        }

        // 被中止时 yield 一个标记，通知调用方（沿用既有协议：finishReason 'error'）
        if (aborted || controller.signal.aborted) {
          const abortChunk: ChatChunk = {
            content: fullContent,
            finishReason: 'error',
          };
          yield abortChunk;
        }

        // 5. 追加 assistant 回复到历史（即使被中止，也保留已生成的部分；
        //    中间工具轮不进历史——见文件头说明）
        if (fullContent) {
          messages.push({ role: 'assistant', content: fullContent });
        } else if (!aborted) {
          // 模型完全没生成内容且不是被打断 → 回滚 user 消息
          messages.pop();
        }
      } catch (err) {
        // 流异常 → 回滚已追加的 user 消息
        if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
          messages.pop();
        }
        throw err;
      } finally {
        streaming = false;
        aborted = false;
        activeController = null;
      }
    },

    abort() {
      if (streaming) {
        aborted = true;
        // 同时掐掉长工具（spawn 批次）——signal 一路透传到 runAgentBatch
        activeController?.abort();
      }
    },

    /** 灌回历史(服务重启/切会话后从转录恢复;传不含 system 的对话消息) */
    restore(next: ChatMessage[]) {
      if (streaming) {
        throw new Error('Cannot restore while streaming.');
      }
      messages.length = 0;
      messages.push({ role: 'system', content: systemPrompt });
      for (const m of next) {
        if (m.role !== 'system') messages.push(m);
      }
    },

    reset() {
      messages.length = 0;
      messages.push({ role: 'system', content: systemPrompt });
      usage.promptTokens = 0;
      usage.completionTokens = 0;
      streaming = false;
      aborted = false;
    },

    removeLastExchange() {
      // 从后往前删掉最近的一对 user + assistant
      if (messages.length >= 2) {
        const last = messages[messages.length - 1];
        const secondLast = messages[messages.length - 2];
        if (last.role === 'assistant' && secondLast.role === 'user') {
          messages.splice(messages.length - 2, 2);
        }
      }
    },
  };
}
