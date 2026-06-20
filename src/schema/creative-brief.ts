/**
 * 创意简报（Creative Brief）
 *
 * 这是所有 Agent 的共享上下文。「创意总监 Agent」产出简报后，
 * 美术指导、文案、设计师、素材师都从同一份简报出发，各自从专业
 * 角度行动，互不阻塞。
 *
 * 简报 = 事前合约，也是审查 Agent 做 QA 时对照的基准。
 */

/** 品牌调性 */
export type BrandPersonality =
  | '简约奢华'
  | '年轻活力'
  | '科技感'
  | '温暖亲切'
  | '高端专业'
  | '文艺感性'
  | string;

/** 品牌语气 */
export type BrandVoice =
  | '专业克制'
  | '活泼口语'
  | '文艺感性'
  | string;

/** 画布尺寸 */
export interface CanvasSpec {
  /** 宽度 px */
  width: number;
  /** 高度 px */
  height: number;
}

/** 品牌规范约束（用户已有的品牌手册内容） */
export interface BrandGuidelines {
  /** 品牌主色 hex */
  primaryColor?: string;
  /** 品牌辅色 hex */
  secondaryColor?: string;
  /** 品牌字体 */
  fontFamily?: string;
  /** Logo 位置偏好 */
  logoPosition?: string;
  /** 其他约束文本 */
  additional?: string;
}

export interface CreativeBrief {
  // ── 项目身份 ──
  /** 项目用途：电商海报 / 社交媒体 / 移动 H5 / 品牌落地页 */
  useCase: string;

  // ── 产品信息（来自用户输入）──
  /** 产品名 */
  productName: string;
  /** 产品描述 / 卖点（用户提供的原始信息） */
  productDescription: string;

  // ── 传达目标 ──
  /** 目标受众：谁会看到这张图 */
  targetAudience: string;
  /** 核心信息：最想让受众记住的一句话 */
  keyMessage: string;

  // ── 品牌人格 ──
  /** 品牌调性 */
  brandPersonality: BrandPersonality;
  /** 品牌说话语气 */
  brandVoice: BrandVoice;
  /** 调性关键词：用来校准方向的锚点词（如 "轻盈"、"纯粹"、"元气"） */
  toneKeywords: string[];

  // ── 视觉方向 ──
  /** 整体视觉风格概述 */
  visualStyle: string;
  /** 情绪氛围 */
  mood: string;
  /** 色彩方向指引（不是具体色值，是方向，如 "暖调大地色"、"冷调科技蓝"） */
  colorDirection: string;
  /** 参考图分析产物（vision 模型对用户上传图片的分析描述） */
  referenceImageNotes?: string;

  // ── 交付规格 ──
  /** 画布尺寸 */
  canvas: CanvasSpec;

  // ── 约束 ──
  /** 必须包含的元素 */
  mustInclude?: string[];
  /** 禁止出现的东西 */
  mustAvoid?: string[];
  /** 品牌已有规范（如果有） */
  brandGuidelines?: BrandGuidelines;
}
