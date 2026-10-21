import type { ChatMessage, Attachment, ContentPart, TextPart, VendorPart } from '../gateway/type/chat';
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
    imageTokenCost = DEFAULT_IMAGE_TOKEN_COST,
    imageDetail = 'original',
  } = config;

  // 精确 token 数（来自 API usage），初始为 0 表示用估算
  let lastRealPromptTokens = 0;

  return {
    estimateTokens: (messages) => estimateTokens(messages, imageTokenCost),

    updateUsage(promptTokens: number) {
      lastRealPromptTokens = promptTokens;
    },

    async build(history: ChatMessage[], userMessage: string, attachments?: Attachment[]) {
      // 1. 组装用户消息
      const userMsg = buildUserMessage(userMessage, attachments, imageDetail);

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
export function estimateTokens(
  messages: ChatMessage[],
  imageTokenCost: number = DEFAULT_IMAGE_TOKEN_COST,
): number {
  let total = 0;
  for (const msg of messages) {
    // 文本部分：字符数 ÷ 3
    total += Math.ceil(contentToText(msg.content).length / 3);
    // 图片部分：按固定成本计，不能按 base64 字符数算
    total += countImageParts(msg.content) * imageTokenCost;
  }
  // 每消息 overhead：〈User〉/〈Assistant〉/begin/end of sentence 等特殊 token
  total += messages.length * 8;
  return total;
}

/**
 * 单张图片 token 成本的**兜底默认值**。
 *
 * ⚠️ 这是供应商相关的数值，不是通用常数。1000 来自 DeepSeek 实测
 * （1024×1024 @ detail='original' → 图片本身约 932 token，取整为保守上限），
 * 权威定义在 `gateway/type/deepseek-chat.ts` 的 `DEEPSEEK_IMAGE_TOKEN_COST`。
 * 换供应商或换图像档位时，应通过 `ChatContextConfig.imageTokenCost` 注入正确值。
 *
 * ⚠️ 绝不能对图片内容做 `JSON.stringify(...).length / 3`：
 * 一张 2 MB 图的 base64 有 273 万字符，会算出约 **91 万 token** 的假数字，
 * 直接摧毁 token 预算与压缩触发逻辑。
 *
 * 注：同一张图在**一个请求内被引用多次时不去重**，token 线性叠加
 * （实测：引用 2 次 → 972 → 1905）。要复用请靠 prompt 前缀缓存。
 */
export const DEFAULT_IMAGE_TOKEN_COST = 1000;

/** 从消息内容中抽取纯文本（图片/其他块被忽略；null = 无正文的工具调用消息） */
export function contentToText(content: ChatMessage['content']): string {
  if (content === null) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is TextPart => part.type === 'text' && 'text' in part)
    .map((part) => part.text)
    .join('\n');
}

/** 统计消息内容里的图片/文件块数量 */
export function countImageParts(content: ChatMessage['content']): number {
  if (content === null || typeof content === 'string') return 0;
  return content.filter((part) => part.type !== 'text').length;
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

/**
 * 把附图的落盘路径追加进正文。
 *
 * 为什么：模型看得见图块（file/image_url），但路径字符串只活在附件元数据里——
 * 不写进正文，它要用路径时（generate_assets 的 references、
 * 「刚才那张图存哪了」）说不出，实测只会反问用户要文件名。
 *
 * transcript 只存原始 text，这行由组装层（buildUserMessage / deriveMessages）
 * 统一补——两处共用本函数防漂移；幂等成立的前提是存与渲分离。
 */
export function withAttachmentPaths(text: string, paths: string[]): string {
  const rel = paths.filter(Boolean);
  if (!rel.length) return text;
  return `${text}\n\n[附图落盘路径（可引用）：${rel.join('、')}]`;
}

/**
 * 组装 user 消息：有附件 → text + 图片内容块数组（发给模型与存进历史同形）。
 * 导出给 chat-session 复用——历史 push 与本轮请求的 user 消息形状必须一致，
 * 两处各写一份迟早漂移。
 *
 * 附件带 fileId（Files API）→ 组装为 `file` 内容块引用，不内联 base64：
 * 同一张图在多轮请求中只传一次，后续轮次请求体只剩 file_id 字符串。
 * 块形状 {type:'file', file_id} 是 DeepSeek Files API 约定（见
 * gateway/type/deepseek-chat.ts 的 DeepSeekFileRefPart），经 VendorPart 透传——
 * provider 层不认识也原样放行，这正是 VendorPart 存在的意义。
 */
export function buildUserMessage(
  text: string,
  attachments?: Attachment[],
  defaultDetail?: string,
): ChatMessage {
  if (!attachments?.length) {
    return { role: 'user', content: text };
  }

  // 附图路径文本化（withAttachmentPaths 注释）——name 即相对工作目录的落盘路径
  const paths = attachments.map((a) => a.name);
  // 有附件 → 必须用内容块数组，否则图片无法到达模型。
  // （旧实现把附件拼成 "[附件: name (url)]" 一行文字，图片被静默丢弃。）
  const parts: ContentPart[] = [{ type: 'text', text: withAttachmentPaths(text, paths) }];
  for (const att of attachments) {
    if (att.fileId) {
      // as 断言绕过 excess property check——file_id 形状见 VendorPart 注释与 deepseek-chat.ts
      const fileRef = { type: 'file', file_id: att.fileId } as VendorPart;
      parts.push(fileRef);
      continue;
    }
    parts.push({
      type: 'image_url',
      image_url: {
        url: att.url,
        // 附件可自带 detail 覆盖默认档位；
        // 默认值由 ChatContextConfig.imageDetail 注入（供应商相关）
        detail: att.detail ?? defaultDetail,
      },
    });
  }

  return { role: 'user', content: parts };
}
