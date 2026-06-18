import type { ChatMessage, ChatChunk, ChatOptions } from '../type/chat';
import type { ChatProvider } from './interface';

interface AnthropicConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}

/**
 * 创建 Anthropic Messages API 适配器（预留骨架）。
 *
 * Anthropic 使用自有协议，非 OpenAI 兼容：
 * - POST {baseURL}/messages
 * - 请求头 x-api-key 而非 Authorization: Bearer
 * - system prompt 是独立字段，不在 messages 数组里
 * - 流式 SSE 事件类型与 OpenAI 不同
 *
 * 后续接入 Claude 系列模型时实现。
 */
export function createAnthropic(_config: AnthropicConfig): ChatProvider {
  const name = `anthropic:${_config.model}`;

  return {
    name,

    async *stream(_messages: ChatMessage[], _opts?: ChatOptions): AsyncIterable<ChatChunk> {
      throw new Error('Anthropic provider not yet implemented');
    },
  };
}
