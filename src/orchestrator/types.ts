/**
 * 编排器类型定义
 *
 * 编排器是 Agent 系统的中枢神经，管控创作管线和修改管线。
 */

import type {
  CreativeBrief,
  VisualDirection,
  CopyDeck,
  SlotManifest,
  AssetBatch,
} from '../schema/index';

// ══════════════════════════════════════════
// 管线状态
// ══════════════════════════════════════════

/** 管线阶段 */
export type PipelineStage =
  | 'idle'          // 等待用户输入
  | 'briefing'      // 创意总监产出简报
  | 'concepting'    // 美术指导 + 文案互调
  | 'executing'     // 设计师 + 素材师并行
  | 'assembling'    // 制作 Agent 组装渲染
  | 'completed'     // 完成
  | 'failed';       // 失败

/** 管线状态快照，前端可用来展示进度 */
export interface PipelineState {
  stage: PipelineStage;
  /** 各阶段是否完成 */
  stages: Record<PipelineStage, 'pending' | 'running' | 'done' | 'error'>;
  /** 开始时间 */
  startedAt?: number;
  /** 当前阶段的错误 */
  error?: string;
}

// ══════════════════════════════════════════
// 管线上下文（贯穿所有阶段的数据载体）
// ══════════════════════════════════════════

export interface PipelineContext {
  // ── 用户原始输入 ──
  userInput: {
    /** 文字描述 / 需求 */
    description: string;
    /** 产品信息 */
    productName?: string;
    productDescription?: string;
    /** 使用场景 */
    useCase?: string;
    /** 参考图本地路径或 URL */
    referenceImageUrl?: string;
  };

  // ── 各阶段产出 ──
  /** 阶段1：创意简报 */
  brief?: CreativeBrief;
  /** 阶段2：视觉方向 */
  visualDirection?: VisualDirection;
  /** 阶段2：文案集 */
  copyDeck?: CopyDeck;
  /** 阶段3：设计师产出的 HTML+CSS 代码 */
  htmlCode?: string;
  /** 阶段3：设计师产出的槽位清单 */
  slotManifest?: SlotManifest;
  /** 阶段3：素材师产出的素材批次 */
  assetBatch?: AssetBatch;
  /** 阶段4：制作产出的成品图路径 */
  finalImagePath?: string;

  // ── 管线状态 ──
  state: PipelineState;
}

// ══════════════════════════════════════════
// 用户修改意图
// ══════════════════════════════════════════

/**
 * 用户在成品图上点选元素后表达的修改意图。
 * 意图路由层据此决定最小化的返工路径。
 */
export type ModificationIntent =
  | {
      /** 样式修改：改 CSS 属性即可，不需要 Agent */
      intent: 'style';
      /** CSS 选择器或元素标识 */
      target: string;
      /** 改什么："font-size: 28px"、"color: #333" */
      change: string;
    }
  | {
      /** 文案修改：直接替换 HTML 文本 */
      intent: 'text';
      /** 文字元素标识 */
      target: string;
      /** 新的文本内容 */
      newText: string;
    }
  | {
      /** 图片问题：重新生成某个槽位的图片 */
      intent: 'image';
      /** 目标槽位 ID */
      slotId: string;
      /** 用户反馈，素材师据此调整 prompt */
      feedback: string;
    }
  | {
      /** 布局调整：重新跑设计师 Agent */
      intent: 'layout';
      /** 用户反馈 */
      feedback: string;
    }
  | {
      /** 整体不满意：从美术指导+文案开始全线重做 */
      intent: 'redesign';
      /** 用户反馈 */
      feedback: string;
    };

// ══════════════════════════════════════════
// 编排结果
// ══════════════════════════════════════════

export interface OrchestrationResult {
  /** 是否成功 */
  success: boolean;
  /** 成品图路径 */
  imagePath?: string;
  /** 错误信息 */
  error?: string;
  /** 完整的管线上下文（含所有中间产物，用于修改链路） */
  context: PipelineContext;
}
