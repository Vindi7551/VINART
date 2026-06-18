import type { ChatMessage } from '../gateway/type/chat';

/**
 * 截断策略：
 * - 'oldest-first'：从最早的非 system 消息开始丢弃（默认）
 * - 'keep-last-n'：只保留最近 N 轮对话
 */
export type TruncationStrategy = 'oldest-first' | 'keep-last-n';

/** Compaction 配置 */
export interface CompactionConfig {
  /** 是否启用压缩，默认 false */
  enabled?: boolean;
  /**
   * 触发压缩的 token 使用率阈值，默认 0.85。
   * 当 estimatedTokens > maxInputTokens * trigger 时触发压缩。
   */
  trigger?: number;
  /** 保留最近 N 轮对话原文（不压缩），默认 5 */
  keepRecentRounds?: number;
  /**
   * 压缩函数：接收需要压缩的旧消息，返回摘要文本。
   * 由上层注入（session/config），context 不持有 gateway 引用。
   * enabled=false 时可不传。
   */
  compact?: (messages: ChatMessage[]) => Promise<string>;
}

/** 上下文配置 */
export interface ChatContextConfig {
  /** 最大输入 token 预算，默认 90_000（为输出留出空间） */
  maxInputTokens?: number;
  /** 超出预算时的截断策略，默认 oldest-first */
  truncation?: TruncationStrategy;
  /** keep-last-n 策略下保留的最近对话轮数，默认 10 */
  keepLastN?: number;
  /** Compaction 配置（压缩+截断双策略） */
  compaction?: CompactionConfig;
}

/** ChatContext 要产出的结构 */
export interface BuildResult {
  /** 组装好、可直接喂给 gateway 的消息列表 */
  messages: ChatMessage[];
  /** 估算 token 数 */
  estimatedTokens: number;
  /** 本次是否触发了截断 */
  truncated: boolean;
  /** 被截断丢弃的消息数 */
  truncatedCount: number;
  /** 本次是否触发了压缩 */
  compacted: boolean;
  /** 被压缩的消息数 */
  compactedCount: number;
}
