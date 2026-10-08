/**
 * 子 agent 循环引擎 —— 模型 ↔ 工具的驱动器（harness 层，协议中立）。
 *
 * 职责只做一件事：初始化 messages，然后反复
 *   【一次模型请求 → 折叠 tool_calls → 执行工具 → role:'tool' 回喂】
 * 直到 finish 收工 / 自然收尾 / 触及某个上限（maxTurns / max_tokens / abort）。
 *
 * 关键决策：
 * - stream 依赖注入（AgentStream）：引擎不 import src/config——测试可注入
 *   脚本化假流；业务侧直接传 gateway.stream（形状兼容）
 * - finish 是内置工具：调用即收工。参数损坏 / 产物缺失 → 回喂 ERROR 让模型
 *   下一轮自纠（fail-loud + 自纠，maxTurns 兜底），而不是静默吞掉
 * - assistant 消息回喂时保留正文：实测 content 与 tool_calls 同条消息共存，
 *   丢正文破坏协议
 * - finishReason === 'length' 的输出不可信（arguments 可能只剩半截 JSON），
 *   不执行残缺调用，直接终局 max-tokens
 * - abort 检查在轮间与 chunk 间。网关 fetch 尚未接 signal，中断延迟 ≤ 一次
 *   模型调用（已知局限；网关接入 signal 后自动消除）
 * - 子 transcript JSONL（logPath 可选）：spawn / model / tool / result 四种
 *   事件，正文截 200 字符——给人回看用，不当数据源
 *
 * 缓存约定见 types.ts：前缀 [system, ...seed] 由宿主保证字节级稳定，
 * 引擎只 append，绝不重写历史消息。
 */

import { appendFileSync, existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type {
  ChatChunk,
  ChatMessage,
  ToolCall,
  ToolCallDelta,
  ToolDef,
  ToolResultMessage,
} from '../gateway/type/chat';
import { foldToolCallDeltas } from '../gateway/util/toolcalls';
import type {
  AgentOutcome,
  AgentSpawnRequest,
  AgentStopReason,
  AgentTool,
  AgentToolContext,
  AgentUsage,
} from './types';

/** 依赖注入的流式对话函数。ChatGateway 的 stream 方法天然满足此形状 */
export type AgentStream = (
  messages: ChatMessage[],
  opts?: { temperature?: number; tools?: ToolDef[] },
) => AsyncIterable<ChatChunk>;

export interface AgentLoopOptions {
  stream: AgentStream;
  /** 子 agent 的工作目录——工具读写的根 */
  dir: string;
  /** 子 transcript JSONL 落盘路径；不传则不落盘 */
  logPath?: string;
  /** 批次取消信号 */
  signal?: AbortSignal;
}

// ── 内置 finish 工具 ──

/**
 * 收工工具。execute 永不被调用（循环在执行阶段特判 finish），
 * 提供占位实现只为满足 AgentTool 形状。
 */
const FINISH_TOOL: AgentTool = {
  name: 'finish',
  description:
    '收工：任务已全部完成时调用。summary 用一两句话说明做了什么、结果如何；' +
    'artifacts 列出产出的文件路径（相对工作目录，没有文件产物则省略该参数）。',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '一两句话说明本次任务做了什么、结果如何' },
      artifacts: {
        type: 'array',
        items: { type: 'string' },
        description: '产出的文件路径列表（相对工作目录）。没有文件产物时省略',
      },
    },
    required: ['summary'],
  },
  async execute() {
    throw new Error('finish 由循环引擎特判处理，不会走到 execute');
  },
};

type FinishVerdict =
  | { ok: true; summary: string; artifacts: string[] }
  | { ok: false; error: string };

/**
 * 校验 finish 的参数：summary 必须非空；artifacts 必须是真实存在的文件，
 * 且位于工作目录内（防路径逃逸——产物只能声明在自己世界里）。
 */
function checkFinish(call: ToolCall, dir: string): FinishVerdict {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `finish 的 arguments 不是合法 JSON（${msg}）。请重新调用 finish` };
  }

  const summary = args.summary;
  if (typeof summary !== 'string' || summary.trim() === '') {
    return { ok: false, error: 'finish 缺少非空字符串参数 summary。请重新调用 finish' };
  }

  const raw = args.artifacts;
  if (raw === undefined) return { ok: true, summary: summary.trim(), artifacts: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'artifacts 必须是字符串数组。请重新调用 finish' };
  }

  const artifacts: string[] = [];
  for (const p of raw) {
    if (typeof p !== 'string' || p.trim() === '') {
      return { ok: false, error: 'artifacts 必须是非空字符串数组。请重新调用 finish' };
    }
    const abs = resolve(dir, p);
    const rel = relative(resolve(dir), abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return { ok: false, error: `产物路径越出了工作目录：${p}。artifacts 只能指向工作目录内的文件` };
    }
    if (!existsSync(abs)) {
      return {
        ok: false,
        error: `产物文件不存在：${p}。先确认文件已经写出，再重新 finish；` +
          '若该文件确实不该存在，请把它从 artifacts 里去掉',
      };
    }
    artifacts.push(p);
  }
  return { ok: true, summary: summary.trim(), artifacts };
}

// ── 子 transcript 日志 ──

type AgentLogEvent =
  | { kind: 'spawn'; runId: string; label: string; tools: string[]; maxTurns: number; temperature: number }
  | {
      kind: 'model';
      turn: number;
      finishReason?: string;
      textPreview: string;
      toolCalls: { id: string; name: string }[];
      usage?: { promptTokens: number; completionTokens: number };
    }
  | { kind: 'tool'; turn: number; name: string; isError: boolean; contentPreview: string; durationMs: number }
  | { kind: 'result'; stopReason: string; summary?: string; artifacts: string[]; diagnostic?: string };

function appendLog(logPath: string | undefined, evt: AgentLogEvent): void {
  if (!logPath) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), ...evt });
  try {
    appendFileSync(logPath, line + '\n');
  } catch {
    // 日志失败不干扰主流程
  }
}

function preview(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ── 主循环 ──

export async function runAgentLoop(req: AgentSpawnRequest, opts: AgentLoopOptions): Promise<AgentOutcome> {
  const maxTurns = req.maxTurns ?? 12;
  const temperature = req.temperature ?? 0.3;
  const signal = opts.signal ?? new AbortController().signal;
  const ctx: AgentToolContext = { dir: opts.dir, signal };

  const tools: AgentTool[] = [...req.tools, FINISH_TOOL];
  const toolDefs: ToolDef[] = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const byName = new Map(tools.map((t) => [t.name, t]));

  // 前缀 = [system, ...seed]；brief 是差异的起点（见 types.ts 缓存约定）
  const messages: ChatMessage[] = [
    { role: 'system', content: req.system },
    ...req.seed,
    { role: 'user', content: req.brief },
  ];

  const usage: AgentUsage = { llmCalls: 0, promptTokens: 0, completionTokens: 0 };

  // 统一出口：组装 outcome 并落 result 事件
  const done = (
    stopReason: AgentStopReason,
    extra: { summary?: string; artifacts?: string[]; diagnostic?: string },
  ): AgentOutcome => {
    const outcome: AgentOutcome = {
      runId: req.runId,
      label: req.label,
      stopReason,
      summary: extra.summary,
      artifacts: extra.artifacts ?? [],
      diagnostic: extra.diagnostic,
      usage,
    };
    appendLog(opts.logPath, {
      kind: 'result',
      stopReason,
      summary: outcome.summary,
      artifacts: outcome.artifacts,
      diagnostic: outcome.diagnostic,
    });
    return outcome;
  };

  appendLog(opts.logPath, {
    kind: 'spawn',
    runId: req.runId,
    label: req.label,
    tools: tools.map((t) => t.name),
    maxTurns,
    temperature,
  });

  for (let turn = 1; turn <= maxTurns; turn++) {
    if (signal.aborted) {
      return done('aborted', { diagnostic: `批次取消于第 ${turn} 轮开始前` });
    }

    // ── 一次模型请求 ──
    usage.llmCalls++;
    let text = '';
    const deltas: ToolCallDelta[] = [];
    let finishReason: ChatChunk['finishReason'];
    let lastUsage: { promptTokens: number; completionTokens: number } | undefined;

    try {
      // ⚠️ tools 必须随请求下发：不带这个字段模型收不到工具表，
      // 会把内部调用格式（DSML 伪调用）写进正文——首轮探针实测踩中
      for await (const chunk of opts.stream(messages, { temperature, tools: toolDefs })) {
        if (signal.aborted) break;
        if (chunk.content) text += chunk.content;
        if (chunk.toolCallDeltas?.length) deltas.push(...chunk.toolCallDeltas);
        if (chunk.finishReason) finishReason = chunk.finishReason;
        if (chunk.usage) lastUsage = chunk.usage;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return done('failed', { diagnostic: `第 ${turn} 轮模型请求失败：${msg}` });
    }
    if (signal.aborted) {
      return done('aborted', { diagnostic: `批次取消于第 ${turn} 轮模型响应中途` });
    }
    if (lastUsage) {
      usage.promptTokens += lastUsage.promptTokens;
      usage.completionTokens += lastUsage.completionTokens;
    }

    const toolCalls = foldToolCallDeltas(deltas);
    appendLog(opts.logPath, {
      kind: 'model',
      turn,
      finishReason,
      textPreview: preview(text),
      toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.function.name })),
      usage: lastUsage,
    });

    // assistant 消息回喂：正文与 tool_calls 同条消息共存（探针实测），丢正文破坏协议
    messages.push({
      role: 'assistant',
      content: text || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });

    // 截断的输出不可信：arguments 可能只剩半截 JSON，不执行残缺调用
    if (finishReason === 'length') {
      return done('max-tokens', { diagnostic: `第 ${turn} 轮输出被 max_tokens 截断` });
    }

    // 自然收尾：无工具调用的纯文本回复也算 completed
    if (toolCalls.length === 0) {
      return done('completed', { summary: text.trim() || undefined });
    }

    // ── 逐个执行工具（顺序执行；finish 特判收工）──
    const results: ToolResultMessage[] = [];
    for (const call of toolCalls) {
      if (signal.aborted) {
        return done('aborted', { diagnostic: `批次取消于第 ${turn} 轮工具执行中` });
      }

      // 内置 finish：不走 execute，校验通过即收工
      if (call.function.name === 'finish') {
        const verdict = checkFinish(call, opts.dir);
        if (!verdict.ok) {
          results.push({ role: 'tool', tool_call_id: call.id, content: `ERROR: ${verdict.error}` });
          appendLog(opts.logPath, {
            kind: 'tool', turn, name: 'finish', isError: true,
            contentPreview: preview(verdict.error), durationMs: 0,
          });
          continue; // 模型下一轮自纠后重新 finish
        }
        appendLog(opts.logPath, {
          kind: 'tool', turn, name: 'finish', isError: false,
          contentPreview: preview(verdict.summary), durationMs: 0,
        });
        return done('completed', { summary: verdict.summary, artifacts: verdict.artifacts });
      }

      const tool = byName.get(call.function.name);
      if (!tool) {
        const content = `ERROR: 未知工具 "${call.function.name}"。可用工具：${tools.map((t) => t.name).join(', ')}`;
        results.push({ role: 'tool', tool_call_id: call.id, content });
        appendLog(opts.logPath, {
          kind: 'tool', turn, name: call.function.name, isError: true,
          contentPreview: preview(content), durationMs: 0,
        });
        continue;
      }

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const content = `ERROR: arguments 不是合法 JSON（${msg}）。请重新调用，参数必须是完整的 JSON 对象`;
        results.push({ role: 'tool', tool_call_id: call.id, content });
        appendLog(opts.logPath, {
          kind: 'tool', turn, name: tool.name, isError: true,
          contentPreview: preview(content), durationMs: 0,
        });
        continue;
      }

      const t0 = Date.now();
      try {
        const result = await tool.execute(args, ctx);
        const content = (result.isError ? 'ERROR: ' : '') + result.content;
        results.push({ role: 'tool', tool_call_id: call.id, content });
        appendLog(opts.logPath, {
          kind: 'tool', turn, name: tool.name, isError: result.isError ?? false,
          contentPreview: preview(result.content), durationMs: Date.now() - t0,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const content = `ERROR: 工具执行异常：${msg}`;
        results.push({ role: 'tool', tool_call_id: call.id, content });
        appendLog(opts.logPath, {
          kind: 'tool', turn, name: tool.name, isError: true,
          contentPreview: preview(content), durationMs: Date.now() - t0,
        });
      }
    }

    messages.push(...results);
  }

  return done('max-turns', { diagnostic: `${maxTurns} 轮用尽仍未收工（模型始终未成功调用 finish）` });
}
