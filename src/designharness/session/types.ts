import type { ChatMessage, ChatChunk, Attachment } from '../gateway/type/chat';

/**
 * 对话会话接口。
 *
 * 每个 Agent 创建自己的 Session 实例，Session 负责：
 * 1. 维护消息历史（messages 数组）
 * 2. 每次 send() 自动追加用户消息到历史
 * 3. 调用 Context 组装请求、Gateway 获取流式响应
 * 4. 收集完整回复并追加 assistant 消息到历史
 * 5. 中止、回滚、历史编辑
 */
export interface ChatSession {
  /** 会话唯一标识 */
  readonly id: string;
  /** 当前完整消息历史（含 system prompt），返回副本 */
  readonly messages: ChatMessage[];
  /** 是否有流式请求正在进行中 */
  readonly isStreaming: boolean;
  /** 累计 token 用量 */
  readonly usage: SessionUsage;

  /** 发送用户消息，返回流式响应。内部自动管理历史 */
  /** 发送用户消息，返回流式响应。内部自动管理历史。
   *  opts.systemNote:本轮动态注入的运行时上下文(如「当前打开的版式」摘要)——
   *  以附加 system 消息插入组装结果,**不进持久历史**(每轮按最新状态重算) */
  send(
    userMessage: string,
    attachments?: Attachment[],
    opts?: { systemNote?: string },
  ): AsyncIterable<ChatChunk>;

  /** 中止当前流式请求。send() 的迭代器将提前结束 */
  abort(): void;

  /** 灌回历史(持久化恢复;传不含 system 的对话消息,system 由会话自己持有) */
  restore(messages: ChatMessage[]): void;

  /** 重置会话，清空历史（保留 system prompt） */
  reset(): void;

  /** 删除最近一轮对话（user + assistant），用于"撤回"不满意的回复 */
  removeLastExchange(): void;
}

export interface SessionUsage {
  promptTokens: number;
  completionTokens: number;
}
