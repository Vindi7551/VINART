/**
 * **翻译器** —— `DesignIntent`（比例） → `DesignDocument`（px）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 它为什么存在
 * ══════════════════════════════════════════════════════════════════════
 *
 * 链路上有两种"单位"的需求，**互斥**：
 *
 * ```
 *   LLM 只会写比例   ← 它不知道画布多大；写 "0.06"（左边留 6%）它能做，
 *                       写 "54px" 它会算错 —— 这是 0–1 设计的原始动因
 *   编辑器 / 编译器要 px ← 它们写的是 DOM（`left:54px`）
 * ```
 *
 * ⇒ 必须有一个"**换算发生的那一刻**"，而且只能有**一处**。
 *    那就是本文件。
 *
 * ## ⚠️ 换算只做两件事，第三件事是"什么都别做"
 *
 * | 字段 | 分母 | 翻译器做什么 |
 * |---|---|---|
 * | `rect.x/y/w/h` | **画布** | ✅ 比例 × 画布 → px |
 * | `fontScale`（元素级 + 片段级） | **画布宽** | ✅ 比例 × 画布宽 → `fontSizePx` |
 * | `points` · `path.d` | **它自己的盒子** | ❌ **原样透传** |
 * | `radius` · `shadow.offset/blur/spread` | **盒子短边** | ❌ 原样透传 |
 * | `letterSpacing` · `baselineShift` | **字号（em）** | ❌ 原样透传 |
 * | `lineHeight` | 字号倍数 | ❌ 原样透传 |
 * | `transform.origin` | **`rect` 自身** | ❌ 原样透传 |
 *
 * **最后那几行不是"暂时没做"，是永远不能做**：
 * 它们的分母是**用户正在拖的那个盒子**（或字号），一旦固化成 px，
 * 拖框缩放时形状就不会跟着变了。判据见 `src/document/README.md` §二。
 *
 * ## 为什么第③列里还有"实测"没做
 *
 * 纯算术的换算不需要"层"——几行乘法而已。翻译器真正不可替代的职责是
 * **把"量出来的值"固化进文档**（文字装不下时实测字号）。
 * 那一步需要浏览器，见 ⚠️ 文件末的"待办"。
 */

import type {
  Canvas,
  DesignDocument,
  GroupNode,
  ImageNode,
  /** ⚠️ 名字带 Node 后缀：`Element` 会和 DOM 全局的 `Element` 撞名 */
  ElementNode,
  /** 元素的基础字段（`id` / `rect` / 外观）—— intent 那几个类型都从它派生 */
  ElementBase,
  ShapeNode,
  TextNode,
  TextRun,
  VisualBase,
} from '../../document/vocabulary';
// ⚠️ 兜底字号 / 扁平→图层的折叠规则都从**文档模型**取，不自己写一份（理由见文件末那条 note）。
import { DEFAULT_FONT_PX, wrapIntoLayers } from '../../document/vocabulary';

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
export type IntentTextNode = Omit<TextNode, 'rect' | 'fontSizePx' | 'runs' | 'type'> &
  IntentElementBase & { type: 'text'; runs: IntentTextRun[] };

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
export type IntentImageNode = IntentElementBase & { type: 'image'; asset: string; fit?: ImageNode['fit']; render?: ImageNode['render']; position?: ImageNode['position'] };
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

// ══════════════════════════════════════════════════════════════════════
// ② 产出与问题
// ══════════════════════════════════════════════════════════════════════

/**
 * 一条"输入有问题"的记录。
 *
 * ⚠️ 与 `emit.ts` 的 `EmitIssue` 是**两个阶段**的同类东西：
 * 那个说"这个词汇渲染不出来"，这个说"**这份输入翻译不了 / 翻了会出事**"。
 * `level: 'error'` 的条目**不该被忽略**——它意味着产出的文档有问题。
 */
export interface IntentIssue {
  /** 哪个节点（画布级问题用 `'<canvas>'`） */
  id: string;
  /** 哪个字段（如 `'rect.w'` / `'runs[1].fontScale'`） */
  field: string;
  /** `error` = 会导致文档不成立；`note` = 能翻但值得提醒 */
  level: 'error' | 'note';
  message: string;
}

export interface TranslateResult {
  /** ⚠️ 有 `error` 级 issue 时它**仍然返回**——但调用方应当先看 `issues` */
  doc: DesignDocument;
  issues: IntentIssue[];
}

// ══════════════════════════════════════════════════════════════════════
// ③ 换算
// ══════════════════════════════════════════════════════════════════════

/**
 * 保留 **2 位小数**。
 *
 * 为什么不是整数：`rect` 是 px，但**亚像素是合法的**，而且翻译是**一次性**的
 * ——这里丢掉的精度再也补不回来（不像编辑器，下次拖动会重写）。
 * 2 位足够（60 万分之一的画布宽），又不会把 JSON 写成科学计数法。
 */
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** 比例 → 画布宽 px */
const byW = (ratio: number, W: number): number => r2(ratio * W);
/** 比例 → 画布高 px */
const byH = (ratio: number, H: number): number => r2(ratio * H);

// ══════════════════════════════════════════════════════════════════════
// ④ 翻译
// ══════════════════════════════════════════════════════════════════════

/** 主入口。纯函数：不读盘、不开浏览器、不碰模型。 */
export function translate(intent: DesignIntent): TranslateResult {
  const issues: IntentIssue[] = [];
  const W = intent.canvas.width;
  const H = intent.canvas.height;

  const err = (id: string, field: string, message: string) =>
    issues.push({ id, field, level: 'error', message });
  const note = (id: string, field: string, message: string) =>
    issues.push({ id, field, level: 'note', message });

  // ── 画布：换算的分母，先把它自己查干净 ──
  if (!Number.isFinite(W) || W <= 0) err('<canvas>', 'canvas.width', `画布宽必须是正数，实为 ${W}`);
  if (!Number.isFinite(H) || H <= 0) err('<canvas>', 'canvas.height', `画布高必须是正数，实为 ${H}`);
  // 换算分母不合法时，后面全是 NaN —— 直接返回空文档，别产出垃圾
  if (W <= 0 || H <= 0 || !Number.isFinite(W) || !Number.isFinite(H)) {
    return { doc: { canvas: intent.canvas, layers: [] }, issues };
  }

  const seen = new Set<string>();

  /** 比例 rect → px rect */
  const rectOf = (id: string, r: Rect01 | undefined) => {
    if (!r) {
      err(id, 'rect', '缺少 `rect`（位置尺寸）—— 除了 group，每个节点都必须有');
      return { x: 0, y: 0, w: 0, h: 0 };
    }
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      if (!Number.isFinite(r[k])) err(id, `rect.${k}`, `必须是有限数，实为 ${r[k]}`);
    }
    if (r.w <= 0 || r.h <= 0) {
      err(id, 'rect.w/h', `宽高必须是正数（${r.w} × ${r.h}）—— 否则元素不可见`);
    }
    // ⚠️ 画布外不算错：留白、故意出血都合法，只是提醒
    if (r.x < 0 || r.y < 0 || r.x + r.w > 1.0001 || r.y + r.h > 1.0001) {
      note(id, 'rect', `超出画布范围（x=${r.x} y=${r.y} w=${r.w} h=${r.h}）—— 会被裁掉一部分`);
    }
    return { x: byW(r.x, W), y: byH(r.y, H), w: byW(r.w, W), h: byH(r.h, H) };
  };

  const checkId = (id: string, where: string) => {
    if (!id) {
      err(where, 'id', '缺少 `id`');
      return;
    }
    if (seen.has(id)) err(id, 'id', `id 重复（'${id}'）—— 编辑器与分层截图都靠它定位`);
    seen.add(id);
  };

  /** 字号：比例 → px（片段覆盖 > 元素级 > 默认） */
  const fontPxOf = (id: string, field: string, scale: number | undefined): number | undefined => {
    if (scale === undefined) return undefined;
    if (!Number.isFinite(scale) || scale <= 0) {
      err(id, field, `字号比例必须是正数，实为 ${scale}`);
      return undefined;
    }
    if (scale > 0.5) note(id, field, `字号比例 ${scale} 偏大（= ${Math.round(scale * W)}px）—— 确认不是把 px 当比例写了`);
    return Math.round(scale * W); // 字号取整：亚像素字号在渲染上只会造成抖动
  };

  const textNode = (n: IntentTextNode): TextNode => {
    const { fontScale, runs, ...rest } = n;
    const fontSizePx = fontPxOf(n.id, 'fontScale', fontScale);
    if (!runs?.length) err(n.id, 'runs', '文字至少要有一个片段（`runs` 不能为空）');
    const outRuns: TextRun[] = (runs ?? []).map((r, i) => {
      const { fontScale: rs, ...runRest } = r;
      const px = fontPxOf(n.id, `runs[${i}].fontScale`, rs);
      return px === undefined ? { ...runRest } : { ...runRest, fontSizePx: px };
    });
    return {
      ...rest,
      rect: rectOf(n.id, n.rect),
      ...(fontSizePx === undefined ? {} : { fontSizePx }),
      runs: outRuns,
    } as TextNode;
  };

  /** 形状 / 图片 / 图标：只换 rect（其余字段与文档**逐字段相同**，包括 points / radius / shadow） */
  const plainNode = <T extends IntentShapeNode | IntentImageNode | IntentSvgNode>(n: T) => {
    const { fontScale: _drop, ...rest } = n as T & { fontScale?: number };
    return { ...rest, rect: rectOf(n.id, n.rect) };
  };

  const groupNode = (n: IntentGroupNode): GroupNode => {
    // ⚠️ 组**没有 `rect`**（范围 = 子元素并集）⇒ 这里不换算任何坐标。
    //    ⚠️ 组自己的 id **不在这里校验** —— 由 `element()` 统一过一遍，
    //       否则嵌套组会被查两次，报出假的"id 重复"。
    return {
      ...n,
      elements: n.children.map((c, i) => element(c, `${n.id}.children[${i}]`)),
    } as GroupNode;
  };

  /**
   * @param where 出问题时报的位置路径（嵌套时形如 `grp.children[2]`）——
   *   比裸下标有用得多：模型看到它才知道该改哪儿。
   */
  const element = (l: IntentLayer, where: string): ElementNode => {
    checkId(l.id, where);
    switch (l.type) {
      case 'text':
        return textNode(l);
      case 'image':
      case 'svg':
      case 'shape':
        return plainNode(l) as ElementNode;
      case 'group':
        return groupNode(l);
      default: {
        // ⚠️ 联合是**完全判别**的，所以这里 `l` 收窄成 `never` ——
        //    只有"运行时传来了类型系统不知道的东西"（模型写错 `type`）才会走到这。
        //    所以按 `unknown` 处理，而不是假装它还有字段。
        const bad = l as { type?: unknown; id?: unknown };
        err(
          typeof bad.id === 'string' && bad.id ? bad.id : where,
          'type',
          `未知节点类型 ${JSON.stringify(bad.type)} —— 只认 text / image / svg / shape / group`,
        );
        // 兜底：产出一个"不可见但类型合法"的节点，免得整份文档崩在类型上
        return {
          id: typeof bad.id === 'string' && bad.id ? bad.id : `bad-${where}`,
          type: 'shape',
          kind: 'rect',
          rect: { x: 0, y: 0, w: 1, h: 1 },
        } as ShapeNode;
      }
    }
  };

  // ⭐ intent 里是**扁平的一串元素**，文档里是**画布 → 图层 → 元素** ⇒ 用那条共用规则折一次。
  //    规则本身在 `vocabulary.wrapIntoLayers`（迁移脚本用的是同一份，不许各写一遍）。
  const elements = intent.layers.map((l, i) => element(l, `<layer[${i}]>`));
  const layers = wrapIntoLayers(elements);

  // ── 全局提醒：默认字号（免得"我没设字号"变成沉默行为） ──
  // ⚠️ 判据必须和渲染器的兜底链**逐段一致**：`run.fontSizePx ?? node.fontSizePx ?? DEFAULT_FONT_PX`
  //    ⇒ **两边都空**才算"没写字号"。只看元素级会把"只给了片段级"误报成没写
  //    （作者明明写了 36px，却被通知"你没写字号" ⇒ 纯噪声；而 notes 是给模型的反馈通道，
  //     报错了它会去修一个本来没问题的东西，报多了它就学会无视 notes）。
  const anyTextWithoutSize = elements.some(
    (l) => l.type === 'text' && l.fontSizePx === undefined && !l.runs.some((r) => r.fontSizePx !== undefined),
  );
  if (anyTextWithoutSize) {
    // ⚠️ 兜底值是**绝对 px、与画布宽无关**。曾经这里写的是 `0.03 × 画布宽`（比例时代的残留）——
    //    在 1440 画布上对模型报 **43px**，而渲染器实际用的是 **27px**：对着模型报假数字。
    note('<canvas>', 'fontScale', `有文字没写字号 ⇒ 渲染器用兜底 ${DEFAULT_FONT_PX}px（绝对 px，与画布宽无关）`);
  }

  return { doc: { canvas: intent.canvas, layers }, issues };
}

// ══════════════════════════════════════════════════════════════════════
// ⑤ 便利函数
// ══════════════════════════════════════════════════════════════════════

/** 只看错误级问题是否为空 */
export const isTranslatable = (r: TranslateResult): boolean =>
  !r.issues.some((i) => i.level === 'error');

/** 人类可读的问题清单（给工具返回 / 日志用） */
export function formatIssues(r: TranslateResult): string {
  if (!r.issues.length) return '✓ 没有问题';
  return r.issues
    .map((i) => `${i.level === 'error' ? '✗' : '·'} [${i.id}] ${i.field}: ${i.message}`)
    .join('\n');
}
