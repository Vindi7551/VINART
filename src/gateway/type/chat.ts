// ── 对话/代码生成相关类型 ──

/** 单条对话消息，兼容 OpenAI Chat Completion 格式 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ── 流式响应 ──

/** 流式对话中每次 yield 的数据块 */
export interface ChatChunk {
  /** 增量文本内容 */
  content: string;
  /** 流结束时的终止原因，仅在最后一个 chunk 出现 */
  finishReason?: 'stop' | 'length' | 'error';
  /** Token 用量统计，仅在最后一个 chunk 出现（需 stream_options.include_usage） */
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

// ── 通用选项 ──

export interface ChatOptions {
  /** 采样温度，DeepSeek 推荐 1.0 */
  temperature?: number;
  /** 最大输出 token 数，默认 32768 */
  maxTokens?: number;
}

// ── 附件 ──

/** 用户上传的素材文件 */
export interface Attachment {
  name: string;
  url: string;
}
