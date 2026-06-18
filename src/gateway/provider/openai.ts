import type { ChatMessage, ChatOptions } from '../type/chat';
import { fetchWithRetry } from '../client/retry';
import { GatewayError } from '../client/error';
import { parseSSE } from '../client/sse-parser';
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
 * 职责：
 * - 请求侧：ChatMessage[] → OpenAI JSON body
 * - 响应侧：SSE 事件 → ChatChunk（OpenAI 语义：choices[0].delta.content）
 *
 * SSE 传输解析委托给 client/sse-parser.ts。
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
        stream_options: { include_usage: true },
        temperature: opts?.temperature ?? 1.0,
        top_p: 1.0,
        max_tokens: opts?.maxTokens ?? 32768,
      };

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

      // SSE 传输解析 → provider 只管 OpenAI 事件语义
      for await (const evt of parseSSE(response.body)) {
        // OpenAI SSE 流结束标记
        if (evt.data === '[DONE]') return;

        try {
          const json = JSON.parse(evt.data);
          const choice = json.choices?.[0];

          yield {
            content: choice?.delta?.content ?? '',
            reasoningContent: choice?.delta?.reasoning_content ?? undefined,
            finishReason: choice?.finish_reason ?? undefined,
            usage: json.usage
              ? {
                  promptTokens: json.usage.prompt_tokens,
                  completionTokens: json.usage.completion_tokens,
                }
              : undefined,
          };
        } catch {
          // 跳过无法解析的行
        }
      }
    },
  };
}
