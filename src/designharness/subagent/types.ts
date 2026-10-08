/**
 * 子 agent 契约 —— harness 层（协议中立，与具体业务无关）。
 *
 * 形态依据（2026-10-07 与用户定案）：
 * - 子 agent = **能自己用工具的真·智能体**（模型控制迭代），不是固定循环
 * - 单实现，**不做能力协商**——DSH 的 SubagentCapabilities 是多后端（in-process/
 *   进程外/ACP）的产物；这里只有一个进程内实现，协商是空转
 * - **深度恒 1**：子 agent 的工具表里没有 spawn，不存在递归委派，因此也不需要
 *   DSH 那套持久化深度预算
 * - 权限边界：子 agent 没有问用户的通道（工具全是确定性本地操作），
 *   烧钱动作（生图）天然进不来——与「spec 变更自动渲免费 / 生图须用户确认」的
 *   自动化边界咬合
 *
 * 缓存约定（宿主负责，见 runner）：
 *   messages = [system, ...seed, user(brief)]
 *   同批次的 seed 必须字节级相同（宿主拼装一次复用）→ DeepSeek 前缀缓存命中；
 *   brief 是差异的起点。修正轮 append-only，绝不重写前缀。
 */

import type { ChatMessage } from '../gateway/type/chat';

// ── 工具 ──

/** 工具执行上下文：子 agent 的世界边界 */
export interface AgentToolContext {
  /** 本子 agent 的工作目录——工具的读写应锁在这里 */
  dir: string;
  /** 批次取消信号（长工具应周期性检查） */
  signal: AbortSignal;
  /**
   * 进度事件通道（可选）：长工具（如 spawn 批次）用它把中间状态推给上层
   * ——chat-session 经 SSE 转发给前端渲染委派卡片。事件形状由工具自定
   * （宽松 Record），消费方按 kind 分拣。
   */
  onEvent?: (evt: Record<string, unknown>) => void;
}

export interface AgentToolResult {
  /** 回喂给模型的文本；isError 时由循环加 `ERROR: ` 前缀 */
  content: string;
  isError?: boolean;
}

/** 子 agent 可用的一个工具（形状与 gateway 的 ToolDef 对应，执行端本地） */
export interface AgentTool {
  name: string;
  description: string;
  /** 参数 JSON Schema（对象根） */
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: AgentToolContext): Promise<AgentToolResult>;
}

// ── spawn 请求 ──

export type AgentStopReason =
  /** finish 被调用，或模型自然收尾（无工具调用的纯文本回复） */
  | 'completed'
  /** 模型/传输故障，或 finish 参数损坏等不可恢复问题 */
  | 'failed'
  /** 批次取消 */
  | 'aborted'
  /** 轮数用尽仍未收工 */
  | 'max-turns'
  /** 单轮输出被 token 上限截断 */
  | 'max-tokens';

export interface AgentSpawnRequest {
  /** 运行 id（父账本 agent-spawn / agent-result 两条事件的配对锚点），如 `agt_1a2b3c4d` */
  runId: string;
  /** 展示标签，如 `PT03 材质特写`——账本与 UI 用 */
  label: string;
  /**
   * system prompt：契约规范与纪律。同批次所有子 agent 相同 → 前缀缓存。
   */
  system: string;
  /**
   * 共享 seed 消息（宿主拼装一次、字节级复用；通常是含产品事实/外观锚点的
   * 一条 user 消息）。放这里而不是各 spawn 自带，正是为了让前缀稳定。
   */
  seed: ChatMessage[];
  /** 任务简报——各子 agent 差异的起点（最后一条 user 消息） */
  brief: string;
  /** 工具表。`finish` 由循环引擎内置追加，不要在这里重名 */
  tools: AgentTool[];
  /** 模型调用轮数上限（默认 12）。一轮 = 一次模型请求 */
  maxTurns?: number;
  /** 采样温度（默认 0.3，与 compile 一致） */
  temperature?: number;
}

// ── 结果 ──

export interface AgentUsage {
  /** 模型请求次数（= 实际跑的轮数） */
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface AgentOutcome {
  runId: string;
  label: string;
  stopReason: AgentStopReason;
  /** finish 的 summary；自然收尾时是最后一条 assistant 文本 */
  summary?: string;
  /** finish 上报的产物路径（相对工作目录）。引擎已验存在性，缺失记入 diagnostic */
  artifacts: string[];
  /** 失败/异常说明；与 summary 分离，不混进模型输出 */
  diagnostic?: string;
  usage: AgentUsage;
}
