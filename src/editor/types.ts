/**
 * 编辑器层的**契约**。
 *
 * 只放「编辑器自己需要知道的最小形状」——**不** import `src/ui/types.ts`，
 * 免得核心层反向依赖 React 外壳（依赖方向必须是 `ui → editor`）。
 * 两者靠**结构类型**对齐：`PreviewPanel` 把 `LayoutSpec` 传进来时由 `tsc` 兜底，
 * 不兼容就编译不过。
 *
 * ⚠️ 本目录有一条可机器断言的不变量（见 `src/editor/README.md` 与
 * `docs/EDITOR-EVOLUTION.md` §5.1）：**不引用任何全局网页对象**——
 * 所有文档对象都必须从参数流入，编辑器不认识"当前页面"是谁。
 * 这条断言用一条 grep 就能跑（命令写在 README 里，免得本文件自己被扫到）。
 */

// ══════════════════════════════════════════════════════════════════════
// 数据（与 design-sketch / design-appearance 同形）
// ══════════════════════════════════════════════════════════════════════

/** 0–1 比例矩形（相对画布）。语义与 `design-sketch.ts` 的 `Rect` 完全一致。 */
export interface EditorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 视觉变换 —— **不参与布局计算**（对齐/网格全按 rect）。 */
export interface EditorTransform {
  rotate?: number;
  skewX?: number;
  origin?: { x: number; y: number };
}

export interface EditorLayer {
  id: string;
  /** `'image' | 'text' | 'shape'`（留成 string 是为了结构兼容 UI 侧的宽松视图） */
  type: string;
  rect: EditorRect;
  text?: string | string[];
  fontScale?: number;
  weight?: number;
  curve?: number;
  transform?: EditorTransform;
  [key: string]: unknown;
}

export interface EditorSpec {
  canvas: { width: number; height: number };
  layers: EditorLayer[];
  [key: string]: unknown;
}

export interface EditorLayerAppearance {
  color?: string;
  fill?: string;
  opacity?: number;
  accent?: { words: string[]; color: string };
  accents?: Array<{ words: string[]; color: string }>;
  [key: string]: unknown;
}

export interface EditorAppearance {
  /** 可省 —— 与 `ui/types.ts` 的宽松视图同形，便于结构兼容 */
  layers?: Record<string, EditorLayerAppearance>;
  [key: string]: unknown;
}

/** 手势落定时上报给宿主的**增量**。字段缺席 = 不改这一项。
 *  带索引签名是为了能直接喂给宿主的通用合并函数（`Record<string, unknown>`）。 */
export interface LayerPatch {
  rect?: EditorRect;
  text?: string | string[];
  fontScale?: number;
  weight?: number;
  color?: string;
  fill?: string;
  opacity?: number;
  rotate?: number;
  accent?: { words: string[]; color: string };
  accents?: Array<{ words: string[]; color: string }>;
  [key: string]: unknown;
}

// ══════════════════════════════════════════════════════════════════════
// 文档抽象（架构约束的落点）
// ══════════════════════════════════════════════════════════════════════

/**
 * **子文档的素接口**。`Document` / `ShadowRoot` / 测试假对象都满足它。
 *
 * 这是"编辑器只能改子文档"的**结构性**保证：编辑器拿不到别的文档，
 * 因为除了这个参数它没有任何入口。**不是**沙箱强制的（沙箱会把编辑器逼回注入）。
 *
 * ⚠️ 只允许作为**参数**出现，绝不取全局的那一个（否则不变量立刻破功，
 * 断言命令见 `src/editor/README.md`）。
 */
export interface LayerDom {
  querySelector(selectors: string): Element | null;
  querySelectorAll(selectors: string): ArrayLike<Element>;
  elementFromPoint(x: number, y: number): Element | null;
}

/**
 * **宿主文档**（父页面）—— 覆盖层画在这里、键盘也在这里听。
 *
 * 与 `LayerDom` 分开，是为了让"覆盖层在父文档、内容在子文档"这件事
 * 在类型上就写死：想混用也混不了。
 */
export interface HostDom extends LayerDom {
  createElement(tagName: string): HTMLElement;
  addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
}

// ══════════════════════════════════════════════════════════════════════
// 几何 / 指针
// ══════════════════════════════════════════════════════════════════════

/** 画布坐标系里的点（local px，左上角为原点） */
export interface LocalPoint {
  x: number;
  y: number;
}

/** 画布坐标系里的盒子（local px） */
export interface LocalBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type HandleDir = 'nw' | 'ne' | 'sw' | 'se';

export const HANDLE_DIRS: readonly HandleDir[] = ['nw', 'ne', 'sw', 'se'];

/**
 * 视口 —— 画布在**页面**坐标里的位置与缩放。
 *
 * 有了它，`event.clientX/Y`（页面坐标）→ 画布 local 只需一次换算，
 * 且**只有这一处**除以 `zoom`（旧实现把 `/zoom` 写进了位移公式，是 bug）。
 */
export interface Viewport {
  /** 画布左上角在页面坐标里的位置 */
  originX: number;
  originY: number;
  /** 显示缩放 = 画布实宽 ÷ 画布逻辑宽 */
  zoom: number;
}

/** 命中的第一段先说装饰件，第二段才轮到内容 */
export type Hit =
  | { kind: 'handle'; dir: HandleDir }
  | { kind: 'rotate' }
  | { kind: 'layer'; id: string }
  | { kind: 'empty' };

// ══════════════════════════════════════════════════════════════════════
// 手势会话（一次手势 = 一个事务；M2 的撤销以它为粒度）
// ══════════════════════════════════════════════════════════════════════

export interface MoveSession {
  kind: 'move';
  /** 手势起点（来自 **state**，不是从渲染产物读回来的） */
  start: LocalBox;
  /** 按下时的指针位置（local px） */
  origin: LocalPoint;
}

export interface ResizeSession {
  kind: 'resize';
  dir: HandleDir;
  start: LocalBox;
  origin: LocalPoint;
}

export interface RotateSession {
  kind: 'rotate';
  /** 旋转中心（local px） */
  center: LocalPoint;
  /** 按下时"中心→指针"的角度（度） */
  angle0: number;
  /** 起始角度（度） */
  rotate0: number;
}

export type GestureSession = MoveSession | ResizeSession | RotateSession;
