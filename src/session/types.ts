import type { ChatMessage, ChatChunk, Attachment } from '../gateway/type/chat';

/**
 * 对话会话接口。
 *
 * 每个 Agent 创建自己的 Session 实例，Session 负责：
 * 1. 维护消息历史（messages 数组）
 * 2. 每次 send() 自动追加用户消息到历史
 * 3. 调用 Gateway 获取流式响应
 * 4. 收集完整回复并追加 assistant 消息到历史
 */
export interface ChatSession {
  /** 会话唯一标识 */
  readonly id: string;
  /** 当前完整消息历史（含 system prompt） */
  readonly messages: ChatMessage[];

  /** 发送用户消息，返回流式响应。内部自动管理历史 */
  send(userMessage: string, attachments?: Attachment[]): AsyncIterable<ChatChunk>;

  /** 重置会话，清空历史（保留 system prompt） */
  reset(): void;
}
