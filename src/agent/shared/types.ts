import type { ChatSession } from '../../session/index';
import type { ChatGateway } from '../../gateway/index';
import type { ChatContext } from '../../context/index';

/**
 * Agent 基类接口。
 *
 * 每个 Agent 的本质：
 * - 一个动态组装的 system prompt（固定角色 + 任务上下文）
 * - 一个 ChatSession（管理对话生命周期）
 * - 一个 run() 方法（接收输入、产出输出）
 *
 * 未来扩展：skills 注入点
 */
export interface Agent<TInput, TOutput> {
  /** Agent 名称，如 "designAgent" */
  readonly name: string;
  /** 内部会话 */
  readonly session: ChatSession;
  /** 执行任务 */
  run(input: TInput): Promise<TOutput>;
}

/** 创建 Agent 的通用配置 */
export interface AgentConfig {
  /** 动态组装后的 system prompt */
  systemPrompt: string;
  /** 注入的 Gateway */
  gateway: ChatGateway;
  /** 注入的 Context */
  context: ChatContext;
  /** 采样温度 */
  temperature?: number;
  /** 最大输出 token */
  maxTokens?: number;
}
