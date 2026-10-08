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
        // 工具调用是 Open 标准 chat 规范：有就带，没有就不带该键
        ...(opts?.tools?.length ? { tools: opts.tools } : {}),
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

          // 工具调用增量：delta.tool_calls 数组，原样透传（按 index 折叠是消费方的事，
          // 折叠规则见 ../util/toolcalls.ts——provider 保持无状态直通）
          const rawDeltas: unknown[] = choice?.delta?.tool_calls;
          const toolCallDeltas = Array.isArray(rawDeltas) && rawDeltas.length > 0
            ? rawDeltas.map((d) => {
                const delta = d as {
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                };
                return {
                  index: delta.index ?? 0,
                  id: delta.id,
                  name: delta.function?.name,
                  arguments: delta.function?.arguments,
                };
              })
            : undefined;

          yield {
            content: choice?.delta?.content ?? '',
            reasoningContent: choice?.delta?.reasoning_content ?? undefined,
            toolCallDeltas,
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
