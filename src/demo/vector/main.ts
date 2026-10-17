/**
 * **新链编辑器 demo 的浏览器入口** —— 能真的拿鼠标拖、还能改属性的页面。
 *
 * ⚠️ 本文件放在 `src/demo/` 而**不是** `src/editor/`：它必须碰 `document` / `window`，
 * 而 `src/editor/*.ts` 有一条「不引用任何全局网页对象」的不变量（grep 可查）。
 *
 * 结构与正式编辑器一致（照抄 `src/editor/README.md` 的 M1 结论）：
 * - **iframe 退化为纯渲染器**：`pointer-events:none` + `sandbox="allow-same-origin"`；
 * - **交互由父侧覆盖层接管**：手柄画在 `wrap` 里，坐标系天然是画布 local px。
 *
 * 属性面板的**字段来自** `src/editor/inspector.ts`（那边只给描述，不碰 DOM）；
 * 本文件负责把它画成一排输入框 —— 换 React 的时候只换这一层。
 */

import { createVocabEditor } from '../../editor/vocab-editor';
import { nodeLabel, selPatchOf, selectionFields, type Field, type SelField } from '../../editor/inspector';
import { rangeToSelection, resolvePoint, selectionToRange } from '../../editor/text-selection';
import { firstRunOf, pointToAbs, rangeFromAbs, sliceText, type RunRange } from '../../editor/text-runs';
import { DEFAULT_FONT_PX, emitDocument } from '../../render/vocabulary/emit';
import {
  findAny,
  findElement,
  type DesignDocument,
  type ElementNode,
  type TextNode,
  type TextRun,
} from '../../document/vocabulary';
import type { EmitIssue } from '../../render/vocabulary/emit';
import { DEMO_ASSETS, DEMO_DOC } from './doc';

// ── 视口：`?zoom=0.5` 可以把画布缩小显示，用来验证「缩放不影响拖动手感」──
const params = new URLSearchParams(location.search);
const ZOOM = Number(params.get('zoom') ?? '1') || 1;
const W = DEMO_DOC.canvas.width;
const H = DEMO_DOC.canvas.height;

const host = document as unknown as Parameters<typeof createVocabEditor>[0];

const wrap = document.getElementById('wrap') as HTMLElement;
const panelEl = document.getElementById('panel') as HTMLElement;
const layersEl = document.getElementById('layers') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;

wrap.style.cssText =
  `position:relative;width:${W}px;height:${H}px;` +
  `transform:scale(${ZOOM});transform-origin:top left`;

const frame = document.createElement('iframe');
// ⚠️ `allow-same-origin` 必须留着 —— 去掉会变 opaque origin，`contentDocument` 变 null
frame.setAttribute('sandbox', 'allow-same-origin');
frame.style.cssText =
  `position:absolute;left:0;top:0;width:${W}px;height:${H}px;border:0;pointer-events:none`;
wrap.appendChild(frame);

let doc: DesignDocument = DEMO_DOC;
let lastIssues: { unsupported: EmitIssue[]; notes: EmitIssue[] } = { unsupported: [], notes: [] };
/** 当前"选中的那几个字"（在**那段文字的 runs** 里记下标，不是记 DOM 节点） */
let selRange: RunRange | null = null;

/**
 * ⭐ 同一个选区的**绝对字符下标**（"整段文字里的第几个字符"）。
 *
 * 为什么两个都要留：改一次样式 ⇒ 重渲 ⇒ `runs` 被切开、**片段编号重排**，
 * `selRange` 事后指的可能已经是别的字。绝对下标不随切开而变，
 * 所以它是"真源"，`selRange` 是它在当前这份 runs 上的投影。
 */
let selAbs: { start: number; end: number } | null = null;

/** `createVocabEditor` 返回之前不能碰 `editor`（`const` 有 TDZ）—— 首次 `render()` 就在那之前 */
let editorReady = false;

/**
 * 刚由"选区块"自己发起的改动 ⇒ 这一轮**不要重建**选区块。
 *
 * 不这么做的话：改字号 → 重渲 → 重建控件 ⇒ 正在输入的那个框被换掉、**焦点丢了**，
 * 想输 "72" 只能输进一个 "7"。
 */
let keepSelControls = false;

function subDocument(): Document {
  const d = frame.contentDocument;
  if (!d) throw new Error('iframe contentDocument 拿不到');
  return d;
}

/** 把整份文档重新翻成 HTML 写进 iframe */
/**
 * **送进渲染器的那一份文档**。
 *
 * ⭐ 正在编辑**沿路径排字**的节点时，把它的 `path` / `curve` 摘掉再送去渲染 ——
 * 那样它就是一坨普通文字（有 `.vt`），才能挂 `contentEditable`、才能打字。
 * 退出文字态时这个切换自动失效，画面回到弧线。
 *
 * ⚠️ 关键是**深拷贝**：降级只发生在"渲染输入"上，`doc` 本身**一个字节都不改**
 * —— 否则"平铺版"会被写进文档，退出编辑就再也回不去弧线了。
 * ⚠️ 也**不能**让编辑器的工作副本看到这份降级文档（它只存在于 `emitDocument()` 的入参）。
 */
function renderDoc(): DesignDocument {
  const id = editorReady ? editor.textEditId : null;
  if (!id) return doc;
  // ⚠️ 画布的孩子是**图层**，文字是图层里的**元素** ⇒ 查节点一律走 `findElement`（含组内嵌套）
  const node = findElement(doc, id);
  if (!node || node.type !== 'text' || (!node.path && !node.curve)) return doc;
  const copy = structuredClone(doc);
  const flat = findElement(copy, id);
  // `doc` 里刚找到过它 ⇒ 克隆里必然还在；这一步只是把类型收窄到 `TextNode`
  if (!flat || flat.type !== 'text') return doc;
  delete flat.path;
  delete flat.curve;
  return copy;
}

function render() {
  const r = emitDocument(renderDoc(), { assets: DEMO_ASSETS });
  lastIssues = { unsupported: r.unsupported, notes: r.notes };
  const d = subDocument();
  d.open();
  d.write(r.html);
  d.close();
  // ⚠️ `d.write()` 之后是**另一个 Document** ⇒ 挂在它上面的监听全没了，必须重新挂。
  //    漏了这一步，"第一次能选字、重渲一次就选不动了"。
  attachSubHandlers();
  // ⚠️ 重渲重建了整份 DOM ⇒ `contentEditable` 也跟着没了，必须**重新设一次**
  //    （漏了这一步：打第一个字还能打，重渲之后光标就点不进去了）
  if (editorReady && editor.textEditId) setEditable(editor.textEditId);
  // 画面被整个换掉 ⇒ 旧选区在浏览器那边已经不存在了。**按绝对下标重算并恢复**，
  // 不然每改一次样式（调字号要连按几次）就得重新拖一遍。
  restoreSel();
}

/**
 * 用绝对下标把选区**在新文档上**重新算出来，同时把浏览器那边的选区恢复回去。
 *
 * 只有"文字态 + 之前确实选过字"才做 —— 平时刻意不留选区。
 */
function restoreSel() {
  if (!editorReady || !selAbs) {
    selRange = null;
    return;
  }
  const id = editor.textEditId;
  const node = id ? findElement(doc, id) : null;
  if (!id || !node || node.type !== 'text') {
    selAbs = null;
    selRange = null;
    return;
  }
  selRange = rangeFromAbs(node.runs, selAbs.start, selAbs.end);
  const win = frame.contentWindow;
  const sub = subDocument();
  if (selRange && win) rangeToSelection(sub, sub, win.getSelection(), id, selRange);
}

render();

// ══════════════════════════════════════════════════════════════════════
// 文字编辑态（Word 式：光标进去 → 打字 → 选中 → 改样式）
//
// 分工：**编辑器**只改数据（在 runs 上插 / 删 / 刷样式）；
// 这里（宿主）负责它碰不到的那些事 ——
//   ① 放开 iframe 的 `pointer-events`（平时它是纯渲染器，不吃鼠标）；
//   ② 把 `.vt` 设成 `contentEditable` —— **光标、方向键、拖选、输入法全交给浏览器**。
//      自绘光标要重写一遍文字布局量算，不值；
//   ③ 拦 `beforeinput`，把"敲了什么键"翻译成"文档里第几个字符处插一段"；
//   ④ 打完那次**就地补 DOM**（不整份重渲）—— 打字是高频操作，重渲会让光标闪、页面卡。
//
// ⚠️ 真源**始终是文档**：改 DOM 是为了"把结果画出来"，**从不从 DOM 反推文字**
//    （唯一例外：输入法组合结束时的对齐，见 `onSubCompositionEnd`）。
// ══════════════════════════════════════════════════════════════════════

/** 上一次的片段数 —— 打字之后靠它判断"结构变了没有"（变了必须重渲） */
let lastRunCount = 0;

/** `querySelector` 里的字符串转义（id 是数据，可能带引号 / 反斜杠） */
const attrEsc = (v: string) => v.replace(/["\\]/g, '\\$&');
/** 文字进 DOM 前的转义（与 `emit.ts` 同一套：`\n` 落成 `<br>`） */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function attachSubHandlers() {
  const d = subDocument();
  d.addEventListener('mouseup', onSubMouseUp);
  d.addEventListener('keyup', onSubKeyUp);
  d.addEventListener('keydown', onSubKeyDown);
  d.addEventListener('beforeinput', onSubBeforeInput);
  d.addEventListener('compositionend', onSubCompositionEnd);
  d.addEventListener('paste', onSubPaste);
  d.addEventListener('cut', onSubCut);
  d.addEventListener('drop', onSubDrop);
}

// ── `.vt` 可编辑：光标交给浏览器 ─────────────────────────────────────

/** 该文字层的"文字本体"（`contentEditable` 挂在它上面，与 `emit.ts` 的 `data-fit` 同层） */
function textBody(id: string): HTMLElement | null {
  const el = subDocument().querySelector(`[data-layer="${attrEsc(id)}"] [data-fit]`);
  return (el as HTMLElement | null) ?? null;
}

/** 进 / 出"能打字"的状态。⚠️ 每次重渲之后必须**重新设一次**（DOM 是新的一份） */
function setEditable(id: string | null) {
  const d = subDocument();
  const prev = d.querySelector('[data-fit][contenteditable]') as HTMLElement | null;
  if (prev) prev.contentEditable = 'false';
  if (!id) return;
  const el = textBody(id);
  if (!el) return;
  // ⚠️ `plaintext-only` 保住"只要纯文本"，但**不是所有 Chromium 都认** ——
  //    不认时 `contentEditable` 属性值看着是设上了，`isContentEditable` 却是 false
  //    （表现：点了没光标、打字毫无反应）。⇒ 认下来之后**真的检查一次**再退化。
  el.contentEditable = 'plaintext-only';
  if (!el.isContentEditable) el.contentEditable = 'true';
  el.focus();
}

/** 把光标放回 `selAbs` 指的位置 —— 就地改过 DOM 之后必须重新放一次 */
function restoreCaret() {
  const id = editor.textEditId;
  if (!id || !selAbs) return;
  const node = findElement(doc, id);
  if (!node || node.type !== 'text') return;
  const r = rangeFromAbs(node.runs, selAbs.start, selAbs.end);
  if (!r) return;
  const d = subDocument();
  const win = frame.contentWindow;
  const el = textBody(id);
  // ⚠️ **先聚焦再设选区** —— 反过来的话 `focus()` 会把刚设的选区重置掉
  if (el && d.activeElement !== el) el.focus();
  if (win) rangeToSelection(d, d, win.getSelection(), id, r);
}

/** 把某层的文字**就地**补进 DOM（不动节点结构 ⇒ 光标不闪）—— 打字走这条，不重渲 */
function patchTextDom(id: string, runs: readonly TextRun[]) {
  const spans = subDocument().querySelectorAll(`[data-layer="${attrEsc(id)}"] [data-run]`);
  for (let i = 0; i < spans.length && i < runs.length; i++) {
    const html = esc(runs[i].text).split('\n').join('<br>');
    if (spans[i].innerHTML !== html) spans[i].innerHTML = html;
  }
}

/**
 * 一次文字编辑之后：**段数没变就就地补 DOM**（快），**变了就重渲**（结构变了，必须重建节点）。
 */
function afterTyping(id: string) {
  const node = findElement(doc, id);
  if (!node || node.type !== 'text') return;
  if (node.runs.length !== lastRunCount) {
    lastRunCount = node.runs.length;
    render(); // `render()` 里会把光标放回去并重挂监听
    editor.attachRoot(subDocument());
    return;
  }
  patchTextDom(id, node.runs);
  restoreCaret();
  paintStatus();
  // ⚠️ 面板上的"内容"框也得跟着走 —— 不然打完字回头一看，框里还是旧文字
  syncPanelValues();
}

/** 在光标处插一段文字（**有选区就先替换掉它** —— "打字即替换"） */
function insertAtCaret(id: string, text: string) {
  if (!selAbs || !text) return;
  let at = selAbs.start;
  if (selAbs.end > selAbs.start) {
    editor.deleteRange(id, selAbs.start, selAbs.end);
    at = selAbs.start;
  }
  editor.insertText(id, at, text);
  selAbs = { start: at + text.length, end: at + text.length };
  afterTyping(id);
}

// ── 子文档事件 → 文档编辑 ────────────────────────────────────────────

/**
 * ⭐ **敲键的入口**。用 `beforeinput` 而不是 `keydown`：它直接说清"要做什么"
 * （`inputType` + `data`），而且**带输入法的组合态**。
 *
 * ⚠️ 唯一拦不掉的是 `insertCompositionText`（规范里 `cancelable = false`）——
 * 那种放行，组合结束后再对齐（`onSubCompositionEnd`）。
 */
function onSubBeforeInput(e: Event) {
  const id = editor.textEditId;
  if (!id || !selAbs) return;
  const ev = e as InputEvent;
  const t = ev.inputType;

  if (t === 'insertText' && typeof ev.data === 'string' && ev.data) {
    ev.preventDefault();
    insertAtCaret(id, ev.data);
    return;
  }
  if (t === 'insertLineBreak' || t === 'insertParagraph') {
    ev.preventDefault(); // 词汇里"行"是内容：换行就是文字里的 `\n`
    insertAtCaret(id, '\n');
    return;
  }
  if (t === 'deleteContentBackward' || t === 'deleteContentForward') {
    ev.preventDefault();
    if (selAbs.end > selAbs.start) {
      // 有选区 ⇒ 删掉选区（退格 / 前删对选区是同一个结果）
      const at = selAbs.start;
      editor.deleteRange(id, selAbs.start, selAbs.end);
      selAbs = { start: at, end: at };
    } else if (t === 'deleteContentBackward') {
      if (selAbs.start <= 0) return; // 已经在最前面
      const at = selAbs.start - 1;
      editor.deleteRange(id, at, selAbs.start);
      selAbs = { start: at, end: at };
    } else {
      const at = selAbs.start;
      editor.deleteRange(id, at, at + 1);
      selAbs = { start: at, end: at };
    }
    afterTyping(id);
    return;
  }
  // 其余（含 `insertCompositionText`）放行 —— 见上面的注释
}

/**
 * ⚠️ **输入法组合结束** —— 唯一一处"从 DOM 读回文字"的地方。
 *
 * 组合期间的 `beforeinput` 不可取消 ⇒ 浏览器**已经真的改了 DOM**。
 * 能做的只有：把那一整段读回来换成文档里的文字（**只读文字，不读样式**），
 * 再重渲一次把 DOM 结构（`span` / `data-run`）恢复干净。
 */
function onSubCompositionEnd() {
  const id = editor.textEditId;
  if (!id) return;
  const d = subDocument();
  const win = frame.contentWindow;
  const sel = win?.getSelection();
  if (!sel) return;
  const p = resolvePoint(d, sel.anchorNode, sel.anchorOffset);
  if (!p || p.layerId !== id) return;
  const node = findElement(doc, id);
  if (!node || node.type !== 'text') return;

  const spanEl = d.querySelector(`[data-layer="${attrEsc(id)}"] [data-run="${p.run}"]`);
  const domText = spanEl?.textContent ?? '';
  if (!spanEl || domText === node.runs[p.run]?.text) return; // 没真改（组合被取消）

  editor.setRunText(id, p.run, domText);
  lastRunCount = -1; // 结构可能被输入法动过 ⇒ 强制重渲
  const afterEl = findElement(doc, id);
  const after = afterEl && afterEl.type === 'text' ? afterEl : undefined;
  const idx = after ? Math.min(p.run, after.runs.length - 1) : 0;
  const caret = after ? (pointToAbs(after.runs, { run: idx, offset: after.runs[idx].text.length }) ?? 0) : 0;
  // 简化：光标收到该段末尾（组合一般发生在词尾）
  selAbs = { start: caret, end: caret };
  render();
  editor.attachRoot(subDocument());
}

function onSubPaste(e: Event) {
  const id = editor.textEditId;
  if (!id) return;
  e.preventDefault(); // 一律挡住（`plaintext-only` 不被支持时也安全）
  const text = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
  if (text) insertAtCaret(id, text.replace(/\r\n?/g, '\n'));
}

function onSubCut(e: Event) {
  const id = editor.textEditId;
  if (!id || !selAbs || selAbs.end <= selAbs.start) return;
  e.preventDefault();
  const node = findElement(doc, id);
  if (!node || node.type !== 'text') return;
  const r = rangeFromAbs(node.runs, selAbs.start, selAbs.end);
  (e as ClipboardEvent).clipboardData?.setData('text/plain', r ? sliceText(node.runs, r) : '');
  const at = selAbs.start;
  editor.deleteRange(id, selAbs.start, selAbs.end);
  selAbs = { start: at, end: at };
  afterTyping(id);
}

/** 从别处拖文字进来会让 DOM 与文档分家 ⇒ 直接禁掉 */
function onSubDrop(e: Event) {
  if (editor.textEditId) e.preventDefault();
}

/** 松手 / 松键 ⇒ 记下"当前选区或光标" */
function onSubMouseUp() {
  trackSel();
}
function onSubKeyUp() {
  trackSel();
}

/**
 * 读一次浏览器选区，记进 `selAbs`（**折叠的光标也记** —— 打字靠它）。
 *
 * ⚠️ 折叠与非折叠走两条路：折叠时 `selectionToRange()` 会返回 `null`
 * （它只管"选了哪几个字"），光标位置得用 `resolvePoint()` 单独问一次。
 */
function trackSel() {
  const id = editor.textEditId;
  if (!id) return;
  const d = subDocument();
  const win = frame.contentWindow;
  const sel = win && typeof win.getSelection === 'function' ? win.getSelection() : null;
  if (!sel) return;
  const node = findElement(doc, id);
  if (!node || node.type !== 'text') return;

  if (!sel.isCollapsed) {
    const got = selectionToRange(d, sel);
    if (!got || got.layerId !== id) return;
    selRange = got.range;
    const a = pointToAbs(node.runs, got.range.from);
    const b = pointToAbs(node.runs, got.range.to);
    selAbs = a !== null && b !== null ? { start: a, end: b } : null;
  } else {
    const p = resolvePoint(d, sel.anchorNode, sel.anchorOffset);
    if (!p || p.layerId !== id) return;
    const a = pointToAbs(node.runs, { run: p.run, offset: p.offset });
    if (a === null) return;
    selAbs = { start: a, end: a };
    selRange = null; // 光标不是选区 —— `paintSel` 对空文字本来也不会画
  }
  paintSel();
}

/**
 * ⚠️ Esc 得在**子文档**上也听一次。
 * 选字时焦点在 iframe 里，按键根本不经过父页面 —— 只在父页面听，Esc 永远收不到。
 */
function onSubKeyDown(e: Event) {
  const ke = e as KeyboardEvent;
  if (ke.key === 'Escape') {
    editor.endTextEdit();
    return;
  }
  // ⭐ 文字态里的撤销/重做**必须拦下**：浏览器的"原生撤销"改的是 DOM，
  //    会把我们的真源（文档）搞乱——原生撤销对它一无所知。
  if ((ke.ctrlKey || ke.metaKey) && ke.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (ke.shiftKey) editor.redo();
    else editor.undo();
  }
}

// ── 编辑器 ───────────────────────────────────────────────────────────
const editor = createVocabEditor(host, wrap, subDocument(), {
  doc,
  onChange(_id: string, next: DesignDocument) {
    doc = next;
    render();
    // iframe 内容换了 ⇒ 编辑器要认新的子文档（描边和命中都挂在它上面）
    editor.attachRoot(subDocument());
    paintStatus();
    // ⚠️ 片段被切开 / 合并之后，"内容"那一组的框数会变（单段 ↔ 多段）。
    //    字段数变了必须**重建**面板 —— `syncPanelValues` 只会更新已有控件，
    //    不会长出新行 ⇒ 新切出来的"第 2 段"会没有框可改（实测）。
    const count = editor.selectedId ? editor.fields(editor.selectedId).length : 0;
    if (count !== panelFieldCount) paintPanel();
    else syncPanelValues();
    paintSel();
  },
  onSelect() {
    paintStatus();
    paintPanel();
  },
  onTextEditChange(id) {
    // ⭐ 放开 / 收回鼠标：文字态里鼠标要真的落到画面上才拖得动选区、点得动光标
    frame.style.pointerEvents = id ? 'auto' : 'none';
    if (!id) {
      selRange = null;
      selAbs = null; // 退出文字态 ⇒ 选区作废（下次进来重新选）
    }
    // ⭐ **进出文字态都要重渲一次**：沿路径排字的节点在编辑期间会被**降级成普通文字**
    //    （见 `renderDoc()`），退出时自动回到弧线。形态换了，产物必须重建。
    render();
    editor.attachRoot(subDocument());
    const node = id ? findElement(doc, id) : null;
    if (id && node && node.type === 'text') {
      lastRunCount = node.runs.length;
      // 光标先落在**末尾**；随后用户点哪就在哪（那是浏览器在 contentEditable 里的活）
      const total = node.runs.reduce((s, r) => s + r.text.length, 0);
      selAbs = { start: total, end: total };
      restoreCaret();
    }
    paintStatus();
    paintSel();
  },
  onTyping(id, next) {
    if (!id) return; // 打字时必有目标（撤销的空 id 走 onChange，不经过这里）
    // ⭐ 打字走这条（**不是** `onChange`）：只是文字变了，宿主自己决定要不要重渲。
    // ⚠️ **必须把这份文档接过来** —— 编辑器内部拿的是 `cloneDoc()` 的克隆，
    //    不接过来宿主就还在用旧副本，`patchTextDom` 会把刚打的字又写回去（实测踩过）。
    doc = next;
    afterTyping(id);
  },
});
editorReady = true;

// ── 撤销 / 重做快捷键（父文档层；文字态的按键在 iframe 内，由 onSubKeyDown 处理）──
window.addEventListener('keydown', (ev) => {
  const ke = ev as KeyboardEvent;
  if (!(ke.ctrlKey || ke.metaKey)) return;
  const k = ke.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  ev.preventDefault();
  if (k === 'y' || ke.shiftKey) editor.redo();
  else editor.undo();
});

const TYPE_NAMES: Record<string, string> = {
  text: '文字',
  rect: '矩形',
  ellipse: '椭圆',
  polygon: '多边形',
  path: '路径',
  image: '图片',
  svg: '图标',
  group: '组',
};

/**
 * 面板上列哪些东西 = **图层里的顶层元素**（组内元素不单独成行）。
 *
 * ⚠️ 改结构之前 `doc.layers` 直接装节点，面板列的就是它；现在元素住在图层里
 * —— 列"每个图层里的元素"才和原来一一对应（demo 只有一个图层 ⇒ 行完全一样）。
 *
 * ⚠️ 编辑器那三个方法名里的 "Layer" 是**历史遗留**：`addLayer` 加的是**元素**，
 *    `moveLayer` / `removeLayer` 收的也是**元素 id**（在它所在的那个容器里换位 / 摘掉）。
 */
function listedElements(): ElementNode[] {
  const out: ElementNode[] = [];
  for (const l of doc.layers) out.push(...l.elements);
  return out;
}

/** ⭐ 图层列表面板（M3）：新增 / 选中 / 上移 / 下移 / 删除——全部走编辑器 API（进撤销栈） */
function paintLayers() {
  layersEl.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'layers-head';
  const title = document.createElement('span');
  title.textContent = '图层';
  head.appendChild(title);
  const defs: Array<[string, ElementNode]> = [
    ['+ 文字', {
      id: `t${Date.now()}`,
      type: 'text',
      rect: { x: 270, y: 180, w: 360, h: 72 },
      runs: [{ text: '双击编辑文字' }],
      fontSizePx: 36,
      fill: '#2B2B2B',
      align: 'left',
    }],
    ['+ 矩形', {
      id: `r${Date.now()}`,
      type: 'shape',
      kind: 'rect',
      rect: { x: 270, y: 180, w: 270, h: 120 },
      fill: '#2F6B8A',
      radius: 0.04,
    }],
  ];
  for (const [label, node] of defs) {
    const btn = document.createElement('button');
    btn.className = 'ui-btn';
    btn.textContent = label;
    btn.setAttribute('data-add', node.type === 'text' ? 'text' : 'rect');
    btn.addEventListener('click', () => {
      // ⚠️ `editor.addLayer(...)` 加的**就是元素**（方法名里的 "Layer" 是历史遗留）：
      //    "画布的孩子一律是图层"由编辑器负责落地 —— 它把元素追加进图层并**选中它**，
      //    所以这里不用再 `select` 一次。
      editor.addElement(structuredClone(node));
    });
    head.appendChild(btn);
  }
  layersEl.appendChild(head);

  // 行（倒序：最上层在列表顶部）
  for (const l of listedElements().reverse()) {
    const row = document.createElement('div');
    row.className = 'layer-row' + (editor.selectedId === l.id ? ' sel' : '');
    row.setAttribute('data-layer-id', l.id);
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = `${TYPE_NAMES[l.type] ?? l.type} · ${l.id}`;
    row.appendChild(name);
    for (const [act, txt] of [
      ['up', '上'],
      ['down', '下'],
      ['del', '删'],
    ] as const) {
      const btn = document.createElement('button');
      btn.className = 'layer-btn';
      btn.textContent = txt;
      btn.setAttribute('data-act', act);
      btn.setAttribute('data-id', l.id);
      row.appendChild(btn);
    }
    layersEl.appendChild(row);
  }
}

// 列表交互（委托）：点行 = 选中；点按钮 = 上移 / 下移 / 删除
layersEl.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const act = t.getAttribute('data-act');
  const id = t.getAttribute('data-id');
  if (act && id) {
    if (act === 'del') editor.removeLayer(id);
    else editor.moveLayer(id, act as 'up' | 'down');
    return;
  }
  const row = t.closest('[data-layer-id]');
  if (row) editor.select(row.getAttribute('data-layer-id'));
});


// ── 底部状态条 ───────────────────────────────────────────────────────
function paintStatus() {
  paintLayers();
  const id = editor.selectedId;
  // ⚠️ 选中的**可能是图层**（不是元素）⇒ 用 `findAny`，两种都认
  const sel = id ? findAny(doc, id) : null;

  if (!sel) {
    statusEl.textContent = '没选中 —— 点一个形状';
    return;
  }
  // ⭐ **图层**没有 `type`、也没有 `rect`（它铺满画布）⇒ 单独一条：不然下面按 `l.type` 走会落到
  //    "形状"那几个分支上，把图层当成一个形状来报（误导）
  if (!('type' in sel)) {
    statusEl.textContent =
      `选中图层 ${id}（${sel.elements.length} 个元素）　图层铺满画布 —— 位置尺寸由里面的元素决定` +
      (editor.blockReason ? '（' + editor.blockReason + '）' : '');
    return;
  }
  // ⚠️ TS 在这里把 `sel` 收窄成了 `LeafNode`：因为 `GroupNode` 结构上**也可以赋给 `Layer`**
  //    （两者都有 `elements`、都没有 `rect`，只差一个 `type`）⇒ 上面那道"不是图层"的 guard
  //    把"组"一起收走了。**运行时组会正常走到这里**，所以显式标一声。
  const l = sel as ElementNode;
  // ⭐ 组**没有 `rect`** ⇒ 单独一条：不然选中的明明是个组，状态条却说"没选中"（误导）
  if (l.type === 'group') {
    const n = l.elements.length;
    statusEl.textContent =
      `选中组 ${id}（${n} 个直接子元素）　拖它 = 里面的元素一起搬（组自己不动 —— 它没有位置）` +
      '；Ctrl/⌘ + 点击可直接选里面的元素（点一下再点一下也行）' +
      (editor.blockReason ? '（' + editor.blockReason + '）' : '');
    return;
  }
  // ⭐ 解析形状（rect / ellipse）——形状是公式、没有顶点；告诉用户"想要逐点编辑"怎么走
  if (l.type === 'shape' && (l.kind === 'rect' || l.kind === 'ellipse')) {
    const what = l.kind === 'rect' ? '矩形（圆角会丢失）' : '椭圆（变成 24 边形近似）';
    statusEl.textContent =
      `选中 ${l.kind} ${id}　要逐点编辑？拖任意顶点或点一下边，就会把它转成可编辑的多边形（不可逆：转成 ${what}）`;
    return;
  }

  const r = (l as { rect: { x: number; y: number; w: number; h: number } }).rect;
  const rot = l.transform?.rotate ?? 0;
  const pts =
    l.type === 'shape' && l.kind === 'polygon'
      ? '　顶点 ' + (l as { points: Array<[number, number]> }).points.map((p) => `[${p[0]},${p[1]}]`).join(' ')
      : '';

  statusEl.textContent =
    `选中 ${id}　位置 ${r.x},${r.y}　尺寸 ${r.w}×${r.h}　角度 ${rot}°` +
    pts +
    (editor.blockReason ? '（' + editor.blockReason + '）' : '') +
    (editor.textEditId === id
      ? l.type === 'text' && (l.path || l.curve)
        ? '　【平铺编辑】这段文字最终是**沿路径**排的，编辑期间先摊平显示（这样才有光标）。' +
          '⚠️ 摊平时的宽度 ≠ 弧线上的可用长度 —— 调完字号退出时可能被路径截断；Esc 退出回到弧线'
        : '　【选字中】在字上拖鼠标选中几个字 → 右边改这几个字的字号/字重/颜色（Esc 退出）'
      : '');
}

// ── 属性面板 ─────────────────────────────────────────────────────────

/** 「选区」那一块自己一个容器 —— 改文字时不必把整块面板重画一遍 */
const selBox = document.createElement('div');
selBox.id = 'selbox';

/** 面板上一次画出了几个字段 —— 片段切开/合并会改变它，那时必须重建面板 */
let panelFieldCount = -1;

function paintPanel() {
  const id = editor.selectedId;
  const fields = editor.fields(id);

  panelEl.innerHTML = '';
  if (!id || !fields.length) {
    panelFieldCount = 0;
    panelEl.innerHTML = '<p class="empty">没选中 —— 点画布上的一个形状</p>';
    return;
  }

  // ⚠️ 属性面板只描述**元素**（图层没有字段可改）⇒ 用 `findElement`：
  //    选中的是图层时不进这里（上面 `fields` 为空就已经返回了）
  const node = findElement(doc, id);
  if (!node) return;

  const title = document.createElement('div');
  title.className = 'ph';
  title.textContent = `${nodeLabel(node)}　${id}`;
  panelEl.appendChild(title);

  const groups: string[] = [];
  const byGroup = new Map<string, Field[]>();
  for (const f of fields) {
    if (!byGroup.has(f.group)) {
      byGroup.set(f.group, []);
      groups.push(f.group);
    }
    byGroup.get(f.group)!.push(f);
  }

  for (const g of groups) {
    const box = document.createElement('div');
    box.className = 'pg';
    const h = document.createElement('div');
    h.className = 'pgt';
    h.textContent = g;
    box.appendChild(h);
    for (const f of byGroup.get(g)!) box.appendChild(rowFor(f, node));
    panelEl.appendChild(box);
  }

  panelEl.appendChild(selBox);
  panelFieldCount = fields.length;
  paintSel();
  syncPanelValues();
}

/**
 * 「选区」那一块：显示**你选中了哪几个字**，再把"这几个字能改什么"逐项画出来
 * （字号 / 字重 / 颜色 —— 字段来自 `inspector.selectionFields()`，这里只管画）。
 *
 * ⚠️ 只在**文字态 + 有选区**时才出现 —— 没有选区就摆一排框，用户会以为
 *    "改字号"能只改一部分，其实改的是整段（那就是又要被吐槽的假界面）。
 */
function paintSel() {
  // 正在改的就是这一排控件 ⇒ 别重建（不然输入框被换掉、焦点丢，输 "72" 只进去一个 "7"）
  if (keepSelControls) return;

  selBox.innerHTML = '';
  const id = editor.textEditId;
  if (!id || !selRange) return;

  const node = findElement(doc, id);
  if (!node || node.type !== 'text') return;
  const picked = sliceText(node.runs, selRange);
  if (!picked) return;

  const title = document.createElement('div');
  title.className = 'ph';
  title.textContent = `选区　${picked.length} 个字`;
  selBox.appendChild(title);

  const preview = document.createElement('div');
  preview.className = 'seltext';
  preview.textContent = picked;
  selBox.appendChild(preview);

  // 控件显示**选区起点那一段**的生效值（Word 也是显示第一个字符的格式）。
  // ⚠️ 用 `firstRunOf`：起点下标压在段尾时，真正选中的是**下一段**。
  const run0 = node.runs[firstRunOf(node.runs, selRange)];
  for (const f of selectionFields()) selBox.appendChild(selRowFor(f, run0, node));
}

/** 一行"改了只影响选中那几个字"的控件 */
function selRowFor(f: SelField, run0: TextRun | undefined, node: TextNode): HTMLElement {
  const row = document.createElement('label');
  row.className = 'prow';

  const name = document.createElement('span');
  name.className = 'pname';
  name.textContent = f.label;

  const ctl = document.createElement('span');
  ctl.className = 'pctl';

  const k = f.kind;
  const value = f.get(run0, node, doc.canvas);

  if (k.kind === 'number') {
    const el = document.createElement('input');
    el.type = 'number';
    el.setAttribute('data-sel-path', f.path);
    if (k.min !== undefined) el.min = String(k.min);
    if (k.max !== undefined) el.max = String(k.max);
    el.step = String(k.step ?? 1);
    if (value !== undefined) el.value = String(value);
    el.addEventListener('input', () => applySelStyle(f.path, el.value));
    ctl.appendChild(el);
    if (k.suffix) {
      const s = document.createElement('i');
      s.textContent = k.suffix;
      ctl.appendChild(s);
    }
  } else if (k.kind === 'color') {
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'pcolor';
    picker.setAttribute('data-sel-color', '1');
    if (typeof value === 'string' && isHex(value)) picker.value = value;
    // ⚠️ 用 `change` 不是 `input`：拖取色器会连发几十个 `input`，每个都改一次文档 + 重渲一次
    picker.addEventListener('change', () => applySelStyle(f.path, picker.value));

    const el = document.createElement('input');
    el.type = 'text';
    el.className = 'ptext';
    el.setAttribute('data-sel-path', f.path);
    el.setAttribute('data-sel-text', '1');
    el.value = typeof value === 'string' ? value : '';
    el.addEventListener('change', () => applySelStyle(f.path, el.value));

    ctl.appendChild(picker);
    ctl.appendChild(el);
  } else if (k.kind === 'enum') {
    const el = document.createElement('select');
    el.setAttribute('data-sel-path', f.path);
    for (const o of k.options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      el.appendChild(opt);
    }
    if (value !== undefined) el.value = String(value);
    el.addEventListener('change', () => applySelStyle(f.path, el.value));
    ctl.appendChild(el);
  } else if (k.kind === 'toggle') {
    // ⚠️ 开关写回去的是**显式 boolean** —— `false` 意味着"明确不要"（取消元素级的整块下划线），
    //    与"没写（跟随元素级）"不是一回事（见 `selPatchOf`）。
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.setAttribute('data-sel-path', f.path);
    el.checked = !!value;
    el.addEventListener('change', () => applySelStyle(f.path, el.checked));
    ctl.appendChild(el);
  } else {
    // 文本（字体名 / OpenType 特性 / 可变轴）—— ⚠️ 用 `change` 不用 `input`：
    // 这三个是"填完再提交"的值，逐键改文档 + 重渲没有意义。
    const el = document.createElement('input');
    el.type = 'text';
    el.className = 'ptext';
    el.setAttribute('data-sel-path', f.path);
    el.value = value === undefined || value === null ? '' : String(value);
    el.addEventListener('change', () => applySelStyle(f.path, el.value));
    ctl.appendChild(el);
  }

  row.appendChild(name);
  row.appendChild(ctl);
  return row;
}

/**
 * ⭐ **只改选中那几个字**的样式 —— 走编辑器的 `applyRange`，不是改整块。
 *
 * 落地方式是"在选区两头各切一刀、只给中间那段套 patch"（`text-runs.ts`），
 * 所以这里的值要先过 `selPatchOf` 换算（面板写 px、文档存比例）。
 */
function applySelStyle(path: string, value: unknown) {
  const id = editor.textEditId;
  if (!id || !selRange) return;
  const patch = selPatchOf(path, value, doc.canvas);
  if (!patch) return;
  keepSelControls = true;
  try {
    // `applyRange` 是**同步**的（`onChange` 当场回调）⇒ 回来即可复位
    editor.applyRange(id, selRange, patch);
  } finally {
    keepSelControls = false;
  }
}

/** 给选中的那几个字上色（保留的窄入口 —— 探针与老习惯都走它） */
function applySelColor(color: string) {
  applySelStyle('sel.fill', color);
}

function rowFor(f: Field, node: ElementNode): HTMLElement {
  const row = document.createElement('label');
  row.className = 'prow';

  const name = document.createElement('span');
  name.className = 'pname';
  name.textContent = f.label;

  const ctl = document.createElement('span');
  ctl.className = 'pctl';
  const fire = (v: unknown) => {
    editor.patch(node.id, f.path, v);
    // ⚠️ `curve` / `path` 改的是**渲染路径**（普通排版 ↔ SVG `textPath`）。
    //    若这个节点正在被就地编辑（编辑期间会被"摊平"），不退出就看不到弧线效果 ——
    //    用户会以为"改了没反应"。⇒ 改它俩就顺手退出文字态。
    if (f.path === 'curve' || f.path === 'path') editor.endTextEdit();
  };
  const k = f.kind;

  if (k.kind === 'number') {
    const el = document.createElement('input');
    el.type = 'number';
    el.setAttribute('data-path', f.path);
    if (k.min !== undefined) el.min = String(k.min);
    if (k.max !== undefined) el.max = String(k.max);
    el.step = String(k.step ?? 1);
    el.addEventListener('input', () => fire(Number(el.value)));
    ctl.appendChild(el);
    if (k.suffix) {
      const s = document.createElement('i');
      s.textContent = k.suffix;
      ctl.appendChild(s);
    }
  } else if (k.kind === 'color') {
    // 两个框：取色器（只认 6 位 hex）+ 文本框（能写任何 CSS 颜色值）
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'pcolor';
    picker.addEventListener('input', () => fire(picker.value));
    const el = document.createElement('input');
    el.type = 'text';
    el.setAttribute('data-path', f.path);
    el.className = 'ptext';
    el.addEventListener('input', () => {
      fire(el.value);
      if (isHex(el.value)) picker.value = el.value;
    });
    ctl.appendChild(picker);
    ctl.appendChild(el);
  } else if (k.kind === 'enum') {
    const el = document.createElement('select');
    el.setAttribute('data-path', f.path);
    for (const o of k.options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      el.appendChild(opt);
    }
    el.addEventListener('change', () => fire(el.value));
    ctl.appendChild(el);
  } else if (k.kind === 'toggle') {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.setAttribute('data-path', f.path);
    el.addEventListener('change', () => fire(el.checked));
    ctl.appendChild(el);
  } else {
    // `k` 现在只剩 text —— 但 `multiline` 在 text 上才是必填的
    const multiline = k.kind === 'text' && k.multiline === true;
    const el: HTMLInputElement | HTMLTextAreaElement = multiline
      ? document.createElement('textarea')
      : document.createElement('input');
    if (el instanceof HTMLInputElement) el.type = 'text';
    el.setAttribute('data-path', f.path);
    el.className = 'ptext';
    el.addEventListener('input', () => fire(el.value));
    ctl.appendChild(el);
  }

  row.appendChild(name);
  row.appendChild(ctl);
  return row;
}

/**
 * 把面板上的数字**拉回**文档里的当前值。
 *
 * ⚠️ 正在输入的那个框**不动** —— 否则拖数字框拖到一半，光标就被抢走了。
 */
function syncPanelValues() {
  const id = editor.selectedId;
  // ⚠️ 面板上的框都长在**元素**的字段上 ⇒ `findElement`（选中图层时没有任何框，直接返回）
  const node = id ? findElement(doc, id) : null;
  if (!node) return;

  for (const f of editor.fields(id)) {
    const el = panelEl.querySelector(`[data-path="${f.path}"]`) as HTMLInputElement | null;
    if (!el || el === document.activeElement) continue;
    const v = f.get(node);
    if (v === undefined) continue;
    // ⚠️ 开关不是"值"，是 `checked` —— 走 `.value` 会把每个开关都写成 'on'
    if (el.type === 'checkbox') {
      const b = !!v;
      if (el.checked !== b) el.checked = b;
      continue;
    }
    const s = String(v);
    if (el.value !== s) el.value = s;
    if (f.kind.kind === 'color' && isHex(s)) {
      const picker = el.parentElement?.querySelector('.pcolor') as HTMLInputElement | null;
      if (picker && picker.value !== s) picker.value = s;
    }
  }
}

function isHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

paintStatus();
paintPanel();

// ── 探针用的钩子 ─────────────────────────────────────────────────────
(window as unknown as Record<string, unknown>).__VE__ = {
  getDoc: () => doc,
  getZoom: () => ZOOM,
  editor,
  wrap,
  frame,
  issues: () => lastIssues,
  /** 直接给出某个节点当前的点集（给探针断言用） */
  pointsOf(id: string): Array<[number, number]> | null {
    const l = findElement(doc, id);
    if (l && l.type === 'shape' && l.kind === 'polygon') {
      return (l as { points: Array<[number, number]> }).points;
    }
    return null;
  },
  /** 面板上的输入框（探针要填它） */
  fieldInput(path: string): HTMLElement | null {
    return panelEl.querySelector(`[data-path="${path}"]`);
  },
  /** 正在选字的节点（`null` = 不在文字态） */
  textEditId: () => editor.textEditId,
  /** 当前选区（字符下标），给探针断言 */
  selRange: () => selRange,
  /** 当前选区的**绝对字符下标**（跨重渲的真源），给探针断言"选区保住了" */
  selAbs: () => selAbs,
  /** 选中的那几个字是什么，给探针断言 */
  selText(): string | null {
    if (!selRange) return null;
    const n = findElement(doc, editor.textEditId);
    return n && n.type === 'text' ? sliceText(n.runs, selRange) : null;
  },
  /** 选区起点那一段**实际用的字号**（px），给探针断言"真的只改了那几个字" */
  selFontPx(): number | null {
    const id = editor.textEditId;
    const n = id ? findElement(doc, id) : null;
    if (!selRange || !n || n.type !== 'text') return null;
    const r = n.runs[firstRunOf(n.runs, selRange)];
    // ⚠️ 文档里存的就是 px ⇒ 不再乘画布宽（片段覆盖 > 元素级 > 渲染器兜底）
    return r?.fontSizePx ?? n.fontSizePx ?? DEFAULT_FONT_PX;
  },
  /** 选区起点那一段的字重（没写 = 继承元素级） */
  selWeight(): number | null {
    const id = editor.textEditId;
    const n = id ? findElement(doc, id) : null;
    if (!selRange || !n || n.type !== 'text') return null;
    return n.runs[firstRunOf(n.runs, selRange)]?.weight ?? n.weight ?? null;
  },
  /** 探针用它模拟"在颜色框里选了个色" */
  applySelColor,
  /** 探针用它模拟"在字号 / 字重框里改值" */
  applySelStyle,
};
