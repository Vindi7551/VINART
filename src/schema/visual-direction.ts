/**
 * 视觉方向（Visual Direction）
 *
 * 美术指导 Agent 的产出。从创意简报出发，定义一套「视觉语言系统」——
 * 不是一个全局扁平的值，而是不同元素、不同区域的差异化处理方案。
 *
 * 设计师用它来落 CSS（哪些区域用什么色、什么渐变、什么字体处理），
 * 素材师用它来约束每个槽位的图片风格和滤镜倾向。
 */

// ══════════════════════════════════════════
// 色彩系统
// ══════════════════════════════════════════

/** 一个纯色色标 */
export interface ColorStop {
  /** hex 值 */
  hex: string;
  /** 在渐变中的位置 0-1（纯色时省略） */
  position?: number;
}

/** 颜色定义：可以是纯色，也可以是渐变 */
export interface ColorToken {
  /** 语义名称：用于被其他规则引用 */
  name: string;
  /** 纯色 => stops 只有一个；渐变 => stops 多个 */
  stops: ColorStop[];
  /** 渐变角度 deg（纯色时省略） */
  gradientAngle?: number;
  /** 备注 */
  note?: string;
}

/**
 * 不同区域/元素的配色分配。
 * 每个 key 是画面的一个逻辑区域，value 引用 ColorToken 的 name。
 * 哪些区域由美术指导根据 brief 中的 useCase 自行决定。
 */
export interface ColorAssignment {
  /** 主标题文字色 / 渐变 */
  headline?: string;
  /** 副标题文字色 */
  subheadline?: string;
  /** 正文色 */
  body?: string;
  /** CTA 按钮背景 */
  ctaBackground?: string;
  /** CTA 按钮文字 */
  ctaText?: string;
  /** 整体背景 */
  background?: string;
  /** 卡片/容器背景 */
  surface?: string;
  /** 装饰线条/分隔 */
  divider?: string;
  /** 价格/数字 */
  price?: string;
  /** 自由扩展 */
  [custom: string]: string | undefined;
}

/** 色彩系统 */
export interface ColorSystem {
  /** 色标库（美术指导定义的所有颜色和渐变） */
  tokens: ColorToken[];
  /** 各区域的配色分配 */
  assignment: ColorAssignment;
  /** 整体色彩感受和逻辑说明 */
  description: string;
}

// ══════════════════════════════════════════
// 字体系统
// ══════════════════════════════════════════

/**
 * 一个字体样式 —— 不是按「层级角色」硬编码，而是按命名样式。
 * 同一个样式可以被多个元素共用，也可以每个元素独立定义。
 */
export interface TypeStyle {
  /** 样式名称，供 assignment 引用 */
  name: string;
  /** 字体族，按优先级 */
  fontFamily: string[];
  /** 字号 px */
  fontSize: number;
  /** 字重 */
  fontWeight: number;
  /** 行高倍数 */
  lineHeight?: number;
  /** 字间距 */
  letterSpacing?: string;
  /** 对齐 */
  textAlign?: 'left' | 'center' | 'right';
  /** 变换 */
  textTransform?: 'none' | 'uppercase' | 'capitalize';
}

/**
 * 不同文字元素的样式分配。
 * 每个 key 是文字元素名，value 引用 TypeStyle 的 name。
 */
export interface TypeAssignment {
  headline?: string;
  subheadline?: string;
  body?: string;
  cta?: string;
  caption?: string;
  price?: string;
  [custom: string]: string | undefined;
}

/** 字体系统 */
export interface TypographySystem {
  /** 样式库 */
  styles: TypeStyle[];
  /** 元素 → 样式映射 */
  assignment: TypeAssignment;
  /** 整体字体风格说明 */
  description: string;
}

// ══════════════════════════════════════════
// 框样式系统（承载图片 / 卖点的容器）
// ══════════════════════════════════════════

/**
 * 一个框的样式定义。
 * 框是设计师用来承载图片槽位的 CSS 容器。
 * 不同形状的框传达不同的意图——圆形亲切、方形严谨、圆角柔和。
 */
export interface FrameStyle {
  /** 样式名称，供 layout 中的 element 引用 */
  name: string;
  /** 形状 */
  shape: 'circle' | 'rounded-rect' | 'sharp-square' | string;
  /** 圆角 CSS 值 */
  borderRadius: string;
  /** 边框 */
  border?: string;
  /** 阴影 */
  shadow?: string;
  /** 溢出处理：hidden（裁剪内容）/ visible（允许溢出） */
  overflow?: 'hidden' | 'visible';
  /** 大致尺寸 px（不要求精确，设计师根据实际情况调整） */
  approximateSize?: {
    width: number;
    height: number;
  };
  /**
   * 这个框的意图说明。
   * 帮助设计师理解框应该怎么用、素材师理解框里应该放什么。
   * 如 "柔和的产品展示框，适合放护肤品特写"、
   *    "锐利的技术参数框，适合放芯片/数据图"
   */
  intent: string;
  /** 装饰性？纯装饰框不需要图片填充，设计师直接用 CSS 画 */
  decorative?: boolean;
}

/** 框样式系统 */
export interface FrameSystem {
  /** 框样式库 */
  styles: FrameStyle[];
  /** 说明 */
  note?: string;
}

// ══════════════════════════════════════════
// 版面结构（宏观布局）
// ══════════════════════════════════════════

/**
 * 一个元素的版面位置。
 * 粒度在「区域 + 方位」级别，不涉及具体 px。
 * 精确的像素定位和 CSS 实现归设计师 Agent。
 */
export interface ElementPlacement {
  /** 元素类型 */
  type:
    | 'headline'
    | 'subheadline'
    | 'body'
    | 'cta'
    | 'image-slot'
    | 'decoration'
    | 'price'
    | 'logo'
    | string;
  /** 在区域内的位置：居中 / 左上 / 右下 / 全宽 / 偏右 等 */
  placement: string;
  /** 引用的框样式名（FrameStyle.name）。仅 image-slot 类型需要。 */
  frameStyle?: string;
  /**
   * 图片槽位的内容方向（仅 image-slot 类型需要）。
   * 美术指导指定这个槽位里应该放什么内容的图。
   * 设计师 Agent 据此展开为 SlotContent 的完整规格。
   * 如："护肤精华瓶身特写，白色背景，顶部柔光"
   */
  imageContent?: string;
  /** 补充说明，如 "字号应比主标题小两级"、"图片与文字之间有 1/3 重叠" */
  note?: string;
}

/**
 * 一个版面区域。
 * 画面从上到下分成若干个区，每个区有自己的功能和布局方式。
 */
export interface LayoutZone {
  /** 区域标识：如 "hero-header"、"product-showcase"、"cta-footer" */
  name: string;
  /** 在画面中的大致占比，如 "1/3"、"2/5"、"auto（由内容撑开）" */
  proportion: string;
  /** 区域内元素的排列方式：居中堆叠 / 水平分布 / 左右分栏 / 自由 */
  arrangement: string;
  /** 区域内的元素列表 */
  elements: ElementPlacement[];
}

/**
 * 版面结构 —— 美术指导对画面布局的宏观定义。
 * 不是 CSS，而是设计师 Agent 做布局时的「施工图」。
 */
export interface LayoutStructure {
  /** 区域列表（从上到下） */
  zones: LayoutZone[];
  /** 阅读动线：从上到下 / Z 字形 / 中心向外 */
  visualFlow: string;
  /** 视觉重心：哪个区域/元素是画面焦点 */
  focalPoint: string;
  /** 整体说明 */
  note?: string;
}

// ══════════════════════════════════════════
// 间距与留白倾向
// ══════════════════════════════════════════

export interface SpacingSystem {
  /** 基础间距单位 px */
  baseUnit: number;
  /** 策略 */
  strategy: 'loose' | 'moderate' | 'compact';
  /** 区块间间距建议 */
  sectionGap?: string;
  /** 整体容器内边距建议 */
  containerPadding?: string;
}

// ══════════════════════════════════════════
// 图片滤镜与处理（按槽位类型）
// ══════════════════════════════════════════

/**
 * 一个槽位类型的图片处理方案。
 * 不同槽位的图片可能需要完全不同的后期处理：
 * - 产品图要干净还原真实色彩
 * - 背景图要叠加氛围感滤镜
 * - 装饰元素可能要降低饱和度融入整体
 */
export interface ImageTreatment {
  /** 槽位类型标识：如 "product-hero"、"background"、"decoration" */
  slotType: string;
  /** CSS filter 倾向描述，如 "brightness(1.1) saturate(1.2)"、"sepia(0.3) brightness(0.9)" */
  filterStyle?: string;
  /** 叠加色层 hex + 透明度，如 "rgba(0,0,0,0.2)" */
  colorOverlay?: string;
  /** 混合模式 */
  blendMode?: 'normal' | 'multiply' | 'overlay' | 'screen' | 'soft-light';
  /** 说明 */
  note?: string;
}

// ══════════════════════════════════════════
// 视觉元素（通用）
// ══════════════════════════════════════════

export interface VisualElements {
  /** 阴影 */
  shadows?: string;
  /** 圆角 */
  borderRadius?: string;
  /** 边框/分隔 */
  borders?: string;
  /** 装饰元素风格：几何图形 / 有机曲线 / 渐变光晕 / 无 */
  decorativeStyle?: string;
}

// ══════════════════════════════════════════
// 汇总
// ══════════════════════════════════════════

export interface VisualDirection {
  /** 版面结构（宏观布局） */
  layout: LayoutStructure;
  /** 色彩系统 */
  colorSystem: ColorSystem;
  /** 字体系统 */
  typography: TypographySystem;
  /** 框样式系统 */
  frameSystem: FrameSystem;
  /** 间距系统 */
  spacing: SpacingSystem;
  /** 图片处理方案（按槽位类型） */
  imageTreatments: ImageTreatment[];
  /** 通用视觉元素 */
  visualElements: VisualElements;
  /** 整体氛围概述 */
  atmosphere: string;
}
