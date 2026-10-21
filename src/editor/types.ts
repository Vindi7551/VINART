/**
 * 编辑器层的**契约**。
 *
 * 只放「编辑器自己需要知道的最小形状」——**不** import `src/ui/types.ts`，
 * 免得核心层反向依赖 React 外壳（依赖方向必须是 `ui → editor`）。
 *
 * 与 `src/document/vocabulary.ts` 的词汇**结构同形**（rect 是 0–1 比例等）——
 * 但类型在这里独立声明：编辑器只依赖"最小形状"，不依赖词汇全文。
 *
 * ⚠️ 本目录有一条可机器断言的不变量（见 `src/editor/README.md`）：**不引用任何
 * 全局网页对象**——所有文档对象都必须从参数流入，编辑器不认识"当前页面"是谁。
 *
 * （旧链遗留区——EditorLayer/EditorSpec/*Appearance/LayerPatch/GestureSession——
 *   已随旧编辑器 `index.ts` 一起退役删除：它们只服务于已作废的
 *   design-sketch / design-appearance 契约。2026-10-15 清理。）
 */

// ══════════════════════════════════════════════════════════════════════
// 数据（与词汇 `ElementBase.rect` 结构同形）
// ══════════════════════════════════════════════════════════════════════

/**
 * 矩形（**画布 px**）。与词汇 `ElementBase.rect` **结构同形**。
 *
 * ⚠️ 早先这里是 0–1 比例（"手势算 px、落定回写比例"），**已经没这回事了** ——
 *    `rect` 在文档里直接就是画布 px，两边同一套单位，不来回换算。
 */
export interface EditorRect {
  x: number;
  y: number;
  w: number;
  h: number;
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
 *
 * ## 就地改字为什么要的那几样（2026-10-15 补）
 *
 * 「在画面上打字」需要往**子文档**上挂事件、并读它**自己的**选区：
 * - `addEventListener` / `removeEventListener`：`beforeinput` / `compositionend` /
 *   `paste` / `cut` / `mouseup` / `keyup` / `keydown` 都挂在子文档上
 *   （⚠️ 焦点在 iframe 里时，按键**不经过父页面** —— 只挂父文档会永远收不到）；
 * - `defaultView`：选区 API（`getSelection` / `Range`）是 **window** 上的，
 *   必须用**子文档自己的** window。`document.getSelection()` 在 Chrome 里返回的是
 *   顶层文档的选区（对 `designMode` 的 iframe 才会转发）⇒ 读它拿到的可能是父页面的选区。
 *   取子文档的 window **仍然是"从参数流入"**，不是全局取用。
 *
 * 三者都是**可选**的：纯几何/手势那套（拖拽、顶点、覆盖层）不需要它们，
 * 不提供时文字就地编辑会自己降级（不崩，只是不能打字）。
 */
export interface LayerDom {
  querySelector(selectors: string): Element | null;
  querySelectorAll(selectors: string): ArrayLike<Element>;
  elementFromPoint(x: number, y: number): Element | null;
  addEventListener?(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
  removeEventListener?(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
  /** 子文档自己的 window（选区 / Range 从这里拿） */
  readonly defaultView?: SubWindowLike | null;
}

/**
 * 子文档 window 的**最小形状** —— 只要就地改字用到的那几样。
 *
 * 显式声明而不是用 `Window`，有两个原因：
 * ① 不变量"不引用任何全局网页对象"要求这里是**从参数流入**的类型，不是全局类型；
 * ② 测试的假 DOM 只要满足这几样就能驱动整条打字链路（不必造一个真 window）。
 */
export interface SubWindowLike {
  getSelection(): SelectionLike | null;
}

/** 选区的最小形状（`Selection` 的子集；`isCollapsed` / `anchorNode` 是记账必需） */
export interface SelectionLike {
  readonly isCollapsed: boolean;
  readonly anchorNode: Node | null;
  readonly anchorOffset: number;
  removeAllRanges(): void;
  addRange(range: Range): void;
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
