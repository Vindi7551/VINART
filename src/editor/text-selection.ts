/**
 * **浏览器选区 → 文档里的字符下标**。
 *
 * ## 这一层为什么单独存在
 *
 * Word 式染色的前半段是"**用户在画面上拖了哪几个字**"—— 这件事只能问浏览器
 * （`getSelection()`）。但浏览器回答的是「**哪个 DOM 节点**的第几个字符」，
 * 而我们改的是**文档里的 `runs`**。中间必须翻译一次。
 *
 * 翻译的两端：
 *
 * | | 说的是谁 | 例子 |
 * |---|---|---|
 * | 浏览器 | DOM 里的文本节点 | `SPAN[data-run=0]` 里第 5 个字符 |
 * | 文档 | `runs[0].text` 的第 5 个字符 | `'Akazienholz'[5]` |
 *
 * ⇒ 靠 `emit.ts` 给每个片段打的那个 **`data-run="i"`** 对上号。
 *
 * ## ⚠️ 本文件不认识"当前页面"
 *
 * 子文档（`root`）和 `Selection` **都从参数进来** —— `src/editor/` 有一条
 * 「不引用任何全局网页对象」的不变量（grep 可查，命令在 `README.md`）。
 * 调用方（demo / 将来的正式界面）负责把 `iframe.contentWindow.getSelection()`
 * 递进来。好处：这段翻译逻辑**不绑死在某个页面上**，换个壳照样用。
 */

import type { LayerDom } from './types';
import { orderEnds, type RunRange } from './text-runs';

/** 3 = 文本节点。**不写 `Node.TEXT_NODE`** —— 那要取全局的 `Node` */
const TEXT_NODE = 3;

/**
 * 浏览器 `Selection` 的**最小形状**（真 `Selection` 天然满足）。
 * 只声明用到的四个字段 —— 这样纯测试里造个假对象也能跑。
 */
export interface DomSelectionLike {
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
  /** 没拖（只是点了一下）= 空选区。可选：有的环境下不给 */
  isCollapsed?: boolean;
}

/** 一个字符位置落回了文档里的哪里 */
export interface ResolvedPoint {
  /** 所属层（文字所在那个节点）—— 用来判断"是不是在同一段文字里选" */
  layerId: string | null;
  run: number;
  offset: number;
}

/** 一次选区（已排好序，`from <= to`） */
export interface SelectionRange {
  layerId: string | null;
  range: RunRange;
}

function asElement(n: Node | null): Element | null {
  return n && n.nodeType === 1 ? (n as Element) : null;
}

/**
 * 从光标所在的节点往上找**带 `data-run` 的那个 span**。
 *
 * 光标可能落在：
 * - 片段里的文本节点（最常见）⇒ 它的父节点就是那个 span；
 * - span 自己（offset 是"第几个子节点"）；
 */
function runElementOf(node: Node | null): Element | null {
  let el = node && node.nodeType === TEXT_NODE ? (node.parentElement ?? null) : asElement(node);
  while (el) {
    if (el.getAttribute('data-run') !== null) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * 一个子节点**算几个字符**。
 *
 * ⚠️ `<br>` 是元素、自己不含文字，但它**代表文字里的一个 `\n`** ⇒ 算 1 个。
 * 不算它的话，带换行的片段里，换行之后的字下标会全部偏掉。
 */
function childCharLen(k: ChildNode): number {
  if (k.nodeType === TEXT_NODE) return (k.nodeValue ?? '').length;
  return asElement(k)?.tagName === 'BR' ? 1 : 0;
}

/** span 里一共有几个字符（`textContent.length` 会漏掉换行，不能直接用它） */
function runCharLen(span: Element): number {
  let n = 0;
  const kids = span.childNodes;
  for (let i = 0; i < kids.length; i++) n += childCharLen(kids[i]);
  return n;
}

/** 把 DOM 里的「节点 + 偏移」换算成「这个片段里的第几个字符」 */
function offsetInRun(span: Element, node: Node | null, offset: number): number {
  let acc = 0;
  const kids = span.childNodes;
  for (let i = 0; i < kids.length; i++) {
    // 光标"在 span 自己身上"时，`offset` 指的是第几个子节点 ⇒ 走到那儿就停
    if (node === span && i === offset) return acc;
    const k = kids[i];
    if (k === node) return acc + offset; // 光标在这个文本节点里
    acc += childCharLen(k);
  }
  return acc; // 落在末尾（或 offset 超出了子节点数）
}

function layerIdOf(el: Element | null): string | null {
  return el?.closest('[data-layer]')?.getAttribute('data-layer') ?? null;
}

/**
 * 这个片段**属不属于**当前子文档。
 *
 * ⚠️ 不是多余的检查：重渲一次，子文档就是**另一份**了，上一次留下的节点
 * 全是"孤儿"。不挡这一下，拿着孤儿去改文档，改出来的是错的还查不出原因。
 */
function belongs(root: LayerDom, el: Element): boolean {
  const all = root.querySelectorAll('[data-run]');
  for (let i = 0; i < all.length; i++) if (all[i] === el) return true;
  return false;
}

/**
 * ⭐ 一个字符位置 → `runs` 里的下标。
 *
 * 返回 `null` = 这个位置**不在任何文字片段里**（点到了空白、点到了别的层）。
 */
export function resolvePoint(root: LayerDom, node: Node | null, offset: number): ResolvedPoint | null {
  if (!node) return null;

  const span = runElementOf(node);
  if (span) {
    if (!belongs(root, span)) return null;
    const run = Number(span.getAttribute('data-run'));
    if (!Number.isFinite(run)) return null;
    return {
      layerId: layerIdOf(span),
      run,
      offset: offsetInRun(span, node, offset),
    };
  }

  /**
   * 兜底：光标落在**文字容器上但不在任何片段里**（拖到文字末尾外面一点时常见）。
   * 这时按"在第几个子节点之前"贴到**开头**或**末尾** —— 不让选区白白消失。
   */
  const host = node.nodeType === TEXT_NODE ? node.parentElement : asElement(node);
  const fit = host?.closest('[data-fit]') ?? null;
  if (!fit) return null;
  const spans = Array.from(fit.querySelectorAll('[data-run]')) as Element[];
  if (!spans.length) return null;
  const idx = offset === 0 ? 0 : spans.length - 1;
  if (!belongs(root, spans[idx])) return null;
  return {
    layerId: layerIdOf(fit),
    run: idx,
    offset: offset === 0 ? 0 : runCharLen(spans[idx]),
  };
}

/**
 * ⭐ 一次浏览器选区 → 文档里的选区。
 *
 * 返回 `null` 的几种情况（**都是"不该改文档"，不是错误**）：
 * - 空选区（只点了一下，没拖）；
 * - 有一头不在文字片段里；
 * - **跨层**（从这段文字拖到另一个节点上）——这一版不做。
 */
export function selectionToRange(root: LayerDom, sel: DomSelectionLike | null): SelectionRange | null {
  if (!sel || !sel.anchorNode || !sel.focusNode) return null;
  if (sel.isCollapsed) return null;

  const a = resolvePoint(root, sel.anchorNode, sel.anchorOffset);
  const b = resolvePoint(root, sel.focusNode, sel.focusOffset);
  if (!a || !b) return null;

  // 同一段文字里才谈得上"选区"
  if (a.layerId && b.layerId && a.layerId !== b.layerId) return null;
  if (a.run === b.run && a.offset === b.offset) return null;

  return {
    layerId: a.layerId ?? b.layerId,
    range: orderEnds({ run: a.run, offset: a.offset }, { run: b.run, offset: b.offset }),
  };
}

// ══════════════════════════════════════════════════════════════════════
// 反向：文档里的选区 → 浏览器选区
//
// 为什么需要反向：改一次样式就会**重渲**（子文档整个换掉），浏览器那边
// 选区自然没了。不恢复的话，用户每调一次字号都得**重新拖一遍** ——
// 而调字号恰恰是要连按几次的事。
// ══════════════════════════════════════════════════════════════════════

/**
 * 片段里"第 n 个字符"在 DOM 上的位置（`node` + `offset`，可直接喂 `Range.setStart`）。
 *
 * ⚠️ `<br>` 这个分支**必须两边都管**（实测踩过）：
 * 它代表文字里的一个 `\n`，算 1 个字符 ——
 * - 位置**落在它前面**（`off === acc`）⇒ 贴到 `<br>` 之前；
 * - 位置**吃掉了它**（`off === acc + 1`）⇒ 贴到 `<br>` **之后**。
 *
 * 只写"贴到前面"那一半的后果：光标在**末尾**（`\n` 之后）时会被放到 `\n` **之前**，
 * 于是退格删掉的是前一个正常字符 —— 表现是"删了个莫名其妙的字，换行还在"。
 */
function domPointInSpan(span: Element, off: number): { node: Node; offset: number } {
  let acc = 0;
  const kids = span.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    const len = childCharLen(k);
    if (off <= acc) return { node: span, offset: i }; // 落在这个子节点**之前**
    if (off < acc + len) return { node: k, offset: off - acc }; // 落在文本节点**内部**
    if (off === acc + len) {
      // 正好在这一个"字符"的末尾
      return k.nodeType === TEXT_NODE
        ? { node: k, offset: len } // 文本节点：停在它末尾
        : { node: span, offset: i + 1 }; // `<br>`：**贴到它后面**
    }
    acc += len;
  }
  return { node: span, offset: kids.length };
}

/** 这个子文档里、**属于该层**的所有片段 span 按 `data-run` 归位 */
function runSpansOf(root: LayerDom, layerId: string | null): Map<number, Element> {
  const out = new Map<number, Element>();
  const all = root.querySelectorAll('[data-run]');
  for (let i = 0; i < all.length; i++) {
    const el = all[i] as Element;
    if (!belongs(root, el)) continue;
    if (layerId && layerIdOf(el) !== layerId) continue;
    const idx = Number(el.getAttribute('data-run'));
    if (Number.isFinite(idx) && !out.has(idx)) out.set(idx, el);
  }
  return out;
}

/** 要往哪个 `Selection` 上写 —— 只声明用到的那两个方法（真 `Selection` 天然满足） */
export interface DomSelectionTarget {
  removeAllRanges(): void;
  addRange(range: Range): void;
}

/**
 * ⭐ **把文档里的选区画回浏览器** —— 重渲之后调它。
 *
 * `doc` 要显式传：`LayerDom` 是**收窄过的**接口（只有 `querySelector*` 与
 * `elementFromPoint`，故意不暴露 `ownerDocument`）—— 建 `Range` 要的那个文档对象
 * 由调用方给出，本模块依旧不认识"当前页面"是谁。
 *
 * `layerId` 也**必须给**：多个文字节点的片段编号都是从 0 开始的，
 * 不给层就可能在另一段文字里圈出几个字。
 *
 * 返回 `false` = 没画成（层没了 / 片段没了），调用方当"没选区"处理。
 */
export function rangeToSelection(
  doc: Document,
  root: LayerDom,
  sel: DomSelectionTarget | null,
  layerId: string | null,
  range: RunRange,
): boolean {
  if (!sel) return false;

  const spans = runSpansOf(root, layerId);
  const a = spans.get(range.from.run);
  const b = spans.get(range.to.run);
  if (!a || !b) return false;

  const pa = domPointInSpan(a, range.from.offset);
  const pb = domPointInSpan(b, range.to.offset);

  const r = doc.createRange();
  r.setStart(pa.node, pa.offset);
  r.setEnd(pb.node, pb.offset);
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}
