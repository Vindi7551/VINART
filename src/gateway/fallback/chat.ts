import type { ChatMessage, ChatChunk, ChatOptions } from '../type/chat';
import { GatewayError } from '../client/error';
import type { ChatProvider } from '../provider/interface';

/**
 * 对话 Gateway：封装降级链条，对上层透明。
 *
 * 未来可扩展：
 * - 上下文窗口 fallback：prompt 超长时自动切到大窗口模型
 * - 内容审核 fallback：触发安全策略时切换到审核更宽松的模型
 */
export interface ChatGateway {
  stream(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<ChatChunk>;
}

/**
 * 创建 ChatGateway 实例。
 *
 * @param providers Provider 列表，按优先级排列。调用时逐个尝试，
 *                  第一个成功的返回结果，全部失败则抛出 GatewayError。
 *
 * 典型用法：
 *   createChatGateway([
 *     createOpenAI({ model: 'deepseek-v4-flash', ... }),  // 主
 *     createOpenAI({ model: 'deepseek-v3', ... }),         // 降级
 *   ])
 */
export function createChatGateway(providers: ChatProvider[]): ChatGateway {
  if (providers.length === 0) {
    throw new Error('At least one ChatProvider is required');
  }

  return {
    async *stream(messages: ChatMessage[], opts?: ChatOptions) {
      for (const provider of providers) {
        try {
          yield* provider.stream(messages, opts);
          return; // 成功，不再尝试后续 provider
        } catch {
          // 当前 provider 失败 → 静默尝试下一个
        }
      }

      throw new GatewayError(
        `All ${providers.length} chat provider(s) exhausted`,
        undefined,
        false,
        'chat-gateway',
      );
    },
  };
}
