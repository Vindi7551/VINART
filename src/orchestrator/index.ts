/**
 * 编排器
 *
 * 管控两条管线：
 * 1. 创作管线 — 从用户输入到成品图的一次完整生成
 * 2. 修改管线 — 用户点选元素后的最小化返工
 */

import type {
  PipelineContext,
  PipelineState,
  ModificationIntent,
  OrchestrationResult,
} from './types';

// ══════════════════════════════════════════
// 编排器接口
// ══════════════════════════════════════════

export interface Orchestrator {
  /**
   * 启动创作管线。
   * 输入用户需求 + 可选的参考图，输出成品图和完整的管线上下文。
   */
  create(input: {
    description: string;
    productName?: string;
    productDescription?: string;
    useCase?: string;
    referenceImageUrl?: string;
  }): Promise<OrchestrationResult>;

  /**
   * 修改管线。
   * 用户在成品图上点选元素并表达修改意图后调用。
   * 编排器按意图类型做最小化返工，复用所有未受影响的阶段产出。
   */
  modify(
    context: PipelineContext,
    intent: ModificationIntent,
  ): Promise<OrchestrationResult>;

  /** 当前管线状态 */
  readonly state: PipelineState;

  /** 中止正在运行的管线 */
  abort(): void;
}

// ══════════════════════════════════════════
// 创作管线阶段定义
// ══════════════════════════════════════════

/**
 * 创作管线四阶段。
 *
 *   阶段1  briefing   创意总监 → CreativeBrief
 *   阶段2  concepting 美术指导 + 文案（共享 Session，≤5 轮互调）
 *                     → VisualDirection + CopyDeck
 *   阶段3  executing  设计师（HTML+CSS + SlotSpec）
 *                     ∥ 素材师 × N（每个槽位 fork 独立实例）
 *                     → HTML + AssetBatch
 *   阶段4  assembling 制作（组装文案+图片 → Blink 渲染）
 *                     → 成品图
 */

// ══════════════════════════════════════════
// 修改管线：意图 → 返工路径映射
// ══════════════════════════════════════════

/**
 * 不同修改意图对应的最小返工路径。
 *
 *   intent: style
 *     → 直接修改 HTML/CSS 中对应元素的样式
 *     → 重新渲染（不跑任何 Agent）
 *
 *   intent: text
 *     → 直接替换 HTML 中对应元素的文本内容
 *     → 重新渲染（不跑任何 Agent）
 *
 *   intent: image
 *     → 重启目标 slotId 的素材师实例（单个）
 *     → 制作 Agent 回填新图 → 渲染
 *
 *   intent: layout
 *     → 重启设计师 Agent（复用已有的 VisualDirection + CopyDeck）
 *     → 如果 SlotSpec 变了，增量更新受影响的素材师
 *     → 制作 Agent 组装 → 渲染
 *
 *   intent: redesign
 *     → 全线重做：从阶段2 concepting 开始
 *     → 带上用户的 feedback 作为额外约束
 */

// ══════════════════════════════════════════
// 并行的具体形式
// ══════════════════════════════════════════

/**
 * 阶段3 并行模型：
 *
 *   设计师 Agent（独立实例）
 *     │
 *     │ 产出 HTML + SlotSpec（含 N 个槽位）
 *     │
 *     ├──→ 素材师 #1（slotId: "hero-bg"）
 *     ├──→ 素材师 #2（slotId: "product-main"）
 *     ├──→ 素材师 #3（slotId: "decoration-left"）
 *     └──→ ...
 *         ↓
 *   所有素材师完成后
 *         ↓
 *   制作 Agent（组装 + 渲染）
 *
 * 注意事项：
 * - 设计师和素材师可以真正并行启动——素材师只需要 SlotSpec，
 *   不需要等 HTML 写完。但实际上 SlotSpec 是设计师的产出。
 *   所以素材师在设计师产出 SlotSpec 之后立即启动，
 *   可以和设计师继续调整 HTML 并行（设计师不需要等素材师）。
 *
 * - 每个素材师是独立 Agent 实例，有自己的一次性 Session。
 *   互不通信、互不阻塞。
 *
 * - 如果有素材师失败（AssetStatus: failed），编排器自动
 *   重启该实例。重启次数有上限（如 3 次）。
 */

// ══════════════════════════════════════════
// 美指+文案互调的具体形式
// ══════════════════════════════════════════

/**
 * 阶段2 共享 Session 模型：
 *
 *   美术指导 Agent 和文案 Agent 共享同一个 ChatSession。
 *   不是两个独立 Agent 互相发消息，而是编排器创建共享
 *   Session，两边的 system prompt 合并，在对话中交替产出
 *   视觉方向和文案。
 *
 *   互调流程：
 *     Round 1: 双方产出初稿
 *     Round 2-N: 互相反馈、调整
 *     限制：最多 5 轮，但不必跑满——收敛即可停止
 *
 *   收敛条件（满足任一即停止）：
 *   - 美术指导声明 "视觉方向已确定"
 *   - 文案声明 "文案已确定"
 *   - 达到 5 轮上限
 *
 *   产出拆分：
 *   编排器从共享 Session 的消息历史中解析出：
 *   - VisualDirection（美术指导的部分）
 *   - CopyDeck（文案的部分）
 */

// ══════════════════════════════════════════
// 错误处理策略
// ══════════════════════════════════════════

/**
 *   素材师失败 → 自动重试（上限 3 次）
 *   设计师失败 → 带回退（降低温度重新生成）
 *   美指+文案互调发散 → 达到上限后强制收敛，取最后一轮产出
 *   创意总监（简报）失败 → 带回退（简化 brief 重试一次）
 *   制作失败 → 报告具体错误（组装/渲染哪一步挂了）
 */
