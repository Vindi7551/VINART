import type { ChatMessage, ChatChunk, ChatOptions } from '../type/chat';
import { fetchWithRetry } from '../client/retry';
import { GatewayError } from '../client/error';
import type { ChatProvider } from './interface';

interface OpenAIConfig {
  /** API 基础地址，如 https://api.deepseek.com */
  baseURL: string;
  /** 模型名称，如 deepseek-v4-flash */
  model: string;
  apiKey: string;
}

/**
 * 创建 OpenAI 兼容协议的 ChatProvider 实例。
 *
 * 适配所有使用 OpenAI Chat Completion 格式的模型（DeepSeek、GPT 等）。
 * 使用 fetch + ReadableStream 手动解析 SSE 流，而不是 EventSource
 *（因为 EventSource 不支持 POST 和自定义 headers）。
 *
 * SSE 流格式：
 *   data: {"choices":[{"delta":{"content":"文本增量"}}],"object":"chat.completion.chunk"}
 *   data: [DONE]
 */
export function createOpenAI(config: OpenAIConfig): ChatProvider {
  const { baseURL, model, apiKey } = config;
  const endpoint = `${baseURL}/chat/completions`;

  return {
    name: `openai:${model}`,

    async *stream(messages: ChatMessage[], opts?: ChatOptions) {
      const body = {
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true }, // 让 API 在最后一块返回 usage
        temperature: opts?.temperature ?? 1.0,
        top_p: 1.0,
        max_tokens: opts?.maxTokens ?? 32768,
      };

      // 发起请求（含重试）
      const response = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          timeout: 60_000,
        },
        { retries: 2 },
      );

      if (!response.body) {
        throw new GatewayError('Response body is empty', undefined, false, config.model);
      }

      // 手动解析 SSE 流
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ''; // 缓冲区：处理跨 chunk 的不完整行

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // 最后一行可能不完整，留到下次处理
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6); // 去掉 "data: " 前缀
            if (data === '[DONE]') return;  // SSE 流结束标记

            try {
              const json = JSON.parse(data);
              const choice = json.choices?.[0];

              const chunk: ChatChunk = {
                content: choice?.delta?.content ?? '',
                finishReason: choice?.finish_reason ?? undefined,
                usage: json.usage
                  ? {
                      promptTokens: json.usage.prompt_tokens,
                      completionTokens: json.usage.completion_tokens,
                    }
                  : undefined,
              };

              yield chunk;
            } catch {
              // 跳过无法解析的行（某些中间件可能插入空行或注释）
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
