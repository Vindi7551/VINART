/**
 * **属性面板的字段描述** —— 一个节点"能改什么"，以及"怎么读写它"。
 *
 * ## 这一层为什么单独存在
 *
 * 面板要画出一排输入框，但**画法**和**能改什么**是两件事：
 * - 画法归 UI（现在是 demo 里的原生 DOM，将来可以是 React / 别的壳）；
 * - **能改什么归本文档** —— 它是**文档词汇**的一部分，跟用什么 UI 无关。
 *
 * ⇒ 本文件只给**描述**，不碰任何 DOM。换一套 UI 不用动这里。
 *
 * ## 为什么用 `get` / `set` 函数而不是字符串路径
 *
 * 字符串路径（`'runs[0].fill'`）看着更"数据化"，但解析起来全是坑
 * （数组下标、字段不存在、类型是联合）。这里直接用闭包读写 ——
 * **写的时候编译器帮你检查**，跑的时候也不会解析失败。
 * `path` 只当**标识**用（UI 拿它做 key、探针拿它断言）。
 *
 * ## ⚠️ 刻意**没做**的（不是漏了）
 *
 * - **渐变 / 图案**：只能给纯色输入框（渐变要一个色标编辑器，是另一个量级的东西）。
 *   当前值是渐变时，颜色框显示不出来 —— 这一版**不假装能改**，交给代码改。
 * - **多层填充**（`fill` 是数组）：同上。
 * - 文字的 `runs` 只改**第一段**（多段染色需要一个片段列表 UI）。
 *
 * ## 两类字段（别混）
 *
 * | | 作用范围 | 怎么落到文档 |
 * |---|---|---|
 * | `Field`（`fieldsFor`）| **整个节点** | `set(node, v)` 原地改；面板 `patch(id, path, v)` |
 * | `SelField`（`selectionFields`）| **选中的那几个字** | 只给描述，落地要**切开 runs** ⇒ 由宿主调 `applyRange`（见 `selPatchOf`）|
 *
 * ⚠️ `curve` / `path` 改的是**渲染路径**（普通排版 ↔ SVG `textPath`）——
 * 若那个节点正在被就地编辑（编辑期间会被"摊平"），改完得**退出文字态**才看得到弧线效果。
 * 这条判断在宿主（`src/demo/vector/main.ts`）。
 *
 * `SelField` 不给 `set` 是有意的：它写不进去 —— 写它意味着"在选区两头各切一刀"，
 * 那是 `text-runs.ts` 的活，不是"改一个字段"。硬塞一个 `set(node, v)` 只会让
 * 调用方以为改的是整块。
 */

import type { DesignDocument, Layer, Rect, ShapeNode, TextNode, TextRun } from '../document/vocabulary';
import { DEFAULT_FONT_PX } from '../render/vocabulary/emit';
import { firstRunOf, type RunPatch, type RunRange } from './text-runs';

/**
 * **带位置 / 带外观的节点** —— `GroupNode` 两者都没有
 * （它没有 `rect`，也不画东西），所以凡是读写这些字段的地方都得先把它排除掉。
 */
type Positioned = Exclude<Layer, { type: 'group' }>;

/** 把 `Layer` 收窄成"有外观可改"的那部分（`GroupNode` 已经在调用前被挡掉了） */
const P = (l: Layer) => l as Positioned;

export type FieldKind =
  | { kind: 'number'; min?: number; max?: number; step?: number; suffix?: string }
  | { kind: 'text'; multiline?: boolean }
  | { kind: 'color' }
  | { kind: 'toggle' }
  | { kind: 'enum'; options: string[] };

export interface Field {
  /** 标识（UI 拿它当 key，探针拿它断言）。形如 `'rect.x'` / `'fill'` */
  path: string;
  label: string;
  /** 分组标题（UI 按它把字段分开摆） */
  group: string;
  kind: FieldKind;
  /** 读当前值。**返回 `undefined` = 这一项没写（UI 显示占位）** */
  get(node: Layer): unknown;
  /** 写回节点（**原地改**，调用方负责触发重渲） */
  set(node: Layer, value: unknown): void;
}

const num = (
  path: string,
  label: string,
  group: string,
  get: (n: Layer) => number | undefined,
  set: (n: Layer, v: number) => void,
  o: { min?: number; max?: number; step?: number; suffix?: string } = {},
): Field => ({
  path,
  label,
  group,
  kind: { kind: 'number', ...o },
  get,
  set: (n, v) => set(n, typeof v === 'number' ? v : Number(v) || 0),
});

const text = (
  path: string,
  label: string,
  group: string,
  get: (n: Layer) => string | undefined,
  set: (n: Layer, v: string) => void,
  multiline = false,
): Field => ({
  path,
  label,
  group,
  kind: { kind: 'text', multiline },
  get,
  set: (n, v) => set(n, String(v ?? '')),
});

const color = (
  path: string,
  label: string,
  group: string,
  get: (n: Layer) => string | undefined,
  set: (n: Layer, v: string) => void,
): Field => ({ path, label, group, kind: { kind: 'color' }, get, set: (n, v) => set(n, String(v ?? '')) });

/** 开关（下划线 / 斜体 / 小型大写……） */
const toggle = (
  path: string,
  label: string,
  group: string,
  get: (n: Layer) => boolean | undefined,
  set: (n: Layer, v: boolean) => void,
): Field => ({ path, label, group, kind: { kind: 'toggle' }, get, set: (n, v) => set(n, !!v) });

/** 单选（对齐 / 换行 / 书写方向……）—— 选项写死在 `kind.options` 里 */
const pick = (
  path: string,
  label: string,
  group: string,
  options: string[],
  get: (n: Layer) => string | undefined,
  set: (n: Layer, v: string) => void,
): Field => ({ path, label, group, kind: { kind: 'enum', options }, get, set: (n, v) => set(n, String(v)) });

// ── 位置 / 尺寸：文档里**就是 px**（`Rect` 的单位是画布 px，不需要换算）──
//
// ⚠️ 这里曾经有 4 处 `v / canvas.width`（写）与 `rect.x * canvas.width`（读）——
// 那是 `rect` 还存 0–1 比例时的产物。那一层换算除了啰嗦，还会**丢精度**
// （`round4` 到 4 位小数 ⇒ 900 宽画布上每次 0.09px），而且它是
// "面板显示一个数、set 按另一个单位收" 这类 bug 的温床。
function rectFields(_canvas: { width: number; height: number }): Field[] {
  const has = (n: Layer): n is Layer & { rect: Rect } => 'rect' in n;
  return [
    num('rect.x', '左', '位置', (n) => (has(n) ? n.rect.x : undefined), (n, v) => {
      if (has(n)) n.rect.x = v;
    }, { step: 1, suffix: 'px' }),
    num('rect.y', '上', '位置', (n) => (has(n) ? n.rect.y : undefined), (n, v) => {
      if (has(n)) n.rect.y = v;
    }, { step: 1, suffix: 'px' }),
    num('rect.w', '宽', '位置', (n) => (has(n) ? n.rect.w : undefined), (n, v) => {
      if (has(n)) n.rect.w = Math.max(1, v);
    }, { min: 1, step: 1, suffix: 'px' }),
    num('rect.h', '高', '位置', (n) => (has(n) ? n.rect.h : undefined), (n, v) => {
      if (has(n)) n.rect.h = Math.max(1, v);
    }, { min: 1, step: 1, suffix: 'px' }),
  ];
}

/** 旋转 / 不透明度 —— 任何节点都有 */
function commonFields(): Field[] {
  return [
    num('transform.rotate', '旋转', '变换', (n) => n.transform?.rotate, (n, v) => {
      n.transform = { ...(n.transform ?? {}), rotate: v };
    }, { step: 0.5, suffix: '°' }),
    num('opacity', '不透明度', '变换', (n) => n.opacity, (n, v) => {
      n.opacity = Math.min(1, Math.max(0, v));
    }, { min: 0, max: 1, step: 0.01 }),
  ];
}

/** 形状：填充 / 描边 / 圆角 */
function shapeFields(n: ShapeNode): Field[] {
  const out: Field[] = [
    color('fill', '填充', '外观', (l) => (typeof P(l).fill === 'string' ? (P(l).fill as string) : undefined), (l, v) => {
      P(l).fill = v;
    }),
    color('stroke.paint', '描边色', '外观', (l) => P(l).stroke?.paint, (l, v) => {
      P(l).stroke = { ...(P(l).stroke ?? {}), paint: v };
    }),
    num('stroke.width', '描边粗细', '外观', (l) => P(l).stroke?.width as number | undefined, (l, v) => {
      P(l).stroke = { ...(P(l).stroke ?? {}), width: v };
    }, { min: 0, step: 0.5, suffix: 'px' }),
  ];
  // 圆角只对矩形有意义（椭圆的形状来自 `ellipse`，多边形的轮廓来自它自己的点）
  if (n.kind === 'rect') {
    out.push(
      num('radius', '圆角', '外观', (l) => (typeof P(l).radius === 'number' ? (P(l).radius as number) : undefined), (l, v) => {
        P(l).radius = v;
      }, { min: 0, max: 0.5, step: 0.005 }),
    );
  }
  return out;
}

/** 收窄成文字节点（凡是要改文字字段的地方都得先过一下） */
const T = (l: Layer): TextNode | null => (l.type === 'text' ? l : null);

/**
 * 文字能改什么 —— 分五组：内容 / 字体 / 排版 / 装饰 / 字形。
 *
 * ⚠️ 这里的字段**全部**在编译器（`emit.ts`）里有对应实现 —— 摆出来的框改了都有反应。
 * 反过来，编译器还翻不出的（`curve` 弧形 / `path` 沿路径排字）**不出现在这里**：
 * 不摆"改了没反应"的输入框。
 *
 * ⚠️ 这一层是**元素级**（整块）。某几个字单独换字号/字重/颜色走画布上的**选区**
 * （`selectionFields()`）—— 面板上带"（整块）"字样的，说的就是这件事。
 */
function textFields(node: TextNode, _canvas: { width: number }): Field[] {
  const many = node.runs.length > 1;
  return [
    // ── 内容：**逐片段**（多段文本的编辑入口）──────────────────────
    //    ⚠️ `get` **必须逐片段**。早先只给 `runs[0]` 写了 getter（`(l) => T(l)?.runs[i]?.text`
    //    用的是同一个 i，但面板拿到的是**同一个值**）——多片段的第 2、3 段在面板上
    //    永远是空框，一编辑就写进 `node["runs[1].text"]` 这种脏键。实测 3 段全空。
    ...node.runs.map((_, i) =>
      text(
        `runs[${i}].text`,
        many ? `第 ${i + 1} 段` : '内容',
        '内容',
        (l) => {
          const t = T(l);
          return t?.runs[i]?.text;
        },
        (l, v) => {
          const t = T(l);
          if (t?.runs[i]) t.runs[i].text = v;
        },
        true,
      ),
    ),

    // ── 字体（元素级默认；片段可以各自覆盖）───────────────────────
    text('fontFamily', '字体', '字体', (l) => T(l)?.fontFamily, (l, v) => {
      const t = T(l);
      if (t) t.fontFamily = v || undefined;
    }),
    num(
      'fontSizePx',
      '字号（整块）',
      '字体',
      (l) => (l.type === 'text' ? l.fontSizePx : undefined),
      (l, v) => {
        if (l.type === 'text') l.fontSizePx = Math.max(1, v);
      },
      { min: 1, step: 1, suffix: 'px' },
    ),
    num('weight', '字重（整块）', '字体', (l) => T(l)?.weight, (l, v) => {
      const t = T(l);
      if (t) t.weight = v;
    }, { min: 100, max: 900, step: 100 }),
    toggle('italic', '斜体', '字体', (l) => T(l)?.italic, (l, v) => {
      const t = T(l);
      if (t) t.italic = v || undefined;
    }),
    num('stretch', '横向拉伸', '字体', (l) => T(l)?.stretch, (l, v) => {
      const t = T(l);
      if (t) t.stretch = v;
    }, { min: 0.5, max: 2, step: 0.01 }),
    color('fill', '文字色', '字体', (l) => (typeof P(l).fill === 'string' ? (P(l).fill as string) : undefined), (l, v) => {
      P(l).fill = v;
    }),

    // ── 描边：形状那份落到容器 `outline`，文字这份落到 `-webkit-text-stroke`（字形轮廓）──
    color('stroke.paint', '描边色', '描边', (l) => T(l)?.stroke?.paint, (l, v) => {
      const t = T(l);
      if (t) t.stroke = { ...(t.stroke ?? {}), paint: v };
    }),
    num('stroke.width', '描边粗细', '描边', (l) => T(l)?.stroke?.width as number | undefined, (l, v) => {
      const t = T(l);
      if (t) t.stroke = { ...(t.stroke ?? {}), width: v };
    }, { min: 0, step: 0.5, suffix: 'px' }),

    // ── 排版 ──────────────────────────────────────────────────────
    pick('align', '对齐', '排版', ['left', 'center', 'right', 'justify'], (l) => T(l)?.align, (l, v) => {
      const t = T(l);
      if (t) t.align = v as TextNode['align'];
    }),
    pick('alignLast', '末行对齐', '排版', ['left', 'center', 'right'], (l) => T(l)?.alignLast, (l, v) => {
      const t = T(l);
      if (t) t.alignLast = v as TextNode['alignLast'];
    }),
    num('lineHeight', '行高', '排版', (l) => T(l)?.lineHeight, (l, v) => {
      const t = T(l);
      if (t) t.lineHeight = v;
    }, { min: 0.5, max: 3, step: 0.05 }),
    num('letterSpacing', '字距', '排版', (l) => T(l)?.letterSpacing, (l, v) => {
      const t = T(l);
      if (t) t.letterSpacing = v;
    }, { step: 0.01, suffix: 'em' }),
    num('wordSpacing', '词距', '排版', (l) => T(l)?.wordSpacing, (l, v) => {
      const t = T(l);
      if (t) t.wordSpacing = v;
    }, { step: 0.01, suffix: 'em' }),
    pick('wrap', '换行', '排版', ['nowrap', 'normal'], (l) => T(l)?.wrap, (l, v) => {
      const t = T(l);
      if (t) t.wrap = v as TextNode['wrap'];
    }),
    pick('writingMode', '书写方向', '排版', ['horizontal', 'vertical'], (l) => T(l)?.writingMode, (l, v) => {
      const t = T(l);
      if (t) t.writingMode = v as TextNode['writingMode'];
    }),
    pick('direction', '文字方向', '排版', ['ltr', 'rtl'], (l) => T(l)?.direction, (l, v) => {
      const t = T(l);
      if (t) t.direction = v as TextNode['direction'];
    }),

    // ── 沿路径（**另一条渲染路径**，见 `src/render/vocabulary/README.md`）──
    //    ⚠️ 两者**二选一**：给了 `path` 就以它为准，`curve` 只是"正圆弧"的简写。
    num('curve', '弧形', '沿路径', (l) => T(l)?.curve, (l, v) => {
      const t = T(l);
      if (t) t.curve = v || undefined; // 0 ⇒ 清掉（回到普通排版）
    }, { min: -1, max: 1, step: 0.05 }),
    text('path', '沿路径（d）', '沿路径', (l) => T(l)?.path, (l, v) => {
      const t = T(l);
      if (t) t.path = v.trim() || undefined;
    }),

    // ── 装饰线 ────────────────────────────────────────────────────
    toggle('underline', '下划线', '装饰', (l) => T(l)?.underline, (l, v) => {
      const t = T(l);
      if (t) t.underline = v || undefined;
    }),
    toggle('strike', '删除线', '装饰', (l) => T(l)?.strike, (l, v) => {
      const t = T(l);
      if (t) t.strike = v || undefined;
    }),
    color('decoration.color', '线色', '装饰', (l) => T(l)?.decoration?.color, (l, v) => {
      const t = T(l);
      if (t) t.decoration = { ...(t.decoration ?? {}), color: v };
    }),
    pick(
      'decoration.style',
      '线型',
      '装饰',
      ['solid', 'dashed', 'dotted', 'wavy'],
      (l) => T(l)?.decoration?.style,
      (l, v) => {
        const t = T(l);
        if (t) t.decoration = { ...(t.decoration ?? {}), style: v as NonNullable<TextNode['decoration']>['style'] };
      },
    ),
    num('decoration.thickness', '线粗', '装饰', (l) => T(l)?.decoration?.thickness, (l, v) => {
      const t = T(l);
      if (t) t.decoration = { ...(t.decoration ?? {}), thickness: v };
    }, { min: 0, step: 0.5, suffix: 'px' }),

    // ── 字形 ──────────────────────────────────────────────────────
    pick(
      'textTransform',
      '大小写',
      '字形',
      ['none', 'uppercase', 'lowercase', 'capitalize'],
      (l) => T(l)?.textTransform,
      (l, v) => {
        const t = T(l);
        if (t) t.textTransform = v === 'none' ? undefined : (v as TextNode['textTransform']);
      },
    ),
    toggle('smallCaps', '小型大写', '字形', (l) => T(l)?.smallCaps, (l, v) => {
      const t = T(l);
      if (t) t.smallCaps = v || undefined;
    }),
    text('features', 'OpenType 特性', '字形', (l) => T(l)?.features?.join(', '), (l, v) => {
      const t = T(l);
      if (t) t.features = parseFeatures(v);
    }),
    text('variations', '可变字体轴', '字形', (l) => formatVariations(T(l)?.variations), (l, v) => {
      const t = T(l);
      if (t) t.variations = parseVariations(v);
    }),
    num('baselineShift', '基线偏移', '字形', (l) => T(l)?.baselineShift, (l, v) => {
      const t = T(l);
      if (t) t.baselineShift = v;
    }, { step: 0.01, suffix: 'em' }),
    num('dropCap', '首字下沉', '字形', (l) => T(l)?.dropCap, (l, v) => {
      const t = T(l);
      if (t) t.dropCap = v || undefined;
    }, { min: 0, max: 6, step: 1, suffix: '行' }),
  ];
}

// ── 选区字段：**选中的那几个字**能改什么（多字号 / 多字重 / 颜色）─────
//
// 与 `Field` 的关键差别：**没有 `set`**。
// 改"选中的几个字"不是"给某个字段赋值"，而是**把 runs 在选区两头切开**
// ⇒ 那是 `text-runs.ts applyToRange` 的事，由宿主调 `editor.applyRange`。
// 本层只管三件事：① 有哪些可改项 ② 当前值读什么 ③ 面板值怎么换算成 `RunPatch`。

/** 字重档位（100–900，与 CSS `font-weight` 的常用档一致） */
const WEIGHT_STEPS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];

// ── 两个"文本 ⇄ 结构"的小转换（元素级与选区级共用，免得两处各写一遍）──

/** `'liga, smcp'` → `['liga','smcp']`；空 ⇒ `undefined`（= 不覆盖） */
function parseFeatures(v: string): string[] | undefined {
  const a = v.split(',').map((s) => s.trim()).filter(Boolean);
  return a.length ? a : undefined;
}

/** `'wght=427, wdth=90'` → `{wght:427, wdth:90}`；空 / 全非法 ⇒ `undefined` */
function parseVariations(v: string): Record<string, number> | undefined {
  const rec: Record<string, number> = {};
  for (const part of v.split(',')) {
    const [k, x] = part.split('=');
    const key = (k ?? '').trim();
    const n = Number(x);
    if (key && Number.isFinite(n)) rec[key] = n;
  }
  return Object.keys(rec).length ? rec : undefined;
}

/** `{wght:427}` → `'wght=427'`（给面板显示用） */
const formatVariations = (v: Record<string, number> | undefined): string =>
  v ? Object.entries(v).map(([k, x]) => `${k}=${x}`).join(', ') : '';

/**
 * 一个片段**实际用的字号**（px）：片段覆盖 > 元素级 > 渲染器兜底。
 *
 * ⚠️ 文档里存的**就是 px** ⇒ 不再乘画布宽。兜底值与 `emit.ts` 的 `DEFAULT_FONT_PX` 同源。
 */
function textPx(run: TextRun | undefined, node: TextNode): number {
  return run?.fontSizePx ?? node.fontSizePx ?? DEFAULT_FONT_PX;
}

/** 一个"只作用于选区"的可改项 */
export interface SelField {
  /** 标识，一律 `sel.` 前缀（与节点级字段的 `path` 区分开） */
  path: string;
  label: string;
  kind: FieldKind;
  /**
   * 读**选区起点所在片段**的**生效值**（片段没写就继承元素级默认）。
   *
   * ⚠️ 选区跨了几段、各段值又不一样时，显示**起点那一段**的值 —— 和 Word 一致
   * （它显示的是选区第一个字符的格式）。不显示"混合"是因为一个数字框表达不了它，
   * 写个空反而让人以为"不能改"。
   */
  get(run: TextRun | undefined, node: TextNode, canvas: { width: number }): unknown;
}

/**
 * 面板要画的一项：字段描述 + **它此刻的生效值**。
 *
 * 两者必须成对给出去：只有 `path` 没值 ⇒ 面板画不出当前状态（空框会骗人，见
 * `EditPanel` 那次"取值走 `path.split('.')`"的教训）；只有值没 `kind` ⇒ 画不出正确的控件。
 */
export interface SelectionValue {
  path: string;
  label: string;
  kind: FieldKind;
  /** 生效值（片段覆盖 → 元素级 → 硬默认） */
  value: unknown;
}

/**
 * **一次文字选区的快照** —— 给样式面板用。
 *
 * 收成一个快照而不是让面板自己到处问：面板每次重画只调一次，
 * 拿到的 `fields` 与 `text` / 定位信息**天然是同一时刻的**（不会一半新一半旧）。
 *
 * ⚠️ 一次性：选区或文档一变就得重新取。
 */
export interface SelectionSnapshot {
  /** 哪个文字节点（多段文字时面板要显示"正在改哪一块"） */
  layerId: string;
  /** 选中的那几个字（面板上显示出来，让人确认选对了） */
  text: string;
  /** 绝对字符下标（打日志 / 探针断言用） */
  abs: { start: number; end: number } | null;
  /** 选中的字能改什么 + 此刻的值 */
  fields: SelectionValue[];
}

/**
 * 选中的字能改什么 —— 顺序即面板上的顺序。
 *
 * ⚠️ 这里的项与 `TextRun` 的字符级字段一一对应（见 `vocabulary.ts` 的划分依据）：
 * **凡是 Word 里"选中几个字就能设"的，这里都该有** —— 只有字号/字重/颜色是不够的
 * （下划线、删除线、斜体、字距、上下标、大小写在小段文字上是再普通不过的操作）。
 *
 * 面板显示的是**最终生效值**（片段覆盖 → 元素级 → 硬默认）。开关类写回时给的是
 * **显式 `false`**（= "明确不要"），而不是"删掉这个键" —— 三态语义见 `selPatchOf`。
 */
export function selectionFields(): SelField[] {
  return [
    {
      path: 'sel.fontSizePx',
      label: '字号',
      kind: { kind: 'number', min: 1, step: 1, suffix: 'px' },
      get: (run, node) => textPx(run, node),
    },
    {
      path: 'sel.fontFamily',
      label: '字体',
      kind: { kind: 'text' },
      get: (run, node) => run?.fontFamily ?? node.fontFamily ?? '',
    },
    {
      path: 'sel.weight',
      label: '字重',
      kind: { kind: 'enum', options: WEIGHT_STEPS },
      get: (run, node) => String(Math.round(run?.weight ?? node.weight ?? 400)),
    },
    {
      path: 'sel.italic',
      label: '斜体',
      kind: { kind: 'toggle' },
      get: (run, node) => run?.italic ?? node.italic ?? false,
    },
    {
      path: 'sel.stretch',
      label: '横向拉伸',
      kind: { kind: 'number', min: 0.5, max: 2, step: 0.01 },
      get: (run, node) => run?.stretch ?? node.stretch ?? 1,
    },
    {
      path: 'sel.fill',
      label: '颜色',
      kind: { kind: 'color' },
      get: (run, node) => run?.fill ?? (typeof node.fill === 'string' ? node.fill : ''),
    },
    {
      path: 'sel.underline',
      label: '下划线',
      kind: { kind: 'toggle' },
      get: (run, node) => run?.underline ?? node.underline ?? false,
    },
    {
      path: 'sel.strike',
      label: '删除线',
      kind: { kind: 'toggle' },
      get: (run, node) => run?.strike ?? node.strike ?? false,
    },
    // ── 装饰线的长相（**逐项**覆盖元素级，不是整对象替换）──
    {
      path: 'sel.decoration.color',
      label: '线色',
      kind: { kind: 'color' },
      get: (run, node) => run?.decoration?.color ?? node.decoration?.color ?? '',
    },
    {
      path: 'sel.decoration.style',
      label: '线型',
      kind: { kind: 'enum', options: ['solid', 'dashed', 'dotted', 'wavy'] },
      get: (run, node) => run?.decoration?.style ?? node.decoration?.style ?? 'solid',
    },
    {
      path: 'sel.decoration.thickness',
      label: '线粗',
      kind: { kind: 'number', min: 0, step: 0.5, suffix: 'px' },
      get: (run, node) => run?.decoration?.thickness ?? node.decoration?.thickness ?? 0,
    },
    {
      path: 'sel.letterSpacing',
      label: '字距',
      kind: { kind: 'number', step: 0.01, suffix: 'em' },
      get: (run, node) => run?.letterSpacing ?? node.letterSpacing ?? 0,
    },
    {
      path: 'sel.wordSpacing',
      label: '词距',
      kind: { kind: 'number', step: 0.01, suffix: 'em' },
      get: (run, node) => run?.wordSpacing ?? node.wordSpacing ?? 0,
    },
    {
      path: 'sel.baselineShift',
      label: '上下标',
      kind: { kind: 'number', step: 0.02, suffix: 'em' },
      get: (run, node) => run?.baselineShift ?? node.baselineShift ?? 0,
    },
    {
      path: 'sel.textTransform',
      label: '大小写',
      kind: { kind: 'enum', options: ['none', 'uppercase', 'lowercase', 'capitalize'] },
      get: (run, node) => run?.textTransform ?? node.textTransform ?? 'none',
    },
    {
      path: 'sel.smallCaps',
      label: '小型大写',
      kind: { kind: 'toggle' },
      get: (run, node) => run?.smallCaps ?? node.smallCaps ?? false,
    },
    {
      path: 'sel.features',
      label: 'OpenType 特性',
      kind: { kind: 'text' },
      get: (run, node) => (run?.features ?? node.features)?.join(', ') ?? '',
    },
    {
      path: 'sel.variations',
      label: '可变字体轴',
      kind: { kind: 'text' },
      get: (run, node) => {
        const v = run?.variations ?? node.variations;
        return v ? Object.entries(v).map(([k, x]) => `${k}=${x}`).join(', ') : '';
      },
    },
  ];
}

/**
 * 面板上的值 → `RunPatch`。
 *
 * **这里不再有任何单位换算** —— 文档与面板**同一个单位（px）**。
 * 返回 `null` = 这个值不该落到文档上（空输入框等），调用方直接跳过。
 *
 * ⚠️ **开关类故意写显式 `false`，不写 `undefined`**：
 * `underline: false` 是"明确不要下划线"（用来**取消**元素级的整块下划线），
 * 而 `undefined` 是"跟随元素级"。两者在 `text-runs.ts` 的判等里是**不同**的样式。
 */
export function selPatchOf(path: string, value: unknown, _canvas?: { width: number }): RunPatch | null {
  if (path === 'sel.fontSizePx') {
    if (String(value).trim() === '') return null;
    const px = Number(value);
    if (!Number.isFinite(px)) return null;
    return { fontSizePx: Math.max(1, px) };
  }
  if (path === 'sel.fontFamily') {
    // 清空输入框 = "别覆盖了，跟随元素级" ⇒ 写 `undefined`（判等里与"没写"等价）
    const s = String(value ?? '').trim();
    return { fontFamily: s || undefined };
  }
  if (path === 'sel.weight') {
    const w = Number(value);
    if (!Number.isFinite(w) || String(value).trim() === '') return null;
    return { weight: Math.min(900, Math.max(100, Math.round(w))) };
  }
  if (path === 'sel.stretch') {
    if (String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? { stretch: Math.max(0.5, Math.min(2, n)) } : null;
  }
  if (path === 'sel.fill') {
    const s = String(value ?? '').trim();
    return s ? { fill: s } : null;
  }
  // ── 开关：显式 boolean（三态里的"要"与"明确不要"）──────────────
  if (path === 'sel.italic') return { italic: !!value };
  if (path === 'sel.underline') return { underline: !!value };
  if (path === 'sel.strike') return { strike: !!value };
  if (path === 'sel.smallCaps') return { smallCaps: !!value };
  // ── 装饰线：**逐项**覆盖（不是整对象替换 —— 只改线色时线型仍跟随元素级）──
  if (path === 'sel.decoration.color') {
    const s = String(value ?? '').trim();
    return { decoration: { color: s || undefined } };
  }
  if (path === 'sel.decoration.style') {
    const s = String(value ?? '').trim();
    return { decoration: { style: s ? (s as NonNullable<TextNode['decoration']>['style']) : undefined } };
  }
  if (path === 'sel.decoration.thickness') {
    if (String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? { decoration: { thickness: Math.max(0, n) } } : null;
  }
  // ── 数值（em）─────────────────────────────────────────────
  if (path === 'sel.letterSpacing' || path === 'sel.wordSpacing' || path === 'sel.baselineShift') {
    if (String(value).trim() === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (path === 'sel.letterSpacing') return { letterSpacing: n };
    if (path === 'sel.wordSpacing') return { wordSpacing: n };
    return { baselineShift: n };
  }
  if (path === 'sel.textTransform') {
    const v = String(value ?? '').trim();
    return v ? { textTransform: v as RunTextTransform } : null;
  }
  if (path === 'sel.features') return { features: parseFeatures(String(value ?? '')) };
  if (path === 'sel.variations') return { variations: parseVariations(String(value ?? '')) };
  return null;
}

/** 大小写那四个值（从词汇取，免得两处写死不同步） */
type RunTextTransform = NonNullable<TextRun['textTransform']>;

/**
 * 这个节点**能改哪些字段**。
 *
 * ⚠️ 只返回"这一版真的能改"的 —— 翻不出来的东西（渐变、多层填充）**不假装能改**，
 * 免得面板上摆一排输入框，改了却没反应。
 *
 * ⚠️ **组**只给「变换」（旋转 / 不透明度）：它没有 `rect`，也没有 `fill`/`stroke`/`shadow`。
 *    （`blend` / `filter` / `clip` / `mask` 这些**所有节点**都还没有入口，属另一批。）
 */
export function fieldsFor(node: Layer, canvas: { width: number; height: number }): Field[] {
  // ⭐ 组没有 `rect`（不给位置尺寸），但它**有一组效果**（整体旋转 / 淡出 / 滤镜…）——
  //    那正是"组"存在的理由，不给入口就等于这功能不存在。
  if (node.type === 'group') return commonFields();
  const out: Field[] = [...rectFields(canvas), ...commonFields()];
  if (node.type === 'shape') out.push(...shapeFields(node));
  if (node.type === 'text') out.push(...textFields(node, canvas));
  if (node.type === 'image') {
    out.push(
      text('asset', '素材', '图片', (l) => (l.type === 'image' ? l.asset : undefined), (l, v) => {
        if (l.type === 'image') l.asset = v;
      }),
      {
        path: 'fit',
        label: '裁切',
        group: '图片',
        kind: { kind: 'enum', options: ['cover', 'contain', 'fill'] },
        get: (l) => (l.type === 'image' ? (l.fit ?? 'cover') : undefined),
        set: (l, v) => {
          if (l.type === 'image') l.fit = v as 'cover' | 'contain' | 'fill';
        },
      },
    );
  }
  return out;
}

/** 按 `path` 找字段（UI 回写、编辑器 `patch` 都用它） */
export function findField(node: Layer, canvas: { width: number; height: number }, path: string): Field | null {
  return fieldsFor(node, canvas).find((f) => f.path === path) ?? null;
}

// ⚠️ 这里曾有一个 `round4`（比例保留 4 位小数）—— 面板写文档时的"px → 0–1"换算
//    已经整个消失（`rect` / `fontSizePx` 都直接是 px），它也就没人用了。


/** 面板标题（给 UI 显示"正在改谁"） */
export function nodeLabel(node: Layer): string {
  if (node.type === 'shape') return `形状 · ${node.kind}`;
  if (node.type === 'text') return '文字';
  if (node.type === 'image') return '图片';
  if (node.type === 'svg') return 'SVG';
  return '组';
}

/** 用文档自身的画布尺寸（省得调用方每次都拆一遍） */
export function fieldsOfDoc(doc: DesignDocument, id: string | null): Field[] {
  if (!id) return [];
  const node = doc.layers.find((l) => l.id === id);
  return node ? fieldsFor(node, doc.canvas) : [];
}

/**
 * ⭐ **造一份"文字选区快照"**（样式面板的唯一输入）。
 *
 * 关键点：`fields` 与 `text` / 定位信息在**同一次调用里**算出来 —— 不会出现
 * "值是新选区的、文字标签还是旧选区的"这种半新半旧。
 *
 * `get` 口径与 `selectionFields` 完全一致（选区起点那一段的生效值；跨段时显示第一段，
 * 与 Word 一致）。折叠的光标（`selRange === null`）返回 `null` —— **没选字就没什么可改的**。
 */
export function selectionSnapshotOf(
  node: TextNode,
  range: RunRange | null,
  abs: { start: number; end: number } | null,
  text: string,
  canvas: { width: number },
): SelectionSnapshot | null {
  if (!range) return null;
  const run0 = node.runs[firstRunOf(node.runs, range)];
  return {
    layerId: node.id,
    text,
    abs,
    fields: selectionFields().map((f) => ({
      path: f.path,
      label: f.label,
      kind: f.kind,
      value: f.get(run0, node, canvas),
    })),
  };
}
