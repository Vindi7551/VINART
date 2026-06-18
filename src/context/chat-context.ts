import type { ChatMessage, Attachment } from '../gateway/type/chat';
import type { ChatContextConfig, BuildResult, TruncationStrategy } from './types';

/**
 * 对话上下文管理器。
 *
 * 策略链（按顺序执行）：
 * 1. Compaction — 超阈值时用模型压缩旧消息为摘要
 * 2. Trim       — 仍超预算时丢弃最旧的消息
 *
 * Session 应在每次 stream 结束后调用 updateUsage() 喂入真实 token 数，
 * 供下次 build() 做精确的压缩触发判断。
 */
export interface ChatContext {
  /** 组装请求消息（异步——compaction 需要调模型） */
  build(history: ChatMessage[], userMessage: string, attachments?: Attachment[]): Promise<BuildResult>;
  /** 估算一段消息的 token 数 */
  estimateTokens(messages: ChatMessage[]): number;
  /** 喂入上次请求的真实 prompt token 数（来自 stream 末尾的 usage chunk） */
  updateUsage(promptTokens: number): void;
}

export function createChatContext(config: ChatContextConfig = {}): ChatContext {
  const {
    maxInputTokens = 90_000,
    truncation = 'oldest-first',
    keepLastN = 10,
    compaction,
  } = config;

  // 精确 token 数（来自 API usage），初始为 0 表示用估算
  let lastRealPromptTokens = 0;

  return {
    estimateTokens,

    updateUsage(promptTokens: number) {
      lastRealPromptTokens = promptTokens;
    },

    async build(history: ChatMessage[], userMessage: string, attachments?: Attachment[]) {
      // 1. 组装用户消息
      const userMsg = buildUserMessage(userMessage, attachments);

      // 2. 拼完整列表
      let messages = [...history, userMsg];
      let estimatedTokens = estimateTokens(messages);

      // 3. 触发决策：优先用真实 token 数，没有则用估算
      const effectiveTokens = lastRealPromptTokens > 0 ? lastRealPromptTokens : estimatedTokens;
      let compacted = false;
      let compactedCount = 0;
      let truncated = false;
      let truncatedCount = 0;

      // ── 策略 1: Compaction ──
      if (compaction?.enabled && compaction.compact) {
        const trigger = compaction.trigger ?? 0.85;
        if (effectiveTokens > maxInputTokens * trigger) {
          const result = await compactMessages(
            messages, userMsg, compaction.compact,
            compaction.keepRecentRounds ?? 5,
          );
          if (result.compacted > 0) {
            messages = result.messages;
            compactedCount = result.compacted;
            compacted = true;
            estimatedTokens = estimateTokens(messages);
          }
        }
      }

      // ── 策略 2: Trim ──
      if (estimatedTokens > maxInputTokens) {
        const result = truncate(messages, history, userMsg, maxInputTokens, truncation, keepLastN);
        messages = result.messages;
        truncatedCount = result.dropped;
        truncated = true;
        estimatedTokens = estimateTokens(messages);
      }

      return {
        messages,
        estimatedTokens,
        truncated,
        truncatedCount,
        compacted,
        compactedCount,
      };
    },
  };
}

// ── Token 估算 ──

/**
 * 简易 token 估算（基于 DeepSeek Llama-family tokenizer 的启发式）。
 *
 * 算法：
 *   content token ≈ charCount / 3（中英混合平均）
 *   每消息 overhead ≈ 8 token
 *   （DeepSeek chat_template: 〈User〉〈Assistant〉〈_of_sentence〉等特殊标记）
 *
 * 这是保守近似——实际 token 数通常略低于此值。
 * 精确 token 数通过 DeepSeek stream 末尾的 usage.prompt_tokens 获取，
 * session 在每次 send() 后调用 context.updateUsage() 喂入精确值，
 * 后续决策用精确值而非此估算。
 */
export function estimateTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    // content token：字符数 ÷ 3
    total += Math.ceil(text.length / 3);
  }
  // 每消息 overhead：〈User〉/〈Assistant〉/begin/end of sentence 等特殊 token
  total += messages.length * 8;
  return total;
}

// ── 策略 1: Compaction ──

/**
 * 压缩旧消息：保留最近 N 轮原文，更早的消息交给 compactFn 生成摘要。
 * 返回压缩后的消息列表和压缩数量。
 */
async function compactMessages(
  messages: ChatMessage[],
  userMsg: ChatMessage,
  compactFn: (old: ChatMessage[]) => Promise<string>,
  keepRecentRounds: number,
): Promise<{ messages: ChatMessage[]; compacted: number }> {
  // 分离：system + 最近 N 轮 + 当前用户消息
  const systemMsg = messages.find((m) => m.role === 'system');

  // 排除 system 和当前用户消息，按 role 过滤而非引用相等
  const history = messages.filter((m) => m.role !== 'system' && m !== userMsg);

  // 从后往前取最近 N 轮（一轮 = 一次用户提问 + AI 回复）
  const recent: ChatMessage[] = [];
  let roundCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    recent.unshift(history[i]);
    if (history[i].role === 'user') roundCount++;
    if (roundCount >= keepRecentRounds) break;
  }

  // 剩下的就是旧消息
  const old = history.slice(0, history.length - recent.length);
  if (old.length === 0) {
    return { messages, compacted: 0 };
  }

  // 压缩旧消息 → 摘要
  const summary = await compactFn(old);

  // 重组：system + 摘要（作为 system 消息）+ 最近 N 轮 + 当前用户消息
  const result: ChatMessage[] = [];
  if (systemMsg) result.push(systemMsg);
  result.push({
    role: 'system',
    content: `[对话历史摘要]\n${summary}`,
  });
  result.push(...recent);
  result.push(userMsg);

  return { messages: result, compacted: old.length };
}

// ── 策略 2: Trim ──

function truncate(
  messages: ChatMessage[],
  history: ChatMessage[],
  userMsg: ChatMessage,
  maxTokens: number,
  strategy: TruncationStrategy,
  keepLastN: number,
): { messages: ChatMessage[]; dropped: number } {
  if (strategy === 'keep-last-n') {
    return truncateByLastN(history, userMsg, keepLastN);
  }
  return truncateOldestFirst(messages, maxTokens);
}

function truncateOldestFirst(messages: ChatMessage[], maxTokens: number) {
  const result = [...messages];
  let dropped = 0;

  while (estimateTokens(result) > maxTokens && result.length > 2) {
    const removeIndex = 1;
    // 如果是 user 消息 → 连它后面的整个自主工作链一起删
    // （tool_call + tool_result + assistant 思考），
    // 直到碰到下一个 user 消息或消息列表结束
    if (result[removeIndex].role === 'user') {
      result.splice(removeIndex, 1);
      dropped++;
      while (result.length > removeIndex && result[removeIndex].role !== 'user') {
        result.splice(removeIndex, 1);
        dropped++;
      }
      continue;
    }
    // 非 user 消息 → 单独删
    result.splice(removeIndex, 1);
    dropped++;
  }

  return { messages: result, dropped };
}

function truncateByLastN(history: ChatMessage[], userMsg: ChatMessage, n: number) {
  const result: ChatMessage[] = [];
  const systemMsg = history.find((m) => m.role === 'system');
  if (systemMsg) result.push(systemMsg);

  const recent: ChatMessage[] = [];
  let roundCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'system') continue;
    recent.unshift(msg);
    if (msg.role === 'user') roundCount++;
    if (roundCount >= n) break;
  }

  result.push(...recent);
  result.push(userMsg);

  const dropped = history.length - 1 - recent.length;
  return { messages: result, dropped: Math.max(0, dropped) };
}

// ── 用户消息组装 ──

function buildUserMessage(text: string, attachments?: Attachment[]): ChatMessage {
  if (!attachments?.length) {
    return { role: 'user', content: text };
  }

  const parts = [text];
  for (const { name, url } of attachments) {
    parts.push(`[附件: ${name} (${url})]`);
  }

  return { role: 'user', content: parts.join('\n') };
}
