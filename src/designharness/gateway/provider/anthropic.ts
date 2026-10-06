import type { ChatMessage, ChatChunk, ChatOptions } from '../type/chat';
// import { parseSSE } from '../client/sse-parser';  // 实现时启用
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
 *
 * 响应侧 SSE 事件格式与 OpenAI 完全不同：
 * - 用 event: 字段区分事件类型（content_block_delta / message_delta / ...）
 * - delta.text 而非 choices[0].delta.content
 * - usage 在 message_delta 事件中
 *
 * SSE 传输解析复用 client/sse-parser.ts，本文件只管 Anthropic 事件语义。
 *
 * 尚未实现，骨架展示了解析模式。
 */
export function createAnthropic(_config: AnthropicConfig): ChatProvider {
  const name = `anthropic:${_config.model}`;

  return {
    name,

    async *stream(_messages: ChatMessage[], _opts?: ChatOptions): AsyncIterable<ChatChunk> {
      /*
      const body = {
        model: _config.model,
        system: extractSystemPrompt(_messages),  // Anthropic: system 是独立字段
        messages: toAnthropicMessages(_messages), // 只含 user/assistant
        stream: true,
        max_tokens: _opts?.maxTokens ?? 32768,
      };

      const response = await fetchWithRetry(
        `${_config.baseURL}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': _config.apiKey,          // Anthropic 用 x-api-key
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        },
      );

      // 响应侧：SSE 传输解析复用，这里只处理 Anthropic 事件语义
      for await (const evt of parseSSE(response.body)) {
        switch (evt.event) {
          case 'content_block_delta':
            // → { content: json.delta.text, ... }
            break;
          case 'message_delta':
            // → { usage: json.usage, finishReason: json.delta.stop_reason, ... }
            break;
        }
      }
      */

      throw new Error('Anthropic provider not yet implemented');
    },
  };
}
