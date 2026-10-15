/**
 * **文字片段（run）的选区运算** —— 纯函数，不碰 DOM。
 *
 * ## 它解决什么
 *
 * 词汇里，一段文字是**一串片段**（`runs`），每个片段自带颜色 / 字号 / 字重：
 * 「多色 / 多字号 / 多字重，全靠它 —— 只有一个颜色时 `runs` 就只有一个元素，
 * **没有"单色"这个特例**」（见 `vocabulary.ts` 的 `TextRun`）。
 *
 * ⇒ 想做到「**我选中哪几个字，就只改那几个字**」（Word 那样），本质上就是：
 *
 * ```
 * 原来：[ Akazienholz Schneidebrett ]
 * 选中：       ^^^^^^^^^
 * 之后：[ Akaz | ienhol | z Schneidebrett ]
 *               ↑ 只有它带新颜色
 * ```
 *
 * 也就是**在选区两头各切一刀，把中间那段单拎出来上色**。
 * 选区可以跨片段 —— 那就在涉及的每个片段里各切一刀。
 *
 * ## 为什么单独一个文件
 *
 * 这套运算**只跟数据有关**，跟"选区是用鼠标拖出来的、还是程序给的"无关。
 * ⇒ 纯函数，可以脱离浏览器直接验。DOM 那一头在 `text-selection.ts`。
 */

import type { TextRun } from '../document/vocabulary';

/** 「第几个片段的第几个字符」（`offset` = 字符下标，不是像素） */
export interface RunPoint {
  run: number;
  offset: number;
}

/** 一段选区。**恒满足 `from <= to`**（用 `orderEnds` 造出来，别自己拼） */
export interface RunRange {
  from: RunPoint;
  to: RunPoint;
}

/** 能往选区上刷什么 —— 除 `text` 之外，`TextRun` 的每个字段都能刷 */
export type RunPatch = Partial<Omit<TextRun, 'text'>>;

/**
 * 除 `text` 之外那些字段（**样式**）。两个片段"长得一样不一样"只看这些。
 *
 * ⚠️ **必须与 `TextRun` 的样式字段保持一一对应** ——
 * 漏掉一个键的后果很具体：两个下划线不同的段会被判成"同款"而**合并**，
 * 某一段的下划线就这么没了（而且看不出来是哪儿丢的）。
 *
 * ⚠️ 判等必须把 `undefined` 和"没这个键"当成一回事 ——
 * `{fill:undefined}` 和 `{}` 是同一个样式，不然合并同款时会漏。
 * 反过来 **`false` 与 `undefined` 是两回事**（`underline:false` = 明确不要下划线）。
 */
const STYLE_KEYS = [
  'fill',
  'fontFamily',
  'fontSizePx',
  'weight',
  'italic',
  'stretch',
  // ── 同样是字符级（2026-10-14 从元素级移进来）──
  'underline',
  'strike',
  'decoration',
  'letterSpacing',
  'wordSpacing',
  'baselineShift',
  'textTransform',
  'smallCaps',
  'features',
  'variations',
] as const;

/** 两个样式值算不算同一个（`decoration` / `features` / `variations` 是对象 / 数组 ⇒ 要**深比较**） */
function sameVal(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a === b) return true;
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function styleOf(r: TextRun): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of STYLE_KEYS) {
    const v = r[k];
    if (v !== undefined) o[k] = v;
  }
  return o;
}

/** 两个片段的**样式**是否完全一样（不看文字内容） */
export function sameStyle(a: TextRun, b: TextRun): boolean {
  for (const k of STYLE_KEYS) {
    if (!sameVal(a[k], b[k])) return false;
  }
  return true;
}

/** 整段文字（`runs` 拼起来）—— 给 UI 显示 / 给探针断言 */
export function plainText(runs: readonly TextRun[]): string {
  return runs.map((r) => r.text).join('');
}

/** 选区里**到底是哪几个字**（给 UI 显示"你选中了 …"，也给探针断言） */
export function sliceText(runs: readonly TextRun[], range: RunRange): string {
  const segs: string[] = [];
  for (let i = range.from.run; i <= range.to.run && i < runs.length; i++) {
    const t = runs[i].text;
    const s = i === range.from.run ? range.from.offset : 0;
    const e = i === range.to.run ? range.to.offset : t.length;
    segs.push(t.slice(s, e));
  }
  return segs.join('');
}

/**
 * 把两个端点排成 `from <= to`。
 *
 * ⚠️ **必须走这一步**：浏览器给的 `Selection` 有 `anchor` 和 `focus` 之分 ——
 * 从右往左拖选时 `anchor` 在**后面**。不排序的话选区会被算成"空"或"整段"。
 */
export function orderEnds(a: RunPoint, b: RunPoint): RunRange {
  const before = a.run < b.run || (a.run === b.run && a.offset <= b.offset);
  return before ? { from: a, to: b } : { from: b, to: a };
}

/**
 * 把下标夹回合法范围（浏览器给的 offset 偶尔会正好压在边界外）。
 * 返回 `null` = 这个片段下标根本不存在 ⇒ 调用方当作"没选区"。
 */
function clampPoint(p: RunPoint, runs: readonly TextRun[]): RunPoint | null {
  if (p.run < 0 || p.run >= runs.length) return null;
  const len = runs[p.run].text.length;
  const offset = Math.max(0, Math.min(len, p.offset));
  return { run: p.run, offset };
}

/** 在 `at` 处把一段切成两段（**样式两边各带一份**） */
export function splitRun(run: TextRun, at: number): [TextRun, TextRun] {
  const a = at < 0 ? 0 : at > run.text.length ? run.text.length : at;
  return [
    { ...run, text: run.text.slice(0, a) },
    { ...run, text: run.text.slice(a) },
  ];
}

/**
 * **去掉空段 + 合并相邻的同款段**。
 *
 * 为什么必须做：切一刀就多一段，连着刷几次色，`runs` 会越切越碎
 * （「Akaz」「ien」「hol」…），文档变得没法读，也没法再合并回去。
 * ⇒ 每次改完都归一次档，**相邻且样式相同的段拼回去**。
 */
export function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue; // 空段不要（切在两头时会切出空串）
    const prev = out[out.length - 1];
    if (prev && sameStyle(prev, r)) {
      // 合并：文字拼起来，样式沿用（两边本来就一样）
      out[out.length - 1] = { ...prev, text: prev.text + r.text };
      continue;
    }
    out.push({ ...r });
  }
  return out;
}

/**
 * ⭐ **给选区刷样式** —— 本文件的主角。
 *
 * 做法：涉及的每个片段里，按选区边界切成「前 / 中 / 后」三块，
 * **只给"中"那块套 `patch`**，然后 `normalizeRuns` 归档。
 *
 * | 情形 | 结果 |
 * |---|---|
 * | 选区在片段中间 | 一段变三段（`前 · 中(新色) · 后`）|
 * | 选区正好覆盖整段 | 那一段整体改色，**不会**被切碎 |
 * | 选区跨了几个片段 | 每个片段各自切一刀 |
 * | 选区是空的（没拖动）| **原样返回**（空选区 = 没操作，不许偷偷合并）|
 * | **字符**下标越界 | 夹回那一段的头 / 尾（拖到文字外面一点儿很常见）|
 * | **片段**下标越界 | **原样返回** —— 宁可不动，也不许拿着对不上的下标改错地方 |
 */
export function applyToRange(runs: readonly TextRun[], range: RunRange, patch: RunPatch): TextRun[] {
  const from = clampPoint(range.from, runs);
  const to = clampPoint(range.to, runs);
  if (!from || !to) return runs.map((r) => ({ ...r }));

  const a = from.run < to.run || (from.run === to.run && from.offset <= to.offset) ? from : to;
  const b = a === from ? to : from;

  // 空选区：什么都没选中 ⇒ 不动（连合并都不做，保持"没操作"的语义）
  if (a.run === b.run && a.offset === b.offset) return runs.map((r) => ({ ...r }));

  const out: TextRun[] = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (i < a.run || i > b.run) {
      out.push({ ...r });
      continue;
    }
    const len = r.text.length;
    const s = i === a.run ? a.offset : 0;
    const e = i === b.run ? b.offset : len;
    if (s > 0) out.push({ ...r, text: r.text.slice(0, s) });
    if (e > s) out.push({ ...r, ...patch, text: r.text.slice(s, e) });
    if (e < len) out.push({ ...r, text: r.text.slice(e) });
  }
  return normalizeRuns(out);
}

/** 样式的**指纹**（给探针断言 / 调试用：同款片段指纹相同） */
export function styleKey(r: TextRun): string {
  return JSON.stringify(styleOf(r));
}

// ══════════════════════════════════════════════════════════════════════
// 绝对字符下标 —— 跨重渲保住选区
//
// ⚠️ 为什么不能只记 `RunRange`：**改一次样式，`runs` 就被切开**
//    （"Akazienholz…" → "Akazi" · "enhol" · "z …"），片段编号重排 ——
//    上一次记的 `{run:0, offset:5}` 事后指的可能完全是别的字。
//    但"**整段文字里的第 5 到第 10 个字符**"这个事实不随切开而改变。
//    ⇒ 想「连着调几次字号，选区一直还在」，就得用绝对下标记它。
// ══════════════════════════════════════════════════════════════════════

/** `(片段, 下标)` → **整段文字里的第几个字符**。片段下标不存在 ⇒ `null` */
export function pointToAbs(runs: readonly TextRun[], p: RunPoint): number | null {
  if (p.run < 0 || p.run >= runs.length) return null;
  let acc = 0;
  for (let i = 0; i < p.run; i++) acc += runs[i].text.length;
  const len = runs[p.run].text.length;
  return acc + Math.max(0, Math.min(len, p.offset));
}

/**
 * 绝对下标 → `(片段, 下标)`。
 *
 * ⚠️ 下标正好落在**段与段的接缝**上时，归**前一段的末尾**（`{run:i, offset:len}`）——
 * 这样 `pointToAbs(absToPoint(x)) === x` 恒成立，往返不漂。
 * 对 `applyToRange` 两种写法等价（端点都是"取到第几个字符之前"）。
 */
export function absToPoint(runs: readonly TextRun[], abs: number): RunPoint | null {
  if (!runs.length) return null;
  let acc = 0;
  for (let i = 0; i < runs.length; i++) {
    const len = runs[i].text.length;
    if (abs <= acc + len) return { run: i, offset: Math.max(0, abs - acc) };
    acc += len;
  }
  const last = runs.length - 1;
  return { run: last, offset: runs[last].text.length };
}

/** 绝对区间 → `RunRange`。重渲之后用它把选区**在新 runs 上**重新算出来 */
export function rangeFromAbs(runs: readonly TextRun[], start: number, end: number): RunRange | null {
  const a = absToPoint(runs, Math.min(start, end));
  const b = absToPoint(runs, Math.max(start, end));
  if (!a || !b) return null;
  return orderEnds(a, b);
}

/**
 * 选区里**第一个真正被选中的片段**。
 *
 * ⚠️ 为什么需要它：起点的下标**正好压在段尾**时（`offset === 该段长度`），
 * 起点那段其实一个字都没选中 —— 真正被选中的是**下一段**。
 * 例：切开后选区是 `0:5 → 1:5`，它覆盖的只有 `runs[1]` 的前 5 个字；
 * 这时候问"选中部分用的什么字号"，得看 `runs[1]`，看 `runs[0]` 会读到前一段的格式。
 *
 * 控件显示当前值、以及"这段实际多大字号"都以它为准。
 */
export function firstRunOf(runs: readonly TextRun[], range: RunRange): number {
  const i0 = Math.max(0, Math.min(range.from.run, runs.length - 1));
  // 只有**跨段**的选区才谈得上"起点落在段尾、真正选中的在下一段"
  if (range.to.run <= i0) return i0;
  let i = i0;
  while (i < range.to.run && range.from.offset >= runs[i].text.length) i++;
  return i;
}
