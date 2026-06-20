/**
 * 文案集（Copy Deck）
 *
 * 文案 Agent 的产出。从创意简报出发，生成画面所需的所有文字内容。
 *
 * 不只给「最终版」，而是给多级文案 + 变体 —— 设计师可以按布局空间
 * 挑选合适长度的版本。如果所有变体都不适配，设计师可以向文案 Agent
 * 提约束重写（如 "标题缩到 8 个字以内"）。
 *
 * 文案 Agent 与美术指导共享同一个 Session，在多轮互调中产出此集。
 */

// ── 文案变体 ──

/**
 * 一个文案变体。
 * 同一段文案的不同表达方式，适配不同空间和语气需求。
 */
export interface CopyVariant {
  /** 文案文本 */
  text: string;
  /** 变体特征 */
  flavor: 'short' | 'long' | 'punchy' | 'descriptive' | 'formal' | 'casual' | string;
  /** 适用场景备注 */
  note?: string;
}

// ── 文案条目 ──

/**
 * 一条文案 —— 对应画面中一个文字元素。
 * 首选文案放在 primary，备选变体放在 alternatives。
 * 设计师默认使用 primary，空间不够或语气不匹配时换用 alternatives。
 */
export interface CopyItem {
  /** 文案角色：标题 / 副标题 / 正文 / 行动号召 / 标注 / 价格 等 */
  role: 'headline' | 'subheadline' | 'body' | 'cta' | 'caption' | 'price' | string;
  /** 首选文案 */
  primary: string;
  /** 备选变体（可选） */
  alternatives?: CopyVariant[];
  /**
   * 给设计师的布局提示。
   * 如 "主标题建议独占一行，不要折行"、"CTA 建议不超过 4 个字"
   */
  layoutHint?: string;
}

// ── 文案集 ──

/**
 * 文案 Agent 产出的完整文案集。
 * 包含所有文字元素、整体文案策略和品牌语气校准说明。
 */
export interface CopyDeck {
  /** 文案条目列表 */
  items: CopyItem[];
  /** 文案策略：为什么选这些词、想传达什么感觉 */
  strategy: string;
  /** 品牌语气校准说明，如 "偏口语化但不失专业感" */
  toneCalibration: string;
}
