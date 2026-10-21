/**
 * 0–1 比例契约 —— `DesignIntent`（翻译器的输入）。
 *
 * 2026-10-18 从 `workflow/translate/translate.ts` 拆出：**这里只放契约，不放实现**。
 * `translate()` 仍在 workflow；`planToIntent()` 在 `plan.ts`。
 *
 * 为什么需要这一层：LLM 不知道画布多大，只会写比例；`DesignIntent` 就是
 * “完整词汇表的 0–1 版”——`rect` 是比例、`fontScale` 是画布宽的比例，
 * 其余字段与 `vocabulary.ts` 逐字段相同。翻译器负责把它换成 px。
 *
 * ⚠️ 它**不是 AI 的受限 plan**：AI 看到的是 `SketchPlan`（子集）；
 * `planToIntent()` 把子集补成完整的 `DesignIntent`，再交给 `translate()`。
 */

import type {
  Canvas,
  ElementBase,
  GroupNode,
  ImageNode,
  TextNode,
  TextRun,
  VisualBase,
} from '../document/vocabulary';

// ══════════════════════════════════════════════════════════════════════
// ① 意图（比例版）
// ══════════════════════════════════════════════════════════════════════

/** 位置尺寸（**0–1 比例，相对画布**）—— `Rect` 的比例版 */
export interface Rect01 {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 文字位置（**0–1 比例，相对画布**）—— `TextFrame` 的比例版；没有 h */
export interface TextFrame01 {
  x: number;
  y: number;
  w: number;
}

/**
 * **哪些字段是"分母 = 画布"的** —— 只有这两个（族）：
 *
 * - `rect`：位置尺寸（x/w 除画布宽，y/h 除画布高）
 * - `fontSizePx`：字号（除画布宽）
 *
 * ⚠️ 这张表是**整份翻译器的规格**。往里头加字段之前，先回答：
 * **它的分母会被用户的编辑动作改变吗？**
 * 会（盒子 / 短边 / 字号）⇒ **不许加进来**，它必须留在比例形态。
 */
type CanvasRelative = {
  rect: Rect01;
  /** 字号：0–1，相对**画布宽**（沿用旧名 `fontScale`，因为这就是它的含义） */
  fontScale?: number;
};

/**
 * ⚠️ 为什么要显式写回 `type`：`Omit` 产出的对象类型会**丢掉判别联合的判别能力**
 * （`switch (l.type)` 收不窄），于是每个 `case` 里的 `l` 还是整个联合。
 * 把 `type` 显式重新声明在顶层，"按 `type` 收窄"才成立。
 */
type IntentElementBase = Omit<ElementBase, 'rect'> & CanvasRelative;
type IntentVisualBase = VisualBase;

export type IntentTextRun = Omit<TextRun, 'fontSizePx'> & { fontScale?: number };
export type IntentTextNode = Omit<TextNode, 'fontSizePx' | 'runs' | 'type' | 'frame'> & {
  /** 文字位置是 frame（0–1，无 h）——不是 rect */
  frame: TextFrame01;
  fontScale?: number;
  type: 'text';
  runs: IntentTextRun[];
};

/**
 * ⚠️ **形状必须逐个几何写**，不能 `Omit<ShapeNode, …>` 一把过。
 *
 * `ShapeNode` 是 `ElementBase & ShapeGeometry & { type: 'shape' }` —— 一个**交叉类型**，
 * 而 `ShapeGeometry` 又是按 `kind` 判别的联合。`Omit` 作用在交叉类型上会把它
 * **压成一个对象类型**，`kind` 的判别能力随之消失（`points` / `d` 都读不到了）。
 *
 * ⇒ 这里按 `ShapeGeometry` 的形状**逐个**声明。
 * ⚠️ **词汇表将来加新几何时，这里要跟着加**（否则那个几何的字段会掉出意图类型）。
 */
export type IntentShapeNode = IntentElementBase &
  (
    | { kind: 'rect' }
    | { kind: 'ellipse' }
    | { kind: 'polygon'; points: Array<[number, number]> }
    | { kind: 'path'; d: string }
  ) & { type: 'shape' };
export type IntentImageNode = IntentElementBase & {
  type: 'image';
  asset: string;
  fit?: ImageNode['fit'];
  render?: ImageNode['render'];
  position?: ImageNode['position'];
};
export type IntentSvgNode = IntentElementBase & { type: 'svg'; asset: string };
export type IntentGroupNode = IntentVisualBase &
  Pick<GroupNode, 'transform' | 'opacity' | 'blend' | 'clip' | 'mask' | 'backdrop' | 'filter'> & {
    type: 'group';
    id: string;
    children: IntentLayer[];
  };

export type IntentLayer =
  | IntentTextNode
  | IntentImageNode
  | IntentSvgNode
  | IntentShapeNode
  | IntentGroupNode;

/** 翻译器的**输入**：一份用比例写的文档 + 它打算画在多大的画布上 */
export interface DesignIntent {
  /** 画布尺寸（**px**——这是唯一的绝对量，也是所有换算的分母） */
  canvas: Canvas;
  layers: IntentLayer[];
}
