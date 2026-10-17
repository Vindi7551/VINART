/**
 * **文字就地编辑** —— 「在画面上打字 / 选字 / 改样式」这一整套。
 *
 * ## 为什么它住在编辑器里，而不是宿主里
 *
 * 老链把这一步放在**宿主侧的适配器**（`target.ts` 的 `setEditable`）里，
 * 编辑器换新时整条掉了（`target.ts` 现在是孤儿，`vocab-editor.ts` 里
 * `contentEditable` 出现 0 次）——**于是"双击文字能打字"在生产界面上直接不存在**。
 *
 * 判据很简单：**谁已经有这个职责、谁手里已经有这份数据**。
 * 双击进文字态本来就是编辑器做的（`onDblClick` → `enterTextEdit`），
 * 让那块文字变成可编辑、把敲键翻成 `runs` 的改动，**是同一件事的后半段**。
 * ⇒ 所以它归编辑器。**宿主只剩一件碰不到的事**：把 iframe 的 `pointer-events` 放开
 *   （那是宿主的 DOM，编辑器按不变量拿不到）。
 *
 * ## 真源永远是文档，DOM 只是"画出来的结果"
 *
 * | 谁 | 管什么 |
 * |---|---|
 * | 浏览器 | 光标、方向键、拖选、输入法 —— 全部交给它（自绘光标要重写一遍文字布局量算，不值） |
 * | 本模块 | 拦 `beforeinput` → 翻译成"文档里第几个字符处插一段"；就地补 DOM；记光标/选区 |
 *
 * ⚠️ **唯一一处"从 DOM 读回文字"**是输入法组合结束（组合期的 `beforeinput`
 * 不可取消，浏览器已经真改了 DOM）。而且**只读文字、不读样式**。
 *
 * ## 本模块不认识"当前页面"
 *
 * 子文档（`root`）、它自己的 window、以及所有回调**都从参数流入** ——
 * `src/editor/` 有一条「不引用任何全局网页对象」的不变量（grep 可查）。
 * 选区用的是**子文档自己的** `window.getSelection()`（从 `root.defaultView` 拿）。
 *
 * 实现是从 `src/demo/vector/main.ts` 那份**已验证能跑**的宿主绑定搬过来的
 * （多字号片段、选区染色、粘贴/剪切、输入法对齐、Esc/撤销拦截都跟着来了）。
 */

import type { TextNode, TextRun } from '../document/vocabulary';
import { emitRunsHtml } from '../render/vocabulary/emit';
import { selPatchOf } from './inspector';
import { deleteRange as deleteRunRange, insertText as insertRunText, replaceRunText } from './text-edit';
import { applyToRange, pointToAbs, rangeFromAbs, sliceText, type RunPatch, type RunRange } from './text-runs';
import { rangeToSelection, resolvePoint, selectionToRange, type DomSelectionLike } from './text-selection';
import type { LayerDom, SelectionLike } from './types';

/** 绝对字符下标区间（"整段文字里的第几个字符"）—— 光标也是它（`start === end`） */
export interface AbsRange {
  start: number;
  end: number;
}

/**
 * 本模块要的那份"编辑器" —— 只列真正用到的成员。
 *
 * 这样它**不依赖 `vocab-editor.ts` 的整体形状**（不产生循环 import），
 * 也让探针能拿一个薄壳直接驱动整条打字链路。
 */
export interface TextHost {
  /** 当前子文档（重渲之后会换一份，所以每次都要现取） */
  root(): LayerDom;
  /** 按 id 找文字节点（递归，含组内）；不是文字 ⇒ `null` */
  textNode(id: string | null): TextNode | null;
  /**
   * 画布宽。
   *
   * ⚠️ 现在**只剩"给 `selPatchOf` 传个上下文"这一个用途** —— 文档单位改成 px 之后，
   * 字号之类都不再需要它换算。（保留是为了将来万一又出现"相对画布"的字段。）
   */
  canvasWidth(): number;
  /** 数据改完之后的落地（`vocab-editor` 传自己的 `onChange` / `onTyping`） */
  commit(label: string): void;
  /** Esc（退文字态）与文字态里的撤销 / 重做 */
  onEscape(): void;
  onUndo(): void;
  onRedo(): void;
  /**
   * 选区变了（拖选 / 点光标 / 刷完样式）—— 宿主据此重画样式面板。
   *
   * ⚠️ 编辑器内部做**指纹比对**，只在真的变了时调：不然鼠标每动一下都会重画面板。
   */
  onSelectionChange(): void;
}

export interface TextSession {
  /** 进文字态：挂监听 + 让那块文字可编辑 + 光标落到末尾 */
  enter(id: string): void;
  /** 退文字态：摘监听 + 撤掉可编辑态 */
  exit(): void;
  /** 重渲之后调：DOM 是新的一份 ⇒ 可编辑态、光标、选区都要重来 */
  reattach(): void;
  /** 当前在编辑哪个节点（`null` = 不在文字态） */
  readonly id: string | null;
  /** 当前光标/选区（绝对下标）；没进文字态 = `null` */
  abs(): AbsRange | null;
  /** 当前选区（`runs` 上的投影，喂给 `applyRange`）；折叠的光标 = `null` */
  range(): RunRange | null;
  /** 选中的那几个字（给宿主显示 / 探针断言） */
  selectedText(): string;
  /**
   * ⭐ **给选中的那几个字刷样式**（Word 式染色）。没选区 / 值不合法 ⇒ `false`。
   *
   * 收 `(path, value)` 而不是 `RunPatch`：面板给的是**路径 + 输入框里的值**，
   * 换算（px → 0–1）与"装饰线要合并而不是整对象替换"这两件事**都在这一层做掉**
   * （见 `inspector.selPatchOf` 与 `mergeDecoration`）。宿主只管把两个值递进来。
   */
  applyStyleToSelection(path: string, value: unknown): boolean;
  /** 当前片段数（宿主重渲后对齐用） */
  refreshRunCount(): void;
}

/** `querySelector` 里的字符串转义（id 是数据，可能带引号 / 反斜杠） */
const attrEsc = (v: string) => v.replace(/["\\]/g, '\\$&');

/** 文字进 DOM 前转义 —— 与 `emit.ts` 同一套（`\n` 落成 `<br>`） */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * **装饰线必须合并，不能整对象替换**。
 *
 * `applyToRange` 落 patch 用的是浅展开（`{ ...r, ...patch }`），而 `decoration` 是**对象**
 * ⇒ 直接传 `{ decoration: { color } }` 会把片段上原有的线型 / 线粗**冲掉**。
 * 而面板的意图是"**只改线色**，线型仍跟随"（三态与逐项覆盖的语义，见 `vocabulary.ts`）。
 *
 * ⇒ 在落 patch 之前，把 `decoration` 换成"**生效值打底 + 本次那一项**"的完整对象。
 *    ⚠️ 生效值 = **片段自己写的 ?? 元素级默认** —— 与 `selectionFields` 的 `get` 同一口径。
 *    只看片段的话，元素级那条线型 / 线粗就丢了（实测：元素级 `{style:'wavy',thickness:3}`
 *    下只改线色，结果片段上只剩 `{color}`）。
 */
function mergeDecoration(node: TextNode, range: RunRange, patch: RunPatch): RunPatch {
  if (!patch.decoration) return patch;
  const r = node.runs[range.from.run];
  const next = { ...(node.decoration ?? {}), ...(r?.decoration ?? {}), ...patch.decoration };
  // 每一项都 `undefined` ⇒ 等于"没写"，别在片段上留一个空对象
  const kept = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
  return { ...patch, decoration: Object.keys(kept).length ? (kept as TextRun['decoration']) : undefined };
}

export function createTextSession(host: TextHost): TextSession {
  let id: string | null = null;
  /** 光标 / 选区：**绝对字符下标**是唯一真源（片段编号会随切开 / 合并而变） */
  let selAbs: AbsRange | null = null;
  /** `selAbs` 在当前那份 `runs` 上的投影（折叠光标 = `null`） */
  let selRange: RunRange | null = null;
  /** 上一次见到的片段数 —— 判"结构变没变"（变了必须重渲，不能只补 DOM） */
  let lastRunCount = 0;
  let bound = false;

  const sub = () => host.root();
  const node = () => host.textNode(id);

  /**
   * 选区指纹 —— 用来做"只在**真的变了**时才通知宿主"。
   *
   * 为什么必须有它：`mouseup` / `keyup` / `selectionchange` 三个事件都会走 `trackSel()`，
   * 鼠标随便动一下就可能触发好几次 —— 不比对的话样式面板会被反复重画
   * （面板上是输入框，重画会把用户正在输的内容打断）。
   */
  let lastSelKey = '∅';
  /**
   * **一次编辑收尾期间压掉 `selectionchange`**。
   *
   * 重建 spans / `focus()` / 面板输入框拿焦点都会产生一串 selectionchange，
   * 读到的是浏览器**临时折起来**的选区 ⇒ `trackSel()` 会把 `selAbs`/`selRange`
   * 冲成折叠光标（实测：改完字号，选中的 3 个字就没了）。
   * ⇒ 压到**用户下一次真的按下鼠标 / 敲键**再放行（定时器挡不住那一两个宏任务的延迟）。
   */
  let suppressSel = false;
  function notifySelection(): void {
    const key = selAbs ? `${selAbs.start}:${selAbs.end}:${selRange ? 'r' : 'c'}` : '∅';
    if (key === lastSelKey) return;
    lastSelKey = key;
    host.onSelectionChange();
  }

  const win = (): SelectionLike | null => {
    const w = sub().defaultView;
    return w && typeof w.getSelection === 'function' ? (w.getSelection() as SelectionLike | null) : null;
  };

  /** 该文字层的"文字本体"（`contentEditable` 与 `emit.ts` 的 `data-fit` 同层） */
  function textBody(layerId: string): HTMLElement | null {
    const el = sub().querySelector(`[data-layer="${attrEsc(layerId)}"] [data-fit]`);
    return (el as HTMLElement | null) ?? null;
  }

  // ══════════════════════════════════════════════════════════════════
  // 可编辑态
  // ══════════════════════════════════════════════════════════════════

  /**
   * 进 / 出"能打字"的状态。⚠️ **每次重渲之后必须重新设一次**（DOM 是新的一份）。
   *
   * ⚠️ `plaintext-only` 保住"只要纯文本"，但**不是所有 Chromium 都认**：
   * 不认时属性值看着是设上了，`isContentEditable` 却是 `false`
   * （表现：点了没光标、打字毫无反应）⇒ 设完**真的检查一次**再退化到 `'true'`。
   * 探针要断言可编辑性就得读 **`isContentEditable`**，别读属性值（那个会骗人）。
   */
  function setEditable(layerId: string | null): void {
    const root = sub();
    const prev = root.querySelector('[data-fit][contenteditable]') as HTMLElement | null;
    if (prev) prev.contentEditable = 'false';
    if (!layerId) return;
    const el = textBody(layerId);
    if (!el) return;
    el.contentEditable = 'plaintext-only';
    if (!el.isContentEditable) el.contentEditable = 'true';
    el.focus();
  }

  // ══════════════════════════════════════════════════════════════════
  // 选区记账
  // ══════════════════════════════════════════════════════════════════

  /**
   * 读一次浏览器选区，记进 `selAbs`（**折叠的光标也记** —— 打字全靠它）。
   *
   * ⚠️ 折叠与非折叠走两条路：折叠时 `selectionToRange()` 返回 `null`
   * （它只管"选了哪几个字"），光标位置得用 `resolvePoint()` 单独问一次。
   */
  function trackSel(): void {
    const layerId = id;
    const n = node();
    if (!layerId || !n) return;
    const sel = win();
    if (!sel) return;

    if (!sel.isCollapsed) {
      const got = selectionToRange(sub(), sel as unknown as DomSelectionLike);
      if (!got || got.layerId !== layerId) return;
      const a = pointToAbs(n.runs, got.range.from);
      const b = pointToAbs(n.runs, got.range.to);
      if (a === null || b === null) return;
      selRange = got.range;
      selAbs = { start: a, end: b };
    } else {
      const p = resolvePoint(sub(), sel.anchorNode, sel.anchorOffset);
      if (!p || p.layerId !== layerId) return;
      const a = pointToAbs(n.runs, { run: p.run, offset: p.offset });
      if (a === null) return;
      selAbs = { start: a, end: a };
      selRange = null; // 光标不是选区
    }
    notifySelection();
  }

  /**
   * 把光标放回 `selAbs` 指的位置 —— 就地改过 DOM 之后必须重新放一次。
   *
   * ⚠️ **先聚焦再设选区**：反过来的话 `focus()` 会把刚设好的选区重置掉。
   */
  function restoreCaret(): void {
    const layerId = id;
    const n = node();
    if (!layerId || !n || !selAbs) return;
    const r = rangeFromAbs(n.runs, selAbs.start, selAbs.end);
    if (!r) return;
    const root = sub();
    const el = textBody(layerId);
    if (el && (root as unknown as { activeElement?: Element | null }).activeElement !== el) el.focus();
    const sel = win();
    if (sel) rangeToSelection(root as unknown as Document, root, sel, layerId, r);
  }

  // ══════════════════════════════════════════════════════════════════
  // 把结果画出来
  // ══════════════════════════════════════════════════════════════════

  /**
   * 把某层的文字**就地**补进 DOM。
   *
   * 两条路：
   * - `rebuild=false`：段数没变、只是**文字**变了 ⇒ 按位置补每个 `<span>` 的 innerHTML
   *   （快，而且不会打断浏览器的选区）。
   * - `rebuild=true`：**段数 / 片段样式变了** ⇒ 用 `emitRunsHtml()` 把 `.vt` 的
   *   innerHTML 整个重写一遍（与渲染器**同一套 `runCss`**）⇒ 不需要宿主 emit 整份文档、
   *   更不需要换 `srcdoc` 重载 iframe ⇒ `contentEditable` 和文字态都还在。
   *
   * ⚠️ 这段以前缺了：改片段样式只改 doc、不写 DOM ⇒ 整段改样式时画布不跟；
   *    切段时又走"宿主重渲" ⇒ 编辑器新建实例、文字态直接没了。
   */
  function patchTextDom(layerId: string, n: TextNode, rebuild: boolean): void {
    const body = textBody(layerId);
    if (!body) return;
    if (rebuild) {
      body.innerHTML = emitRunsHtml(n);
      return;
    }
    const spans = sub().querySelectorAll(`[data-layer="${attrEsc(layerId)}"] [data-run]`);
    for (let i = 0; i < spans.length && i < n.runs.length; i++) {
      const el = spans[i] as HTMLElement;
      const text = n.runs[i].text;
      const html = esc(text).split('\n').join('<br>');
      if (el.innerHTML === html) continue;
      // ⚠️ **单行文字改 `textNode.nodeValue`，不要 `innerHTML =`**。
      //    换 innerHTML 会把光标所在的那个文本节点整个换掉 ⇒ 紧接着的
      //    `beforeinput` 里浏览器把焦点丢到 BODY，**第二个字就打不进去了**（实测）。
      //    `nodeValue` 是就地改内容，文本节点和焦点都还活着。
      const only = el.childNodes.length === 1 ? el.firstChild : null;
      if (!text.includes('\n') && only && only.nodeType === 3) {
        (only as CharacterData).nodeValue = text;
      } else {
        el.innerHTML = html;
      }
    }
  }

  /**
   * 一次文字编辑之后的收尾：**改 doc + 就地补 DOM，永远不请求宿主重渲**。
   *
   * 为什么不能每敲一个字都重渲：重渲 = emit + 换掉整个子文档 ⇒ 光标没了、
   * `contentEditable` 没了、编辑器还是**新实例**（文字态/当前图层全归零）。
   * 打字是高频操作，这么干会光标闪、页面卡，而且一改样式就"整个文字态消失"。
   */
  function afterEdit(layerId: string, label: string, rebuild = false, refocus = true): void {
    const n = node();
    if (!n) return;
    // ⚠️ 先**抄一份**绝对选区：重建 spans / 面板拿焦点都会让浏览器把 DOM 选区
    //    折到某个 offset 上，`selectionchange` 又会把它写回 `selAbs` ⇒ 选区被吃。
    const keepAbs = selAbs ? { ...selAbs } : null;
    // 段数变了（切段 / 合并）必须重写 spans；只是文字变了就按位置补
    const needRebuild = rebuild || n.runs.length !== lastRunCount;
    lastRunCount = n.runs.length;

    // ⚠️ **不立刻放行**：重建 spans / 面板拿焦点产生的 selectionchange 是
    //    "下一两个宏任务"才到的，定时器挡不住。这里一直压到**用户下一次真的
    //    按下鼠标 / 敲键**（见 `onSubPointerDown` / `onSubKeyDown`）——
    //    期间 `selAbs` / `selRange` 才是真源，面板上的"选中的字"不会消失。
    suppressSel = true;
    host.commit(label);
    patchTextDom(layerId, n, needRebuild);
    if (keepAbs) {
      selAbs = { ...keepAbs };
      const rr = keepAbs.start === keepAbs.end ? null : rangeFromAbs(n.runs, keepAbs.start, keepAbs.end);
      selRange = rr;
    }
    restoreCaret();
    if (keepAbs) selAbs = { ...keepAbs };

    /**
     * ⚠️ **改完 DOM 要补一次焦点**。
     *
     * Chromium 在 `beforeinput` 里被我们改了光标所在文本节点之后，会在事件收尾时
     * 把 contentEditable 的焦点丢到 BODY（实测 `+0ms` 就没了）——于是**第二个字
     * 就再也打不进去**（第一次打字看起来正常，其实已经失焦）。
     * 同步 `focus()` 没用（丢焦点发生在这之后）⇒ 挪到下一个任务里补；`hasFocus()`
     * 为 false 说明用户已经点到面板输入框了，**别抢**。
     */
    if (refocus) {
      setTimeout(() => {
        if (id !== layerId) return;
        const w = sub().defaultView as (Window & { document?: Document }) | null;
        if (w?.document && typeof w.document.hasFocus === 'function' && !w.document.hasFocus()) return;
        const el = textBody(layerId);
        if (!el) return;
        el.focus();
        restoreCaret();
      }, 0);
    }
  }

  /** 在光标处插一段文字（**有选区就先替换掉它** —— "打字即替换"） */
  function insertAtCaret(layerId: string, text: string): void {
    const n = node();
    if (!selAbs || !text || !n) return;
    let at = selAbs.start;
    if (selAbs.end > selAbs.start) {
      n.runs = deleteRunRange(n.runs, selAbs.start, selAbs.end).runs;
      at = selAbs.start;
    }
    n.runs = insertRunText(n.runs, at, text).runs;
    selAbs = { start: at + text.length, end: at + text.length };
    selRange = null;
    afterEdit(layerId, '输入文字');
  }

  // ══════════════════════════════════════════════════════════════════
  // 事件 → 文档
  // ══════════════════════════════════════════════════════════════════

  /**
   * ⭐ **敲键的入口**。用 `beforeinput` 而不是 `keydown`：它直接说清"要做什么"
   * （`inputType` + `data`），而且**带输入法的组合态**。
   *
   * ⚠️ 唯一拦不掉的是 `insertCompositionText`（规范里 `cancelable = false`）——
   * 那种放行，组合结束后再对齐（`compositionend`）。
   */
  const onBeforeInput: EventListener = (e) => {
    const layerId = id;
    if (!layerId || !selAbs) return;
    const ev = e as InputEvent;
    const t = ev.inputType;

    if (t === 'insertText' && typeof ev.data === 'string' && ev.data) {
      ev.preventDefault();
      insertAtCaret(layerId, ev.data);
      return;
    }
    if (t === 'insertLineBreak' || t === 'insertParagraph') {
      ev.preventDefault(); // 词汇里"行"是内容：换行就是文字里的 `\n`
      insertAtCaret(layerId, '\n');
      return;
    }
    if (t === 'deleteContentBackward' || t === 'deleteContentForward') {
      const n = node();
      if (!n) return;
      ev.preventDefault();
      if (selAbs.end > selAbs.start) {
        // 有选区 ⇒ 删掉选区（退格 / 前删对选区是同一个结果）
        const at = selAbs.start;
        n.runs = deleteRunRange(n.runs, selAbs.start, selAbs.end).runs;
        selAbs = { start: at, end: at };
      } else if (t === 'deleteContentBackward') {
        if (selAbs.start <= 0) return; // 已经在最前面
        const at = selAbs.start - 1;
        n.runs = deleteRunRange(n.runs, at, selAbs.start).runs;
        selAbs = { start: at, end: at };
      } else {
        const at = selAbs.start;
        n.runs = deleteRunRange(n.runs, at, at + 1).runs;
        selAbs = { start: at, end: at };
      }
      selRange = null;
      afterEdit(layerId, '删除文字');
      return;
    }
    // 其余（含 `insertCompositionText` / `insertFromPaste`）**放行**：
    // 粘贴走下面 `paste` 那条路（那里才拿得到纯文本）；组合走 `compositionend`。
  };

  /**
   * ⚠️ **输入法组合结束** —— 唯一一处"从 DOM 读回文字"的地方。
   *
   * 组合期间的 `beforeinput` 不可取消 ⇒ 浏览器**已经真的改了 DOM**。
   * 能做的只有：把那一整段读回来换进文档（**只读文字、不读样式**），
   * 再重渲一次把 DOM 结构（`span` / `data-run`）恢复干净。
   */
  const onCompositionEnd: EventListener = () => {
    const layerId = id;
    const n = node();
    if (!layerId || !n) return;
    const sel = win();
    if (!sel) return;
    const p = resolvePoint(sub(), sel.anchorNode, sel.anchorOffset);
    if (!p || p.layerId !== layerId) return;
    const spanEl = sub().querySelector(`[data-layer="${attrEsc(layerId)}"] [data-run="${p.run}"]`);
    const domText = spanEl?.textContent ?? '';
    if (!spanEl || domText === n.runs[p.run]?.text) return; // 没真改（组合被取消）

    n.runs = replaceRunText(n.runs, p.run, domText).runs;
    const after = node();
    const idx = after ? Math.min(p.run, after.runs.length - 1) : 0;
    const caret = after ? (pointToAbs(after.runs, { run: idx, offset: after.runs[idx].text.length }) ?? 0) : 0;
    selAbs = { start: caret, end: caret };
    selRange = null;
    // 结构可能被输入法动过 ⇒ **强制重渲**
    afterEdit(layerId, '输入法上屏', true);
  };

  const onPaste: EventListener = (e) => {
    const layerId = id;
    if (!layerId) return;
    e.preventDefault(); // 一律挡住（`plaintext-only` 不被支持时也安全）
    const text = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
    if (text) insertAtCaret(layerId, text.replace(/\r\n?/g, '\n'));
  };

  const onCut: EventListener = (e) => {
    const layerId = id;
    const n = node();
    if (!layerId || !n || !selAbs || selAbs.end <= selAbs.start) return;
    e.preventDefault();
    const r = rangeFromAbs(n.runs, selAbs.start, selAbs.end);
    (e as ClipboardEvent).clipboardData?.setData('text/plain', r ? sliceText(n.runs, r) : '');
    const at = selAbs.start;
    n.runs = deleteRunRange(n.runs, selAbs.start, selAbs.end).runs;
    selAbs = { start: at, end: at };
    selRange = null;
    afterEdit(layerId, '剪切文字');
  };

  /** 从别处拖文字进来会让 DOM 与文档分家 ⇒ 直接禁掉 */
  const onDrop: EventListener = (e) => {
    if (id) e.preventDefault();
  };

  /**
   * ⚠️ Esc 与撤销必须在**子文档**上也听一次。
   * 选字时焦点在 iframe 里，按键**根本不经过父页面** —— 只挂父文档会永远收不到。
   *
   * ⭐ 文字态里的撤销/重做还**必须拦下**：浏览器的"原生撤销"改的是 DOM，
   * 会把真源（文档）搞乱 —— 它对我们那份 `runs` 一无所知。
   */
  const onSubKeyDown: EventListener = (e) => {
    suppressSel = false; // 用户真的在敲键 ⇒ 放开 selectionchange 记账
    const ke = e as KeyboardEvent;
    if (ke.key === 'Escape') {
      host.onEscape();
      return;
    }
    if ((ke.ctrlKey || ke.metaKey) && ke.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (ke.shiftKey) host.onRedo();
      else host.onUndo();
    }
  };

  const onSelMaybeChanged: EventListener = () => {
    if (id && !suppressSel) trackSel();
  };

  /** 用户下一次按下鼠标 ⇒ 放开"程序化重建期间"的选区冻结 */
  const onSubPointerDown: EventListener = () => {
    suppressSel = false;
  };

  const SUB_EVENTS: Array<[string, EventListener]> = [
    ['beforeinput', onBeforeInput],
    ['compositionend', onCompositionEnd],
    ['paste', onPaste],
    ['cut', onCut],
    ['drop', onDrop],
    ['keydown', onSubKeyDown],
    ['pointerdown', onSubPointerDown],
    ['keyup', onSelMaybeChanged],
    ['mouseup', onSelMaybeChanged],
    ['selectionchange', onSelMaybeChanged],
  ];

  /** 挂 / 摘子文档监听。⚠️ 子文档可能**换过**（重渲 ⇒ 新的一份）⇒ 记着挂在哪一份上 */
  let boundTo: LayerDom | null = null;

  function unbind(): void {
    if (!boundTo || typeof boundTo.removeEventListener !== 'function') {
      boundTo = null;
      bound = false;
      return;
    }
    for (const [t, fn] of SUB_EVENTS) boundTo.removeEventListener(t, fn);
    boundTo = null;
    bound = false;
  }

  function bind(): void {
    const root = sub();
    if (boundTo === root && bound) return;
    unbind();
    // 假 DOM / 不支持的壳（没有 addEventListener）⇒ 降级：不崩，只是不能打字
    if (typeof root.addEventListener !== 'function') return;
    for (const [t, fn] of SUB_EVENTS) root.addEventListener(t, fn);
    boundTo = root;
    bound = true;
  }

  // ══════════════════════════════════════════════════════════════════
  // 对外
  // ══════════════════════════════════════════════════════════════════

  return {
    get id() {
      return id;
    },

    enter(layerId) {
      id = layerId;
      suppressSel = false;
      const n = node();
      lastRunCount = n ? n.runs.length : 0;
      // 光标先落在**末尾**；随后用户点哪就在哪（那是浏览器在 contentEditable 里的活）
      if (n) {
        let total = 0;
        for (const r of n.runs) total += r.text.length;
        selAbs = { start: total, end: total };
      }
      selRange = null;
      bind();
      setEditable(layerId);
      // ⚠️ **必须把选区写回 DOM**：`focus()` 会把光标丢在 **0 号位**，而 `selAbs`
      //    记的是末尾 ⇒ 不写回的话，第一次打字会**插到最前面**（实测）。
      restoreCaret();
      notifySelection();
    },

    exit() {
      setEditable(null);
      unbind();
      suppressSel = false;
      id = null;
      selAbs = null;
      selRange = null;
      notifySelection();
    },

    /** 重渲之后：DOM 换了 ⇒ 重新挂监听、重设可编辑、把光标/选区画回去 */
    reattach() {
      if (!id) return;
      bind();
      setEditable(id);
      restoreCaret();
    },

    abs: () => selAbs,
    range: () => selRange,

    selectedText() {
      const n = node();
      return n && selRange ? sliceText(n.runs, selRange) : '';
    },

    applyStyleToSelection(path, value) {
      const n = node();
      if (!id || !n || !selRange) return false;
      const patch = selPatchOf(path, value, { width: host.canvasWidth() });
      if (!patch) return false;
      n.runs = applyToRange(n.runs, selRange, mergeDecoration(n, selRange, patch));
      // ⚠️ **样式一定变了**（哪怕段数没变）⇒ 必须重建 spans 的 inline style。
      //    以前传的是"段数变没变" ⇒ 整段选中时 DOM 不更新；切段时又走宿主重渲。
      afterEdit(id, '改选区样式', true, false);
      // 值变了 ⇒ 面板上的显示要跟着走（指纹里带了选区，但样式变了值也变，
      // 所以这里强制报一次：把指纹清掉再报）
      lastSelKey = '∅';
      notifySelection();
      return true;
    },

    refreshRunCount() {
      const n = node();
      lastRunCount = n ? n.runs.length : 0;
    },
  };
}
