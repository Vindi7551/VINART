/**
 * 槽位规格（Slot Specification）
 *
 * 设计师 Agent 的产出之一。设计师从视觉方向出发，完成 HTML+CSS
 * 布局框架后，提取出所有需要图片填充的槽位，为每个槽位定义规格。
 *
 * 素材师 Agent（每个槽位一个独立实例）以此作为输入，并行生成图片。
 * 槽位的数量和类型完全由当前设计决定，不是预定义的模板。
 *
 * 槽位 ID 对应 HTML 中 data-image-slot 属性的值。
 */

// ── 槽位内容描述 ──

/**
 * 槽位需要在画面上呈现的内容。
 * 用自然语言描述，素材师 Agent 据此生成图片。
 */
export interface SlotContent {
  /** 主体内容：产品、人物、场景、纹理、装饰等 */
  subject: string;
  /** 背景/环境 */
  background?: string;
  /** 构图建议：居中 / 偏右 / 俯视 / 特写 等 */
  composition?: string;
  /** 光线/影调 */
  lighting?: string;
}

// ── 槽位视觉约束 ──

/**
 * 槽位级别的视觉约束。
 * 会覆盖 / 细化 VisualDirection 中同 slotType 的 ImageTreatment。
 * 如果某个槽位需要和同类槽位不同的处理，在这里指定。
 */
export interface SlotVisualConstraint {
  /** CSS filter 倾向 */
  filterStyle?: string;
  /** 色层叠加 */
  colorOverlay?: string;
  /** 混合模式 */
  blendMode?: 'normal' | 'multiply' | 'overlay' | 'screen' | 'soft-light';
  /** 色彩约束（"避免大红"、"保持冷调"） */
  colorNotes?: string;
}

// ── 槽位规格 ──

export interface SlotSpec {
  /** 槽位唯一标识，对应 HTML 中 data-image-slot="xxx" */
  id: string;
  /** 槽位类型：关联到 VisualDirection 中 ImageTreatment 的 slotType */
  slotType: string;
  /** 槽位在画布中的尺寸 px */
  width: number;
  /** 槽位在画布中的尺寸 px */
  height: number;
  /** 内容描述 */
  content: SlotContent;
  /** 本槽位专属视觉约束（可选，多数情况继承 ImageTreatment） */
  visualConstraint?: SlotVisualConstraint;
  /** 优先级：素材师并行时，高优先级的槽位先交付 */
  priority?: 'high' | 'normal' | 'low';
  /** 补充说明 */
  note?: string;
}

// ── 设计师 Agent 的完整槽位产出 ──

/**
 * 设计师 Agent 产出的槽位清单。
 * 与 HTML+CSS 代码一起交付给编排器。
 * 编排器据此 fork 素材师 Agent 实例。
 */
export interface SlotManifest {
  /** 槽位列表 */
  slots: SlotSpec[];
  /** 总数 */
  totalCount: number;
}
