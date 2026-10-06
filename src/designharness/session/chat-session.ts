import type { ChatMessage, Attachment, ChatChunk, TokenUsage } from '../gateway/type/chat';
import type { ChatGateway } from '../gateway/index';
import type { ChatContext } from '../context/index';
import type { ChatSession, SessionUsage } from './types';

interface SessionConfig {
  /** Agent 的 system prompt，会话创建时确定，reset 后保留 */
  systemPrompt: string;
  /** 注入的 Gateway 实例（依赖反转） */
  gateway: ChatGateway;
  /** 上下文管理器（依赖反转） */
  context: ChatContext;
  /** 采样温度，默认 1.0 */
  temperature?: number;
  /** 最大输出 token 数，默认 32768 */
  maxTokens?: number;
  /** 指定会话 id(持久化键;缺省自动生成) */
  id?: string;
}

/**
 * 创建 ChatSession 实例。
 *
 * Session 只管对话生命周期：维护历史、调用 context 组装请求、调用 gateway、中止控制。
 */
export function createChatSession(config: SessionConfig): ChatSession {
  const { systemPrompt, gateway, context, temperature = 1.0, maxTokens = 32768, id: fixedId } = config;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  const usage: SessionUsage = { promptTokens: 0, completionTokens: 0 };
  let aborted = false;
  let streaming = false;

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
      opts?: { systemNote?: string },
    ) {
      // ── 并发防护 ──
      if (streaming) {
        throw new Error('Another send() is already in progress. Call abort() first.');
      }

      streaming = true;
      aborted = false;

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

        // 2. 追加用户消息到历史
        messages.push({ role: 'user', content: userMessage });

        // 2.5 动态上下文注入:附加 system 消息(system 主提示之后、user 之前)。
        // 只进本轮请求,不进持久历史——每轮按最新状态重算(如当前打开的版式)
        const requestMessages = [...build.messages];
        if (opts?.systemNote) {
          const sysIdx = requestMessages.findIndex((m) => m.role === 'system');
          requestMessages.splice(sysIdx + 1, 0, { role: 'system', content: opts.systemNote });
        }

        // 3. 调用 Gateway
        let fullContent = '';
        let lastUsage: TokenUsage | null = null;

        for await (const chunk of gateway.stream(requestMessages, { temperature, maxTokens })) {
          // ── 中止检查 ──
          if (aborted) break;

          fullContent += chunk.content;

          if (chunk.usage) {
            lastUsage = chunk.usage;
          } else {
            yield chunk;
          }
        }

        // 被中止时 yield 一个标记，通知调用方
        if (aborted) {
          const abortChunk: ChatChunk = {
            content: fullContent,
            finishReason: 'error',
          };
          yield abortChunk;
        }

        // 4. 收集 token 用量
        if (lastUsage) {
          usage.promptTokens += lastUsage.promptTokens;
          usage.completionTokens += lastUsage.completionTokens;
          context.updateUsage(lastUsage.promptTokens);
        }

        // 5. 追加 assistant 回复到历史（即使被中止，也保留已生成的部分）
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
      }
    },

    abort() {
      if (streaming) {
        aborted = true;
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
