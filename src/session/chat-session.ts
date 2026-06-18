import type { ChatMessage, Attachment } from '../gateway/type/chat';
import type { ChatGateway } from '../gateway/index';
import type { ChatSession } from './types';

interface SessionConfig {
  /** Agent 的 system prompt，在会话创建时确定，reset 后保留 */
  systemPrompt: string;
  /** 注入的 Gateway 实例（依赖反转，方便测试替换） */
  gateway: ChatGateway;
  /** 采样温度，默认 1.0 */
  temperature?: number;
  /** 最大输出 token 数，默认 32768 */
  maxTokens?: number;
}

/**
 * 创建 ChatSession 实例。
 *
 * 使用示例：
 *   const session = createChatSession({
 *     systemPrompt: '你是一个前端工程师...',
 *     gateway: getChatGateway(),
 *   });
 *
 *   for await (const chunk of session.send('写一个登录页面')) {
 *     console.log(chunk.content); // 流式输出
 *   }
 *   // 此时 session.messages 已包含完整对话历史
 *   for await (const chunk of session.send('标题再大一点')) {
 *     // 自动带上历史上下文
 *   }
 */
export function createChatSession(config: SessionConfig): ChatSession {
  const { systemPrompt, gateway, temperature = 1.0, maxTokens = 32768 } = config;

  // 消息历史，以 system prompt 起始
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  return {
    id: crypto.randomUUID(),

    // 返回历史副本，防止外部直接修改内部数组
    get messages() {
      return [...messages];
    },

    async *send(userMessage: string, _attachments?: Attachment[]) {
      // 1. 追加用户消息到历史
      messages.push({ role: 'user', content: userMessage });

      // 2. 调用 Gateway，传入完整历史
      // 3. 一边收集完整回复，一边 yield chunk 给调用方
      let fullContent = '';

      for await (const chunk of gateway.stream(messages, { temperature, maxTokens })) {
        fullContent += chunk.content;
        yield chunk;
      }

      // 4. 将完整回复追加到历史
      messages.push({ role: 'assistant', content: fullContent });
    },

    reset() {
      messages.length = 0;
      messages.push({ role: 'system', content: systemPrompt });
    },
  };
}
