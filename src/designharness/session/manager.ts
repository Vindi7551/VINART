import type { ChatGateway } from '../gateway/index';
import type { ChatContext } from '../context/index';
import type { AgentTool } from '../subagent/types';
import { createChatSession } from './chat-session';
import type { ChatSession } from './types';

/** 创建会话的配置（比 createChatSession 多一个标签） */
export interface CreateSessionConfig {
  /** 会话显示名称，如 "designAgent"、"codeAgent" */
  label: string;
  /** Agent 的 system prompt */
  systemPrompt: string;
  /** 注入的 Gateway 实例 */
  gateway: ChatGateway;
  /** 上下文管理器 */
  context: ChatContext;
  /** 主 AI 的工具表（可选；给了 → send 走工具循环） */
  tools?: AgentTool[];
  /** 采样温度 */
  temperature?: number;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 指定会话 id(持久化键;缺省自动生成) */
  id?: string;
}

/** 带标签的会话视图 */
export interface SessionView {
  readonly id: string;
  readonly label: string;
  readonly messageCount: number;
  readonly isStreaming: boolean;
  readonly usage: { promptTokens: number; completionTokens: number };
}

/**
 * 会话管理器。
 *
 * 管理多个独立的 ChatSession 实例。
 * 每个 Agent 或每个设计任务创建自己的会话，互不干扰。
 *
 * 典型用法：
 *   const manager = createSessionManager();
 *   const designSession = manager.create({
 *     label: '设计登录页',
 *     systemPrompt: '你是设计专家...',
 *     gateway: getChatGateway(),
 *     context: createChatContext({ maxInputTokens: 900000 }),
 *   });
 *
 *   for await (const chunk of designSession.send('设计一个登录页')) { ... }
 *
 *   const codeSession = manager.create({
 *     label: '写登录代码',
 *     systemPrompt: '你是前端工程师...',
 *     gateway: getChatGateway(),
 *     context: createChatContext(),
 *   });
 */
export interface SessionManager {
  /** 创建新会话 */
  create(config: CreateSessionConfig): ChatSession;
  /** 按 ID 获取会话 */
  get(id: string): ChatSession | undefined;
  /** 获取所有会话的视图列表（轻量，不含完整消息历史） */
  list(): SessionView[];
  /** 删除指定会话 */
  delete(id: string): boolean;
  /** 删除所有会话 */
  clear(): void;
}

export function createSessionManager(): SessionManager {
  const sessions = new Map<string, { session: ChatSession; label: string }>();

  return {
    create(config: CreateSessionConfig) {
      const { label, systemPrompt, gateway, context, tools, temperature, maxTokens, id } = config;
      const session = createChatSession({ id, systemPrompt, gateway, context, tools, temperature, maxTokens });
      sessions.set(session.id, { session, label });
      return session;
    },

    get(id: string) {
      return sessions.get(id)?.session;
    },

    list(): SessionView[] {
      const views: SessionView[] = [];
      for (const [id, { session, label }] of sessions) {
        views.push({
          id,
          label,
          messageCount: session.messages.length,
          isStreaming: session.isStreaming,
          usage: session.usage,
        });
      }
      return views;
    },

    delete(id: string) {
      return sessions.delete(id);
    },

    clear() {
      sessions.clear();
    },
  };
}
