/**
 * **新链（词汇）的画布编辑器** —— 手势状态机 + 编排。
 * 作用对象是**文档（`DesignDocument`）**，不是 HTML。
 *
 * > 文件原名 `point-editor.ts`（只管顶点）。加了整块变换之后名字不对了 ⇒ 改名。
 *
 * ## 它管两类手势
 *
 * ### 一、整块（任何节点都有）
 *
 * | 动作 | 怎么触发 | 落到文档上 |
 * |---|---|---|
 * | **移动** | 在已选中的层上按住拖 | `rect.x` / `rect.y` |
 * | **缩放** | 拖四角的**方块**柄 | `rect.w` / `rect.h` |
 * | **旋转** | 拖顶部**圆**柄 | `transform.rotate` |
 *
 * ### 二、顶点（只有多边形有）
 *
 * | 动作 | 怎么触发 | 落到文档上 |
 * |---|---|---|
 * | **拖顶点** | 按住**圆点**拖 | `points[index]` 改了 |
 * | **加顶点** | 点边上**任意位置** | `points` 多一个，就长在光标那儿 |
 * | **删顶点** | **双击**圆点 | `points` 少一个（**保底 3**）|
 *
 * **两套手柄并存是刻意的**：**方块**柄 = 动整个框，**圆点**柄 = 动这个形状本身。
 *
 * ### 三、文字选区（只有文字有）—— **Word 那样，选中哪几个字就改哪几个字**
 *
 * | 动作 | 怎么触发 | 落到文档上 |
 * |---|---|---|
 * | **进入** | **双击**文字 | `textEditId` = 那个节点（宿主收到 `onTextEditChange`）|
 * | **选字** | 在画面上**拖**（浏览器的原生选区） | 宿主把 `getSelection()` 递给 `selectionToRange` |
 * | **上色** | `handle.applyRange(id, range, patch)` | `runs` 在选区两头被切开，**只**中间那段带新样式 |
 * | **退出** | Esc / `handle.endTextEdit()` | 宿主把鼠标收回去 |
 *
 * ⚠️ **编辑器不负责"让鼠标能落到画面上"** —— iframe 平时是 `pointer-events:none`
 * （M1 的结论：它是纯渲染器）。进文字态时由宿主把它放开（本文件通过
 * `onTextEditChange` 通知，不去动 iframe 的样式 —— 那是宿主的 DOM）。
 *
 * ## 三条和 `index.ts`（老编辑器）一脉相承的规矩
 *
 * - **D1 · 真源是内部工作副本。** 手势起点从**自己那份 doc** 取，不从渲染产物读回来。
 *   拖动期间只把新值写进子文档的 style（一次赋值，跟手），松手才正式提交。
 * - **D2 · 一次手势 = 恰好一条 `onChange`。** 原地单击不发提交。
 * - **拖拽末尾那次 `click` 必须吃掉。** 浏览器补发的那次 click 坐标在**松手处**，
 *   松手处常常正好压在某条边上 ⇒ 拖完一下，凭空多出一个顶点。
 *
 * ## ⚠️ 这一版**明确不做**的（不是偷偷不管）
 *
 * - **顶点编辑**：`skewX` / `skewY` / `scale` 会让「屏幕位移 → 0–1 位移」不再是
 *   「逆旋转 + 除宽高」，得解矩阵 ⇒ 遇到**不显示圆点柄**，`blockReason` 给原因。
 * - **旋转**：有 `skewX` / `skewY` 时不给旋转柄（同上，实时预览会失真）。
 *   只带 `scale` 的**可以**转 —— 实时预览用的是渲染器**同一个** `transformCss`。
 */

import {
  angleAt,
  boxCenter,
  MIN_SIZE,
  moveBox,
  resizeBox,
  rotateDegrees,
  screenToLocal,
} from './gesture-math';
import { hitDecoration, hitLayer } from './hit-test';
import { ACCENT, createOverlay, type Overlay } from './overlay';
import {
  createPointOverlay,
  EDGE_TOL,
  MIN_EDGE_PX,
  VERTEX_TOL,
  type PointOverlay,
} from './point-overlay';
import {
  dragPoint,
  insertPoint,
  nearestEdge,
  nearestVertex,
  pointsToLocal,
  removePoint,
  type Point01,
} from './points';
import { fieldsFor, findField, findLayerField, selectionSnapshotOf, type Field, type SelectionSnapshot } from './inspector';
import {
  canRedo as stackCanRedo,
  canUndo as stackCanUndo,
  createEditorStack,
  pushCommand,
  redo as stackRedo,
  resetStack,
  undo as stackUndo,
  undoDepth as stackUndoDepth,
  type Command,
  type EditorStack,
} from './editor-stack';
import { applyToRange, type RunPatch, type RunRange } from './text-runs';
import { createTextSession } from './text-session';
// ⚠️ 起别名：本文件对外也暴露同名的 `insertText` / `deleteRange` 方法（那是「编辑器 API」，
//    这两个是「纯函数」）—— 不区分会看不出来哪个是哪个。
import {
  deleteRange as deleteRunRange,
  insertText as insertRunText,
  replaceRunText,
} from './text-edit';
import { effectiveTransform, groupContentBox, groupTransformCss, transformCss } from '../render/vocabulary/emit';
import { containerOf, findElement, findLayer, iterElements } from '../document/vocabulary';
import type {
  DesignDocument,
  ElementNode,
  GroupNode,
  Layer,
  ShapeNode,
} from '../document/vocabulary';
import type { HandleDir, HostDom, LayerDom, LocalBox, LocalPoint, Viewport } from './types';

const OUTLINE = `2px solid ${ACCENT}`;

/**
 * **带位置的节点** —— `GroupNode` 没有 `rect`（它的范围是子元素的并集），
 * 所以凡是「要按盒子算坐标」的地方都得先把它排除掉。
 *
 * ⚠️ 2026-10-16 文档模型改版：这个"任意节点"的联合类型（**旧名 `Layer`**）现在叫
 *    **`ElementNode`**；`Layer` 那个名字归了**图层**（画布的孩子），两者不是一回事。
 */
type Positioned = Exclude<ElementNode, { type: 'group' }>;

/** 只认「多边形」——`rect` / `ellipse` / `path` 没有可以掰的点集 */
type Poly = ShapeNode & { kind: 'polygon' };

function isPoly(n: ElementNode | null | undefined): n is Poly {
  return !!n && n.type === 'shape' && n.kind === 'polygon';
}

/**
 * `containerOf` 给回来的是 `Layer | GroupNode`，而 **`Layer` 没有 `type` 字段**
 * （只有元素才有）⇒ 判"这个容器是不是组"不能直接 `=== 'group'`，得先收窄。
 */
function isGroupContainer(c: Layer | GroupNode | null): c is GroupNode {
  return !!c && 'type' in c && c.type === 'group';
}

export interface VocabEditorOptions {
  doc: DesignDocument;
  /** 一次手势落定 → 宿主拿走新文档去重新渲染。**一次手势只有一条。** */
  onChange?(id: string | null, doc: DesignDocument, label?: string): void;
  onSelect?(id: string | null): void;
  /**
   * 进入 / 退出**文字选区态**。
   *
   * 编辑器只管"什么时候进、什么时候出"与"那块文字能不能编辑"（`textSession`）；
   * **放开 iframe 的 `pointer-events`**（让鼠标真的落到画面上）是宿主的事 ——
   * 那是宿主的 DOM，本文件碰不到也不该碰。
   *
   * ⭐ 第三个参数 `flatten`：**这块文字是不是"沿路径排字"（`curve` / `path`）**。
   *
   * 为什么宿主必须知道：那种文字最终走 SVG `<textPath>`，页面上**没有 `.vt`**、
   * 也挂不上 `contentEditable`（SVG 元素没有这个能力，实测）。
   * ⇒ 编辑期间必须把它**降级成普通文字**再送去渲染，退出后自动回到弧线；
   *   而"降级只发生在送进渲染器的那一份上（深拷贝），文档一个字节都不改"。
   *
   * `flatten: true` = 请宿主**立刻重渲一次**（用降级后的文档）；
   * 退出时（`id === null`）也请重渲一次，好让它回到弧线。
   */
  onTextEditChange?(id: string | null, flatten?: boolean): void;

  /**
   * ⭐ **文字选区变了**（拖选 / 点光标 / 刷完样式之后各报一次）。
   *
   * 给**样式面板**用：面板拿这个快照画出"选中的字能改什么 + 此刻的值"。
   * 没在选字（`null`）= 面板该把那一栏收起来。
   *
   * ⚠️ 只在**真的变了**的时候报（编辑器内部做了指纹比对）—— 不然鼠标每动一下
   *    都要重画一次面板。
   */
  onSelectionChange?(snap: SelectionSnapshot | null): void;
  /**
   * ⭐ **只是文字变了**（在画布上打字 / 退格）—— 与 `onChange` 分开是有意的。
   *
   * 打字是**高频**操作：每敲一个字就走一次 `onChange`（= 整份文档重新 emit + `d.write()`）
   * 会让光标闪、页面卡。所以这条通道的意思是"**数据变了，但结构没变**，
   * 宿主可以只把那段文字就地补上，不必重渲"。
   *
   * ⚠️ **`doc` 必须一起交出去**：编辑器内部拿的是 `cloneDoc()` 出来的**克隆**，
   *    宿主手里的那份是另一个对象 —— 不把新的递过去，宿主就会拿着旧副本
   *    "把刚打的字又写回去"（实测踩过：文字看着没变，DBG 里却明明是 insert 成功了）。
   */
  onTyping?(id: string | null, doc: DesignDocument): void;
}

export interface VocabEditorHandle {
  /** 换根（iframe 重载 / 重渲后是新文档）—— 覆盖层不动，只改它认的子文档 */
  attachRoot(root: LayerDom): void;
  updateDoc(doc: DesignDocument): void;
  /**
   * ⭐ 编辑器**内部工作副本**的引用（不是拷贝、不是宿主手里那份）。
   *
   * 用途只有一个：**宿主判断"我手里这份是不是就是编辑器那一份"**。
   * 编辑器每次编辑完都会把自己这份交给宿主（`onChange` / `onTyping`），
   * 宿主存下后 setState ⇒ 组件重渲 ⇒ `useEffect` 又把它喂回 `updateDoc`。
   * 若不加判断，`updateDoc` 里的 `resetStack` 会把**撤销历史每次编辑清一次**。
   *
   * ⚠️ 不能用"两个对象结构一样"来判断：那是**浅**拷贝，嵌套对象是同一批引用，
   *    结构比较会得出"不一样"，于是又把历史清掉。**只有引用能判准。**
   */
  readonly doc: DesignDocument;
  select(id: string | null): void;
  /** 这个节点当前**能改哪些字段**（给属性面板用；没选中 = 空数组） */
  fields(id: string | null): Field[];
  /** 改一个字段。覆盖层**立刻**跟上，重渲**攒一下**再发（见实现里的注释） */
  patch(id: string, path: string, value: unknown): void;
  /** 当前选中的是不是一个「能编辑顶点」的多边形 */
  readonly editable: boolean;
  /** 正在**选字**的那个文字节点（`null` = 不在文字态） */
  readonly textEditId: string | null;
  /** 退出文字态（宿主也能调：例如点了个"完成"按钮） */
  endTextEdit(): void;
  /**
   * ⭐ **只给选中的那几个字刷样式**（Word 式染色）。
   *
   * `range` 从 `selectionToRange()` 来（浏览器原生选区翻译出来的字符下标）。
   * 刷完 `runs` 会在选区两头被切开 —— 相邻的同款段会自动并回去（见 `text-runs.ts`）。
   */
  applyRange(id: string, range: RunRange, patch: RunPatch): void;
  /**
   * ⭐ **在光标处插入文字**（在画布上打字）。
   *
   * `at` = **绝对字符下标**（"整段文字里的第几个字符"）—— 与选区同一套坐标，
   * 所以"光标在接缝上""跨片段"这些情况都不用单独处理。
   * 插进去的字**继承落点那一段**的样式（见 `text-edit.ts`）。
   *
   * 改完走 `onTyping`（**不是** `onChange`）—— 打字不该触发整份重渲。
   */
  insertText(id: string, at: number, text: string): void;
  /** ⭐ **删掉 `[from, to)`** —— 退格 / 前删 / "有选区时打字"（先删选区再插）都走它 */
  deleteRange(id: string, from: number, to: number): void;
  /**
   * 把**某一段的文字**整体换成 `text`（输入法组合结束时对齐用；见 `text-edit.ts`）。
   *
   * ⚠️ 这是唯一一处"从 DOM 读回文字"的通道 —— 因为 IME 组合期间的 `beforeinput`
   * 不可取消，浏览器已经真的改了 DOM。**只读文字、不读样式**。
   */
  setRunText(id: string, index: number, text: string): void;

  // ── 文字选区（属性面板 / 宿主 UI 用）──────────────────────────────
  //
  // ⚠️ 「在画面上打字 / 选字」这条链路是**自动**的：编辑器自己在子文档上拦
  //    `beforeinput` 等事件（`text-session.ts`），宿主**不需要**把按键递进来。
  //    下面这几个是给**面板**用的：面板要知道"用户现在选了哪几个字"，好把
  //    那 18 项选区样式（`inspector.selectionFields()`）摆出来。
  /** 当前光标 / 选区（**绝对字符下标**）；没进文字态 = `null` */
  absChars(): { start: number; end: number } | null;
  /** 当前选区在 `runs` 上的投影（喂 `applyRange`）；折叠的光标 = `null` */
  selectionRange(): RunRange | null;
  /** 选中的那几个字 */
  selectionText(): string;
  /**
   * ⭐ 给**选中的那几个字**刷样式（Word 式染色）。没选区 / 值不合法 ⇒ `false`。
   *
   * 收 `(path, value)`（`path` 来自 `inspector.selectionFields()`）：
   * px → 0–1 换算、装饰线的"逐项覆盖"合并都在里面做掉 ——
   * 宿主只管把面板上的路径和值递进来，**不必知道 `RunPatch` 的形状**。
   */
  styleSelection(path: string, value: unknown): boolean;

  /**
   * ⭐ **当前文字选区的完整快照**；不在文字态 / 没选字 ⇒ `null`。
   *
   * 这是给**样式面板**的唯一入口：面板照着 `fields` 画控件、用 `get` 拿当前值、
   * 改完把 `(path, value)` 交给 `styleSelection`。宿主**不必知道** `RunPatch` 的形状，
   * 也不必自己去碰 `runs`。
   *
   * ⚠️ 快照是**一次性**的：选区或文档一变就得重新问（面板别缓存它）。
   */
  selectionSnapshot(): SelectionSnapshot | null;
  /**
   * 当前选中的节点**有什么操作做不了**，以及为什么（给 UI 显示；都做得了时是 null）。
   *
   * 目前两类：① 选中的是多边形但顶点编辑被挡住（`skew`/`scale`）；
   * ② 选中的是**组里的元素**、而那个组带变换 ⇒ 拖拽方向会偏。
   * ⚠️ 空着不报 = 让用户对着一个"拖不动"的元素猜原因，那是最糟的一种反馈。
   */
  readonly blockReason: string | null;

  /** ⭐ 撤销一步（返回是否真的撤了）；文字态会先自动退出 */
  undo(): boolean;
  /** ⭐ 重做一步 */
  redo(): boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** 可撤销的步数（给状态条显示） */
  undoDepth(): number;
  /** 调试/未来 UI：栈内命令摘要（before/after 里 title 的文本） */
  dump(): {
    done: Array<{ label: string; before: string[]; after: string[]; at: number; key: string }>;
    undone: Array<{ label: string; before: string[]; after: string[]; at: number; key: string }>;
  };

  /**
   * ⭐ 新增元素（追加到**第一个图层**的末尾 = 最上层）并选中它（进撤销栈）。
   *
   * ⚠️ 方法名里的 "Layer" 是**历史遗留** —— 它加的是**元素**（`ElementNode`），不是图层。
   *    文档模型改成「画布 → 图层 → 元素」之后，"加一个元素"还没说**加进哪个图层**，
   *    所以这里先定一条**临时规则**（见实现里的注释）：加到第一个图层，
   *    一个图层都没有就先建一个默认图层。等图层面板做出来，这个入口应当改成"加进当前图层"。
   */
  addLayer(node: ElementNode): void;
  /** ⭐ 删除元素（组会连子元素一起删；进撤销栈） */
  removeLayer(id: string): void;
  /**
   * ⭐ 调整**它所在的那个容器**里的叠放顺序（`up`/`down`/`top`/`bottom`；进撤销栈；已在目标位置 ⇒ 无操作）。
   *
   * ⚠️ 旧模型里 `doc.layers` 是"所有节点"的扁平表，所以那时这是"顶层顺序"；
   *    现在元素住在图层（或组）里 ⇒ 换的是**同一个容器里的兄弟元素**之间的位置。
   */
  moveLayer(id: string, to: 'up' | 'down' | 'top' | 'bottom'): void;
  readonly selectedId: string | null;
  dispose(): void;
}

/** 一次手势 = 一个事务。四种互斥，`null` = 没在拖。 */
/**
 * 一次手势要**一起搬**的子元素（组专用）。
 *
 * ⭐ 组的平移 / 缩放为什么是"搬子元素"：组**没有 `rect`**（词汇定的），
 * 而 `transform` 又**故意没有 `translate`**（"平移就是 `rect` 的活"）——
 * 两句各自成立，合起来就是"组在数学上无法平移"。
 * ⇒ 语义上最干净的解法：**组的移动就是"把它里面的元素一起搬"**（PS / Figma 同款），
 *    组自己不动（它本来就没有位置）。
 */
interface Kid {
  node: Positioned;
  /** 手势开始时它的 `rect`（0–1），算增量用 */
  rect0: { x: number; y: number; w: number; h: number };
}

type Session =
  | { kind: 'move'; start: LocalBox; origin: LocalPoint; kids?: Kid[] }
  | { kind: 'resize'; dir: HandleDir; start: LocalBox; origin: LocalPoint; kids?: Kid[] }
  | { kind: 'rotate'; start: LocalBox; center: LocalPoint; angle0: number; rotate0: number }
  | { kind: 'vertex'; index: number; origin: LocalPoint; start: Point01[] };

export function createVocabEditor(
  host: HostDom,
  wrap: HTMLElement,
  rootArg: LayerDom,
  opts: VocabEditorOptions,
): VocabEditorHandle {

  /** ⭐ **统一编辑栈**（M2）—— 跨工具混用不乱；见 `undo-stack.ts` */
  const stack: EditorStack = createEditorStack(opts.doc);

  /**
   * ⭐ 所有编辑动作的**唯一出口**：压撤销栈 + 通知宿主。
   * `key` 相同且时间窗内 ⇒ 合并成一条撤销步（面板连点字号 = 一条；见 `commands.ts`）。
   */
  function submit(id: string | null, label: string, key?: string) {
    pushCommand(stack, doc, label, key);
    // ⭐ 第三个参数 = 本次操作的 label：宿主靠它区分「就地编辑」（移动/改样式/打字——
    //    DOM 已就地更新，无需重渲）与「结构性变化」（撤销/重做/增删/排序——必须重新
    //    生成渲染产物，否则画布与文档脱节）。demo 直接重渲不在乎；UI 宿主靠它省网络。
    opts.onChange?.(id, doc, label);
  }
  /** 打字通道：不重渲（宿主就地补 DOM），但**参与合并**（连打 = 一条撤销步） */
  function commitTyping(id: string | null, keySuffix?: string) {
    // ⚠️ keySuffix：换行/粘贴这类要**打断**合并（Enter 后再打的字应是新的一条）
    pushCommand(stack, doc, '输入文字', keySuffix ? `type:${id}:${keySuffix}` : `type:${id}`);
    opts.onTyping?.(id, doc);
  }
  /** 子文档会被换掉（重渲一次就换一份）⇒ 必须可变 */
  let root: LayerDom = rootArg;
  let doc: DesignDocument = cloneDoc(opts.doc);
  let selectedId: string | null = null;
  /** 正在选字的那个文字节点（`null` = 不在文字态）。**与 `session` 互斥** */
  let textEditId: string | null = null;
  let session: Session | null = null;
  /** 手势期间的实时值，松手时提交的就是它 */
  let gestureBox: LocalBox | null = null;
  let gestureRotate: number | null = null;
  let gesturePoints: Point01[] | null = null;

  /** 同 `index.ts`：拖完之后那次补发的 click 要吃掉 */
  let pointerMoved = false;
  const CLICK_SLOP = 4;
  let downAt: { x: number; y: number } | null = null;

  /** 上一次「加顶点」的时刻 —— 用来挡掉双击的第二下 */
  let lastInsert = 0;

  /**
   * 属性面板的重渲要**攒一下**再发。
   *
   * 一次拖动滑块会连来几十个 `input` 事件（老编辑器实测一次拖拽 37 条），
   * 每个都重新 emit + 重写 iframe 太浪费。这里攒 `PATCH_DEBOUNCE` 毫秒，
   * 连续改只发最后一次。
   *
   * ⚠️ 这是**节流不是事务** —— 真正的"一次编辑 = 一个撤销步骤"要等 M2 的命令栈。
   */
  const PATCH_DEBOUNCE = 80;
  let patchTimer: ReturnType<typeof setTimeout> | undefined;
  let patchId: string | null = null;
  let patchPath = '';

  function scheduleCommit(id: string, path: string) {
    patchId = id;
    patchPath = path;
    if (patchTimer) clearTimeout(patchTimer);
    patchTimer = setTimeout(() => {
      patchTimer = undefined;
      if (patchId) submit(patchId, `改 ${patchPath}`, `patch:${patchId}:${patchPath}`);
      patchId = null;
    }, PATCH_DEBOUNCE);
  }

  /**
   * 包围盒那套（四角方块柄 + 顶部旋转柄）——**任何节点**都有。
   *
   * ⚠️ 四角柄往外推到 `-16`：多边形的顶点常常正好在盒子角上，
   * 推得不够远就会被顶点手柄盖住 ⇒ 缩放柄点不到（见 `overlay.ts` 的说明）。
   */
  const boxOverlay: Overlay = createOverlay(host, wrap, -20);
  /** 顶点那套（圆点柄 + 边上加顶点）——**只有多边形**有 */
  const overlay: PointOverlay = createPointOverlay(host, wrap);

  /**
   * ⭐ **文字就地编辑**（打字 / 选字 / 选区染色 / 输入法）。
   *
   * 它归编辑器：双击进文字态是编辑器做的，让那块文字**真的能编辑**是同一件事的后半段。
   * 宿主只剩一件碰不到的事 —— 放开 iframe 的 `pointer-events`（见 `onTextEditChange`）。
   *
   * `commit` 用 `commitTyping`（**不是** `submit`）：打字是高频操作，
   * 它的语义是"数据变了但结构没变"，宿主据此只补那一小段 DOM、不重渲整页。
   */
  const textSession = createTextSession({
    root: () => root,
    textNode: (id) => {
      const l = elementById(id);
      return l && l.type === 'text' ? l : null;
    },
    canvasWidth: () => doc.canvas.width,
    commit: (label) => commitTyping(textEditId, label),
    requestRender: () => {
      // ⚠️ 结构变了（段数变了）⇒ 必须重建节点。编辑器不 emit、不碰 iframe，
      //    只把"该重渲了"这件事说出去；宿主渲完会调 `attachRoot`，届时 `reattach()`。
      if (textEditId) opts.onChange?.(textEditId, doc, '改文字结构');
      else opts.onChange?.(selectedId, doc, '改文字结构');
    },
    onEscape: () => exitTextEdit(),
    onUndo: () => {
      undo();
    },
    onRedo: () => {
      redo();
    },
    onSelectionChange: () => {
      opts.onSelectionChange?.(buildSelectionSnapshot());
    },
  });

  /**
   * ⭐ **选区快照**（样式面板的唯一输入）。
   *
   * 一次算齐：字段 + 每项此刻的生效值 + 选中的文字 + 绝对下标。
   * 面板不必碰 `runs`、不必知道 `RunPatch`。
   *
   * 提成文件级函数（而不是句柄上的方法）是为了让 `textSession` 的
   * `onSelectionChange` 也能调到它 —— 那时句柄对象还没造出来。
   */
  function buildSelectionSnapshot(): SelectionSnapshot | null {
    const id = textSession.id;
    const n = id ? elementById(id) : null;
    if (!n || n.type !== 'text') return null;
    return selectionSnapshotOf(n, textSession.range(), textSession.abs(), textSession.selectedText(), doc.canvas);
  }

  function cloneDoc(d: DesignDocument): DesignDocument {
    return {
      ...d,
      canvas: { ...d.canvas },
      layers: d.layers.map((l) => structuredClone(l) as Layer),
    };
  }

  /**
   * 按 id 找**元素** —— ⭐ **递归**（组里的子元素也必须能选中）。
   *
   * 为什么要递归：点组的子元素时，`elementFromPoint` 命中的是**最上面的那个子元素**
   * （组容器在它下面）⇒ 传进来的 id 是子元素的。只查顶层的话，点组里的东西会**什么都选不中**。
   *
   * ⚠️ 组**本身**不会靠点击选中（点它命中的总是子元素），但这里也返回它 ——
   * 以后图层列表要能选中组。调用方用 `type !== 'group'` 收窄（组没有 `rect`）。
   *
   * ⭐ **改名 + 换实现（2026-10-16 文档模型改版）**：原名 `layerById`。
   *    文档现在是「画布 → 图层 → 元素」，`doc.layers` **已经是图层**（不是节点的扁平表）——
   *    照旧自己写一遍 walk 就会漏掉"遍历所有图层里的元素"这件事
   *    ⇒ 统一走词汇表的 `findElement`（它 = `每个图层 × iterElements` 递归找）。
   */
  function elementById(id: string | null): ElementNode | null {
    return findElement(doc, id);
  }

  /**
   * 这个节点的**祖先里**有没有带变换的组？
   *
   * ⚠️ 有的话**不许拖它**：子元素的 `rect` 是**画布坐标**，而拖拽按屏幕位移算 ——
   * 组一旦整体转了 / 斜切了，鼠标方向与元素实际移动方向就对不上
   * （"往这边拖，它往那边走"）。
   * ⇒ 与"顶点编辑遇 `skew` / `scale` 不给柄"同一个处理方式：
   *    **宁可不给，也不给一个看着能用其实很别扭的操作**，并把原因说出来。
   */
  function ancestorTransform(id: string): boolean {
    // ⚠️ 从"**它所在的容器**"往上走（`containerOf` 给的是**直接**容器，元素可能嵌在组里）。
    //    走到**图层**就停 —— 图层不是组，`containerOf` 对图层返回 `null`，循环自然结束。
    let c: Layer | GroupNode | null = containerOf(doc, id);
    while (isGroupContainer(c)) {
      const t = c.transform;
      if (t?.rotate || t?.skewX || t?.skewY || t?.scale) return true;
      c = containerOf(doc, c.id);
    }
    return false;
  }

  function polyOf(id: string | null): Poly | null {
    const n = elementById(id);
    return isPoly(n) ? n : null;
  }

  /** 椭圆的 **24 点近似**（从顶部起、顺时针）—— 升格用。尺寸不大时与真椭圆肉眼难辨 */
  const ELLIPSE_PTS: Point01[] = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
    return [r4p(0.5 + 0.5 * Math.cos(a)), r4p(0.5 + 0.5 * Math.sin(a))] as Point01;
  });

  /**
   * ⭐ **把解析形状升格成 polygon**（Figma 同款，**单向不可逆**）。
   *
   * `rect` 的形状是"框 + 圆角"一个公式 —— 文档里没有顶点可拖；要逐点编辑，唯一的办法是
   * 把它**变成点集**。不在词汇里给 `rect` 加点集（那会引入"点集 vs `rect.w/h` 两个说法"），
   * 而是**在用户真的要做顶点编辑的这一刻转换**：
   * - `rect` → 4 角点（**圆角丢失**，必须让用户知道）
   * - `ellipse` → 24 点近似圆（尺寸不大时肉眼难辨，放大看是折线）
   * - `path` 不升格（它的 `d` 是曲线，多边形编辑不适用——路径编辑是另一个功能）
   *
   * ⚠️ `rect` 原样保留为**定位框**（polygon 本来就有 `rect` ✓），`radius` 删除。
   * ⚠️ 调用方必须先过 `blocked()`——升格只该发生在"真的要编辑"的这一刻。
   */
  function promoteToPolygon(n: ShapeNode): ShapeNode | null {
    if (n.kind === 'polygon') return n;
    if (n.kind !== 'rect' && n.kind !== 'ellipse') return null;
    const points: Point01[] =
      n.kind === 'rect'
        ? [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ]
        : ELLIPSE_PTS;
    const next = { ...n, kind: 'polygon', points } as ShapeNode;
    delete next.radius;
    return next;
  }

  /**
   * **原位替换**一个元素 —— 写回**它所在的那个容器**的 `elements`。
   *
   * ⚠️ 用 `containerOf` 而不是自己 walk：元素可能在**任意一个图层**里、也可能**嵌在组里**，
   *    "它所在的容器是谁"正是词汇表给出的答案（旧模型里 `doc.layers` 就是那张扁平表，
   *    所以那时可以自己走一遍；现在不行了）。
   */
  function replaceLayer(id: string, next: ElementNode): boolean {
    const c = containerOf(doc, id);
    if (!c) return false;
    const i = c.elements.findIndex((e) => e.id === id);
    if (i < 0) return false;
    c.elements[i] = next;
    return true;
  }

  /**
   * 选中层若是**可升格的解析形状**（`rect` / `ellipse`），先升格成 polygon 再返回。
   * 已经是 polygon ⇒ 原样返回；`path` / 其他 ⇒ `null`。
   *
   * ⚠️ 升格会发一次 `onChange`（文档类型真的变了）⇒ 宿主重渲——
   *    升格**不改视觉**（形状完全一致），所以紧接着的几何计算不受影响。
   * ⚠️ 调用方先过 `blocked()`：组带变换时**不许升格也不许编辑**（改了也是错位置）。
   */
  function ensureEditablePoly(id: string): Poly | null {
    const n = elementById(id);
    if (!n || n.type !== 'shape') return null;
    if (n.kind === 'polygon') return n;
    const promoted = promoteToPolygon(n);
    if (!promoted) return null;
    if (!replaceLayer(id, promoted)) return null;
    submit(id, '转为可编辑多边形');
    syncOverlay();
    return polyOf(id);
  }

  /**
   * 能显示（并升格后可编辑）的顶点集：
   * `polygon` 用自己的点集；`rect` / `ellipse` 用**等效点集**（升格的预览——先给你看顶点在哪，
   * 一拖就转成真 polygon）；`path` 待做（贝塞尔编辑）；其他类型没有顶点。
   */
  function editablePoints(l: ElementNode): Point01[] | null {
    if (l.type !== 'shape') return null;
    if (l.kind === 'polygon') return l.points;
    if (l.kind === 'rect') {
      return [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
    }
    if (l.kind === 'ellipse') return ELLIPSE_PTS;
    return null;
  }

  function viewport(): Viewport {
    const r = wrap.getBoundingClientRect();
    return { originX: r.left, originY: r.top, zoom: doc.canvas.width ? r.width / doc.canvas.width : 1 };
  }

  function localPoint(e: { clientX: number; clientY: number }): LocalPoint {
    return screenToLocal(e.clientX, e.clientY, viewport());
  }

  /**
   * 节点的盒子（**画布 local px**）。
   *
   * ⚠️ `rect` 本身就是画布 px（见 `vocabulary.ts` 的 `Rect`）⇒ **不乘画布**。
   * 曾经这里是 `l.rect.x * doc.canvas.width` —— 那层换算已经消失。
   */
  function boxOf(l: Positioned): LocalBox {
    return { left: l.rect.x, top: l.rect.y, width: l.rect.w, height: l.rect.h };
  }

  /**
   * **任意**节点的盒 —— 组没有 `rect`，取**子元素 `rect` 的并集**。
   *
   * ⚠️ 组为什么也得有盒：组是**能选中、能移动**的（移动 = 把它里面的元素一起搬），
   *    而选中就得画包围盒。
   *
   * ⚠️ 这里**直接复用渲染器那一份**（`emit.ts` 的 `groupContentBox`），不再自己写第二遍。
   *    原先两份口径不同：编辑器那份把**组自己的 `rotate` 也算进框里**（框 = 旋转后的包围盒），
   *    渲染器那份不算（旋转由 `groupTransformCss` 在 CSS 层做）
   *    ⇒ 于是框先转一次、`syncOverlay` 又按 `rotateOf` 转第二次 ⇒ **转两遍**。
   *
   * 现在只有一份实现：返回**未旋转**的内容框，旋转交给 `transformCss` / `groupTransformCss`。
   *
   * ⚠️ 两份实现都**不算子元素自身的 `transform`**（转过的子元素实际占地更大）⇒
   *    框会偏小一点。组框本来就是近似值，别当精确包围盒用。
   */
  function boxOfAny(l: ElementNode): LocalBox {
    if (l.type !== 'group') return boxOf(l);
    return groupContentBox(l, doc.canvas);
  }

  /**
   * 任意节点的**产物同款** CSS transform 串（含 `transform-origin`），空串 = 不变换。
   *
   * ## ⚠️ 必须分两种，不能都走 `groupTransformCss`
   *
   * 我第一版写成了"统一走 `groupTransformCss`"，理由是数学上等价（普通节点的容器
   * 就是它自己那个盒 ⇒ 百分比口径相同）。**但它会崩**：
   * `groupTransformCss` 内部要遍历 `node.elements`，而普通节点**没有 `elements`**
   * ⇒ `TypeError: ls is not iterable`。
   *
   * 更糟的是它在 `select()` 的路径上 ⇒ **一选中就抛异常**，整个选中/覆盖层流程中断。
   *
   * ⇒ 按类型分派：
   * - **组**：容器铺满画布 ⇒ 原点百分比相对**画布** ⇒ 走 `groupTransformCss`（它换算）
   * - **普通节点**：容器就是它自己的盒 ⇒ 原点相对**盒子** ⇒ 走 `transformCss`
   */
  function transformOf(l: ElementNode): string {
    if (l.type === 'group') return groupTransformCss(l, doc.canvas);
    // ⚠️ 必须过一遍 `effectiveTransform`（文字上的 scale 非法、渲染时会丢）——
    //    否则覆盖层按"带 scale"画、产物按"没 scale"画，拖一下就对不上。
    return transformCss(effectiveTransform(l));
  }

  /**
   * 收集组里**所有真正占地方的节点**（有 `rect` 的那些；组自己不算）。
   *
   * ⚠️ 遍历交给词汇表的 `iterElements`（深度优先、**含嵌套**）—— 组里还能再套组，
   *    自己写 walk 迟早和别处那份走岔（这里原先就是自己递归 `children` 的）。
   */
  function collectLeaves(l: ElementNode): Positioned[] {
    if (l.type !== 'group') return [l];
    const out: Positioned[] = [];
    for (const e of iterElements(l)) if (e.type !== 'group') out.push(e);
    return out;
  }

  /**
   * 光标点到的 `rawId`（DOM 里最上面那个）**最终该选中谁**。
   *
   * ⭐ 规则（与 Figma / PS 同一套）：
   * - 点在组里 ⇒ 选中**最外层的那个组**（"组是一个整体"）
   * - 那个组**已经选中了** ⇒ 再点一下就**下钻**，选中被点的那个元素
   * - 按住 Ctrl / ⌘ / Alt ⇒ 直接下钻（一步到位）
   *
   * ⚠️ 为什么需要它：`elementFromPoint` 只能告诉你"最上面那个元素是哪个"，
   * 而"组"这个概念它**不认识** —— 组容器在子元素**下面**，靠点击永远选不到。
   */
  function resolveSelection(rawId: string | null, deep: boolean, p?: LocalPoint): string | null {
    if (deep) return rawId ?? (p ? groupAtPointer(p) : null);
    if (rawId) {
      const outer = outermostGroupOf(rawId);
      if (!outer) return rawId;
      if (selectedId === outer) return rawId; // 已选着这个组 ⇒ 下钻
      return outer;
    }
    // ⭐ 没点在任何元素上，但落在**组的内容范围**里 ⇒ 选那个组。
    //    ⚠️ 组容器是 `.vg{pointer-events:none}`（见 `emit.ts`）—— 它**故意**不吃指针：
    //    一个铺满画布的透明容器若吃了指针，底下所有元素就再也点不中
    //    （渲染器注释里记着那次"一下午拿不到顶点手柄"的教训）。
    //    ⇒ "点组内空白选中组"这件事只能由**编辑器按几何**补上，不能指望 DOM 命中。
    return p ? groupAtPointer(p) : null;
  }

  /**
   * 指针是否落在某个**顶层组**（= 直接待在某个图层里的组）的内容范围里 —— 命中则返回组 id（没有则 `null`）。
   *
   * ⚠️ 口径必须与渲染侧 `emit.ts` 的 `groupContentBox` 一致：**子元素 `rect` 的并集**，
   *    不含子元素自身的 `transform`。两边不一致的话，"看起来在组里"和"实际选中组"会分叉。
   */
  function groupAtPointer(p: LocalPoint): string | null {
    // ⚠️ 现在有**两层**顺序：`doc.layers`（图层之间）与 `layer.elements`（图层内）——
    //    两层都得**从后往前**扫，先命中的才是画面上真正"最上面那个组"
    //    （数组后写的画在上面）。
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const els = doc.layers[i].elements;
      for (let j = els.length - 1; j >= 0; j--) {
        const e = els[j];
        if (e.type === 'group' && coversPoint(e, p)) return e.id;
      }
    }
    return null;
  }

  /** 组（含嵌套）的子元素并集是否含这个点 */
  function coversPoint(g: GroupNode, p: LocalPoint): boolean {
    const walk = (list: readonly ElementNode[]): boolean => {
      for (const l of list) {
        if (l.type === 'group') {
          if (walk(l.elements)) return true;
          continue;
        }
        // `rect` 就是画布 px ⇒ 命中判定直接用它的四个数
        const b = l.rect;
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return true;
      }
      return false;
    };
    return walk(g.elements);
  }

  /** 从 `id` 往上找**最外层**的祖先组（`id` 本身就是顶层 ⇒ `null`） */
  function outermostGroupOf(id: string): string | null {
    // ⚠️ 旧实现是"自上而下 walk `doc.layers`（那时它是所有节点的扁平表），
    //    第一个命中的就是最外层"。现在改成**从它所在的容器往上走**：
    //    最后记下的那个组就是最外层（图层不是组 ⇒ 走到图层自然停）。
    let found: string | null = null;
    let c: Layer | GroupNode | null = containerOf(doc, id);
    while (isGroupContainer(c)) {
      found = c.id;
      c = containerOf(doc, c.id);
    }
    return found;
  }

  /**
   * 组的移动 / 缩放**预览**：直接给**组容器**加一层 CSS 变换。
   *
   * ⭐ 为什么这么省事：组容器是**铺满画布**的 div ⇒ 给它加 `translate` / `scale`
   *    就等于"整组在动 / 在缩放"，**一个子元素都不用碰**。
   *    （真正落地在 `endGesture`：位移与缩放写进每个子元素的 `rect`。）
   *
   * ⚠️ 支点取**起始框左上角**（配合 `translate` 才是"按框缩放"）；组的 `rotate` 拼在最里层。
   * ⚠️ 缩放会把内容一起拉（文字会变形）—— **预览够用**，松手重渲就是精确的。
   * ⚠️ 松手后必须**清掉**这些内联样式（`endGesture` 用 `previewGroup(id, start, start)` 复位）。
   */
  function previewGroup(id: string | null, start: LocalBox, box: LocalBox) {
    const el = id ? (root.querySelector(`[data-layer="${cssEscape(id)}"]`) as HTMLElement | null) : null;
    if (!el) return;
    const n = elementById(id);
    const rot = n?.type === 'group' && n.transform?.rotate ? ` rotate(${n.transform.rotate}deg)` : '';
    const dx = box.left - start.left;
    const dy = box.top - start.top;
    const sx = start.width ? box.width / start.width : 1;
    const sy = start.height ? box.height / start.height : 1;
    el.style.transformOrigin = `${((start.left / doc.canvas.width) * 100).toFixed(4)}% ${((start.top / doc.canvas.height) * 100).toFixed(4)}%`;
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})${rot}`;
  }

  function rotateOf(l: ElementNode): number {
    return l.transform?.rotate ?? 0;
  }

  /**
   * 单个角度 → 覆盖层能吃的 transform 串。
   *
   * ⚠️ 只给**旋转手势进行中**的实时预览用（那时角度还没写回文档）。
   * 其余场合一律用 `transformOf(node)` —— 否则 `skewX` / `scale` / 自定义 `origin` 会丢。
   */
  function rotateCss(deg: number, box?: LocalBox): string {
    if (!deg) return '';
    const origin = box
      ? `transform-origin:${((box.left + box.width / 2) / doc.canvas.width * 100).toFixed(4)}% ` +
        `${((box.top + box.height / 2) / doc.canvas.height * 100).toFixed(4)}%`
      : 'transform-origin:center';
    return `transform:rotate(${deg}deg);${origin}`;
  }

  /** 斜切 / 缩放 ⇒ 不启用**顶点**编辑（见文件头） */
  /**
   * 这个节点的**顶点编辑能不能做**；不能就给出原因。
   *
   * ⚠️ 三处共用：拖顶点（`onPointerDown`）/ 加顶点（`onClick`）/ 删顶点（`onDblClick`）
   * —— 只要这里挡住，三条路一起安全。
   *
   * ⚠️ **祖先组带变换**也算挡住：顶点拖拽的逆变换只用了**节点自己的 `rotate`**
   * （`dragPoint` 的入参），**没算组的**；"点边加顶点"那边更是直接把屏幕点当局部点用 ⇒
   * 组一转，加出来的点就落在**别处**（不是崩，是悄悄改错地方 —— 更糟）。
   * 与"拖组内元素"同一个道理：**宁可不给，也不给个别扭/出错的**。
   */
  /**
   * **这个元素所在的图层被锁定了吗** —— 锁了就返回图层 id，否则 null。
   *
   * 从元素往上走到**图层**（`containerOf` 给的是直接容器，所以`null` 时就说明已经到顶 ⇒
   * 它的父就是图层）。隐藏的图层不用管：隐藏的图层不产出 DOM，压根点不到。
   */
  function lockedLayerOf(id: string): string | null {
    let cur = id;
    for (;;) {
      const owner = containerOf(doc, cur);
      if (!owner) break;
      cur = owner.id;
    }
    const layer = findLayer(doc, cur);
    return layer && layer.locked === true ? layer.id : null;
  }

  function blocked(l: ElementNode): string | null {
    // ⭐ **锁定的图层**：里面所有元素都不能改（选中/拖动/旋转/顶点一律挡住）。
    //    `locked` 只给编辑器看，渲染完全忽略它（见 `vocabulary.ts` 的 `Layer.locked`）。
    const lock = lockedLayerOf(l.id);
    if (lock) return `图层「${lock}」被锁定 —— 先在「图层」页取消锁定`;
    const t = l.transform;
    if (t?.skewX || t?.skewY) return '这个节点有斜切，顶点编辑这一版不支持';
    if (t?.scale && (t.scale.x !== 1 || t.scale.y !== 1)) return '这个节点有缩放，顶点编辑这一版不支持';
    if (ancestorTransform(l.id)) {
      return '在带变换的组里 —— 顶点编辑的坐标换算没算组上的变换，会改错地方；先改组上的变换，或把它移出组';
    }
    return null;
  }

  /** 只有斜切会挡住**旋转**（带 `scale` 能转：实时预览用渲染器同一个 `transformCss`） */
  function rotateBlocked(l: ElementNode): boolean {
    return !!(l.transform?.skewX || l.transform?.skewY);
  }

  // ── 覆盖层同步 ────────────────────────────────────────────────────
  let blockReason: string | null = null;

  function syncOverlay() {
    const l = elementById(selectedId);

    // ── 包围盒：任何选中的节点都显示 ──────────────────────────────
    if (!selectedId || !l) {
      boxOverlay.hide();
    } else {
      // ⭐ 组也算盒（**子元素并集**）—— 组能选中、能拖，就得有个框看得见
      boxOverlay.show(boxOfAny(l), transformOf(l));
      // 有斜切 ⇒ 不给旋转柄（实时预览会失真，见文件头）
      boxOverlay.rotateEl.style.display = rotateBlocked(l) ? 'none' : '';
    }

    // ── 顶点：只有多边形、且没被挡住才显示 ────────────────────────
    if (!selectedId || !l || l.type === 'group') {
      overlay.hide();
      blockReason = null;
      return;
    }
    // ⚠️ 原因必须在这里算（`onPointerDown` 里赋值会被下一次 `syncOverlay` 覆盖，UI 永远读不到）。
    //    "祖先组带变换"这一条已经并进 `blocked()` 了 —— 一处判断，三处共用。
    const why = blocked(l);
    blockReason = why;
    // ⭐ rect / ellipse 也显示**等效顶点**（升格的预览）：先让你看见顶点在哪，一拖就转成 polygon
    const pts = editablePoints(l);
    if (!pts || why) {
      overlay.hide();
      return;
    }
    overlay.show(boxOf(l), transformOf(l), pts!);
    // 换了选中 / 换了点集 ⇒ 先收起"跟着光标走"的插入点（下一次 pointermove 会重新摆）
    overlay.setHover(null, null);
  }

  // ── 写回子文档（拖动期间的实时反馈：一次赋值，跟手；松手才提交）────
  function layerEl(id: string): HTMLElement | null {
    const el = root.querySelector(`[data-layer="${cssEscape(id)}"]`) as HTMLElement | null;
    if (!el) warnMissing(id, '容器');
    return el ?? null;
  }

  /**
   * **实时写回顶点** —— 拖动期间的跟手反馈。
   *
   * ## ⚠️ 这里必须是**像素**，不能直接把 0–1 点集塞进去
   *
   * 产物里 `polygon` 的坐标口径由渲染器决定，而 `emitShape` 走的是**像素**：
   *
   * ```html
   * <svg viewBox="0 0 360 240"><polygon points="180,0 360,240 0,240"/>   ← 像素
   * ```
   *
   * （`path` 才是 0–1 + `transform="scale(W,H)"`；`polygon` 为了描边不变形用了像素。）
   *
   * 而文档里的 `polygon.points` 恒为 **0–1**。早先这里直接把 0–1 写进 `points`，
   * 于是在像素口径的 viewBox 里，整块图形塌成左上角**不到 1px** 的一点 ——
   * 实测：360×240 的多边形只剩 **1.0×0.8 px（0.28%）**，看起来就是"画面丢了"。
   * 加顶点那一刻就会写一次，所以**一点上就没了**，再拖也回不来。
   *
   * ⇒ 唯一正确做法：**在这里换算成像素**，与 `emitShape` 同一套算法
   * （`p[0] * b.width`，`r4` 同精度）——两边口径必须一致，否则松手重渲会跳。
   */
  function writePoints(id: string, points: readonly Point01[], box: LocalBox) {
    const el = root.querySelector(`[data-layer="${cssEscape(id)}"] polygon`);
    if (!el) {
      warnMissing(id, 'polygon');
      return;
    }
    el.setAttribute(
      'points',
      points.map(([x, y]) => `${+(x * box.width).toFixed(4)},${+(y * box.height).toFixed(4)}`).join(' '),
    );
  }

  /**
   * ⭐ **顶点一改就重算包围盒，并把点重新归一化回 [0,1]。**
   *
   * ## 为什么必须有这一步
   *
   * `polygon.points` 的分母是**它自己的 `rect`**（见 `document/README.md` 的分母表）。
   * 用户可以把顶点拖到盒子**外面** —— 于是：
   *
   * ```
   *   点集里有 -0.06 / 1.4 这种值        ⇒ 形状已经跑到框外
   *   而 rect 还是老样子                  ⇒ 框**圈不住**形状
   *   ⇒ 之后拖框缩放，形状"看起来没反应"  ← 这就是那个 bug 的症状
   * ```
   *
   * 实测坏样本（`s1792035627369`）：`rect` 是 24×52，点集却跑到 `-24` 和 `166`。
   *
   * ## 做法：**把框挪到点集的新包围盒上**
   *
   * ```
   *   旧：box{left:100,top:100,w:200,h:200}  点（盒内 px）[[-80,-60],[200,0],[100,200]]
   *   新：box{left:20, top:40, w:280,h:260}  点归一化 [[0,0],[1,0.2308],[0.6429,1]]
   * ```
   *
   * **形状在屏幕上一个像素都没动**（因为新框 = 点集的紧包围盒，归一化只是换了参照），
   * 换来的是"框永远是真实包围盒"。
   *
   * ## 顺序依赖
   *
   * 先算新框 ⇒ 再按新框写 DOM（`setBoxStyle` + `writePoints`）⇒ 覆盖层的顶点位置
   * 从文档重算，自动对上。**不能反过来**（先写点会把点写进旧框的像素空间）。
   */
  function normalizePolygon(id: string): void {
    const n = elementById(id);
    if (!n || n.type !== 'shape' || n.kind !== 'polygon') return;

    const box = boxOf(n);
    const pts = n.points;
    if (!pts.length) return;

    // 点集的**盒内 px** 包围盒 —— 用 `emitLimit` 同一套换算（`p * 盒宽`）
    const px = pts.map(([x, y]) => [x * box.width, y * box.height] as [number, number]);
    const xs = px.map((p) => p[0]);
    const ys = px.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    // ⚠️ 退化情况：所有点共线 / 重合 ⇒ 宽或高为 0 ⇒ **别动**（框会塌成 0，元素直接消失）
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < MIN_SIZE || h < MIN_SIZE) return;

    // 新框（画布 px）：把包围盒搬到画布坐标上
    const nextBox: LocalBox = { left: box.left + minX, top: box.top + minY, width: w, height: h };

    // 点重新归一化：先减包围盒原点，再除新宽高
    n.points = pts.map(([x, y]) => {
      const lx = x * box.width - minX;
      const ly = y * box.height - minY;
      return [r4p(lx / w), r4p(ly / h)] as Point01;
    });

    n.rect = { x: r4p(nextBox.left), y: r4p(nextBox.top), w: r4p(nextBox.width), h: r4p(nextBox.height) };

    // ⚠️ 顺序：先把新框写进 DOM，再写点（点的像素换算要用**新**框）
    setBoxStyle(id, nextBox);
    writePoints(id, n.points, nextBox);
  }

  /**
   * 找不到元素时的**告警**（每个 id 只说一次）。
   *
   * ⚠️ 这三个写 DOM 的函数（`layerEl` / `writePoints` / `setTransformStyle`）原本都是
   * **`if (!el) return` 静默返回** —— 后果是"拖动时框在动、形状不动，而控制台一片安静"，
   * 排查只能靠猜（实测被这个坑掉半天）。所以宁可吵一点：**说不出话比说错话更难查。**
   */
  const warnedMissing = new Set<string>();
  function warnMissing(id: string, what: string): void {
    const key = `${id}/${what}`;
    if (warnedMissing.has(key)) return;
    warnedMissing.add(key);
    const have = Array.from(root.querySelectorAll('[data-layer]'))
      .map((e) => e.getAttribute('data-layer'))
      .join(', ');
    console.warn(
      `[editor] 实时反馈写不进去：找不到 [data-layer="${id}"] 的 ${what}。\n` +
        `  子文档里实际有的 id: ${have || '(一个都没有)'}\n` +
        `  ⇒ 要么这个节点不在当前渲染的文档里，要么 data-layer 没打上（看 emit.ts）。`,
    );
  }

  function setBoxStyle(id: string, box: LocalBox) {
    const el = layerEl(id);
    if (!el) return;
    el.style.left = `${box.left}px`;
    el.style.top = `${box.top}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
    // ⭐ shape 的**几何画在内嵌 `<svg>` 里**，而那个 svg 有自己的宽高/viewBox
    //    ⇒ 只改外层 div 的 w/h 是**看不见效果的**（形状尺寸不变，只有选中框在动）。
    //    这是"框变大、形状不动、刷新才对"的**真正原因**（刷新会重新 emit，那时才按新盒算）。
    syncShapeSvg(id, box);
  }

  /**
   * 把外层盒子的尺寸**同步进内嵌 `<svg>` 的几何** —— 形状的实时反馈靠它。
   *
   * ## 为什么必须做这一步
   *
   * `emitShape` 的产物是"盒子 div + 内嵌 svg"，而**几何是写死的绝对值**：
   *
   * ```html
   * <div data-layer="slab" style="width:265.5px;height:142.25px">
   *   <svg viewBox="0 0 378 216" width="378" height="216">
   *     <polygon points="7.56,0 378,0 370.44,216 0,216"/>    ← 盒内 px
   *   </svg>
   * </div>
   * ```
   *
   * ⇒ 只改外层 div 的 `w/h`，**画面纹丝不动**（svg 还是旧尺寸），只有选中框在动。
   * 这就是"拖框放大、形状不变、刷新才对"的**真正原因** —— 刷新会重新 emit，那时才按新盒算。
   *
   * ## 四种几何各自的改法（**不能统一处理**）
   *
   * | `kind` | 产物 | 盒子变了改什么 |
   * |---|---|---|
   * | `rect` | `<rect width=W height=H rx=R>` | ⚠️ **图元自带绝对宽高** ⇒ 改 `width` / `height`；圆角按**新短边**重算 `rx` |
   * | `ellipse` | `<ellipse cx=W/2 cy=H/2 rx=W/2 ry=H/2>` | 改 `cx` / `cy` / `rx` / `ry`（半径是盒子的函数） |
   * | `polygon` | `<polygon points="…">` | 改 `points`（由 `writePoints` 负责）+ svg 三属性 |
   * | `path` | `<path d="…" transform="scale(W,H)">` | 改那条 **`scale(W,H)`**（`d` 是 0–1，不动） |
   *
   * ⚠️ 我第一版只改了 svg 的 `viewBox/width/height` —— **对 `rect`/`ellipse` 完全无效**
   *    （它们的图元宽高是绝对值，不受 viewBox 影响）。是这次实测纠正的。
   *
   * ⚠️ **文字（`.vt`）与图片（`<img>`）不走这里**：它们吃 CSS 百分比 / `object-fit`，
   *    外层盒子一变就自动跟着变，本来就不需要同步。
   */
  function syncShapeSvg(id: string, box: LocalBox): void {
    const n = elementById(id);
    if (!n || n.type !== 'shape') return;
    // ⚠️ 用**后代选择器**而不是 `>` 子选择器：语义在此等价（svg 就是那一层的直接子元素，
    //    层内也不会再有别的 svg 外层），而后代写法在与真浏览器行为一致的简单选择器子集里
    //    也更稳（探针的假 DOM 只实现了一套简化选择器）。
    const svg = root.querySelector(`[data-layer="${cssEscape(id)}"] svg`) as SVGSVGElement | null;
    if (!svg) return;

    const W = Math.max(1, box.width);
    const H = Math.max(1, box.height);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));

    if (n.kind === 'rect') {
      const r = svg.querySelector('rect');
      if (!r) return;
      r.setAttribute('width', String(W));
      r.setAttribute('height', String(H));
      // 圆角：与 `emitShape` 同一算法（`round(radius × 短边)`，上限半个短边）
      if (r.hasAttribute('rx')) {
        const short = Math.min(W, H);
        const rv = typeof n.radius === 'number' ? n.radius : (n.radius?.[0] ?? 0);
        const rr = Math.min(Math.round(rv * short), Math.round(short / 2));
        r.setAttribute('rx', String(rr));
      }
    } else if (n.kind === 'ellipse') {
      const e = svg.querySelector('ellipse');
      if (!e) return;
      e.setAttribute('cx', String(r4(W / 2)));
      e.setAttribute('cy', String(r4(H / 2)));
      e.setAttribute('rx', String(r4(W / 2)));
      e.setAttribute('ry', String(r4(H / 2)));
    } else if (n.kind === 'path') {
      const p = svg.querySelector('path[transform]');
      if (p) p.setAttribute('transform', `scale(${W},${H})`);
    } else if (n.kind === 'polygon') {
      // ⚠️ **多边形的 `points` 也必须按新盒子重写** —— 它是"盒内 0–1 × 盒宽"。
      //    漏了这一步的后果很隐蔽：svg 的 viewBox 变了、`points` 没变 ⇒
      //    形状被**缩放**（viewBox 放大但点还是旧值）而不是"跟着盒子长"。
      //    （多边形本来就是这个盒子的**内容**，盒子缩放它就该等比缩放。）
      //    注意顺序：这里用**新框**写，与 `normalizePolygon` 的"先框后点"一致。
      writePoints(id, n.points, box);
    }
  }

  /**
   * 实时改旋转。
   *
   * ⚠️ 必须走**渲染器同一个** `transformCss` —— 自己按印象拼一个，
   * 就会出现「拖的时候看着对、松手重渲又跳一下」。
   */
  function setTransformStyle(id: string, rotate: number) {
    const l = elementById(id);
    const el = layerEl(id);
    if (!l || !el) return;
    // ⚠️ 组走另一条：容器是**画布大小**，`transform-origin` 的百分比口径不同，
    //    支点要按**内容框**换算（见 `groupTransformCss`）。
    const css =
      l.type === 'group'
        ? groupTransformCss({ ...l, transform: { ...(l.transform ?? {}), rotate } }, doc.canvas)
        : transformCss({ ...(effectiveTransform(l) ?? {}), rotate });
    // `transformCss` 给的是一整串声明（`transform:…;transform-origin:…`），逐条设回去
    for (const decl of css.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      el.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
    }
  }

  function outline(id: string | null) {
    for (const el of Array.from(root.querySelectorAll('[data-layer]'))) {
      const e = el as HTMLElement;
      if (e.getAttribute('data-layer') === id) e.style.outline = OUTLINE;
      else if (e.style.outline) e.style.outline = '';
    }
  }

  // ── 选中 ───────────────────────────────────────────────────────────
  function select(id: string | null, notify = true) {
    selectedId = id;
    outline(id);
    syncOverlay();
    if (notify) opts.onSelect?.(id);
  }

  // ── 命中 ─────────────────────────────────────────────────────────
  /**
   * **只有顶点手柄看 `e.target`**，其余全部按**坐标**判。
   *
   * 为什么分两种：
   * - 顶点手柄在 `pointerdown` 里判，那时**还没** `setPointerCapture`，`target` 是准的；
   * - 加顶点 / 删顶点发生在 `click` / `dblclick`，那时 `target` **已经被捕获重定向**成 `wrap`
   *   （见 `onDblClick` 那条注释）⇒ 只能按坐标。
   *
   * 而且按坐标判还有个额外好处：**加顶点不必瞄准那个小圆点** ——
   * 整条边都算数，位置由光标**投影**到边上决定（想加哪儿加哪儿）。
   */
  function hitVertexDeco(target: EventTarget | null): number {
    const el = target as Element | null;
    if (!el || typeof el.closest !== 'function') return -1;
    const v = el.closest('[data-ve-vtx]');
    return v ? Number(v.getAttribute('data-ve-vtx')) : -1;
  }

  /**
   * 光标压在哪条边上。返回 `{ edge, t, at }`；离所有边都远 → `null`。
   *
   * `t` 是投影参数（0 = 这条边的起点，1 = 终点）—— **加顶点就加在这儿**。
   */
  function edgeUnder(p: LocalPoint): { edge: number; t: number; at: LocalPoint } | null {
    const poly = polyOf(selectedId);
    if (!poly || blocked(poly)) return null;
    const hit = nearestEdge(poly.points, boxOf(poly), p);
    if (!hit || hit.length < MIN_EDGE_PX) return null;
    // 离边太远 = 点在图形里面或外面，不是"点边"
    if (Math.hypot(hit.at.x - p.x, hit.at.y - p.y) > EDGE_TOL) return null;
    return hit;
  }

  /** 更新「加顶点」小圆点的位置：光标在边上就跟过去，不在就回边中点 */
  function syncHover(p: LocalPoint | null) {
    if (!p) {
      overlay.setHover(null, null);
      return;
    }
    const poly = polyOf(selectedId);
    // 光标压在某个顶点上时**不显示**插入点：那儿归"拖 / 删顶点"管，
    // 两个提示叠在一起既是噪音，也让人分不清点下去会发生什么。
    if (poly && !blocked(poly)) {
      const onVertex = nearestVertex(pointsToLocal(poly.points, boxOf(poly)), p, VERTEX_TOL) >= 0;
      if (onVertex) {
        overlay.setHover(null, null);
        return;
      }
    }
    const hit = edgeUnder(p);
    overlay.setHover(hit ? hit.edge : null, hit ? hit.at : null);
  }

  // ── 文字选区态 ───────────────────────────────────────────────────
  /**
   * 进入文字态：**不许再起任何手势**（拖框 / 转 / 拖顶点全停）。
   *
   * 为什么必须停：进入后宿主会把 iframe 的 `pointer-events` 放开，鼠标落到画面上
   * 去**拖选文字**。这时候编辑器再抢鼠标，用户就永远选不中字 ——
   * 只会把整个文字框拖走。
   */
  function enterTextEdit(id: string) {
    if (textEditId === id) return;
    textEditId = id;
    // 沿路径排字的（`curve` / `path`）编辑期间要**降级成普通文字**才能打字 ——
    // 它的产物是 SVG `<textPath>`，没有 `.vt`、也挂不上 `contentEditable`。
    // ⇒ 把这件事报给宿主，由它重渲一份"摊平版"（**文档一个字节都不改**）。
    const n = elementById(id);
    const flatten = !!(n && n.type === 'text' && (n.path || n.curve));
    // ⭐ **让那块文字真的能编辑**（`contentEditable` + 聚焦 + 挂子文档监听）。
    //    这件事归**编辑器**：双击进文字态本来就是它做的，让文字可编辑是同一件事的后半段。
    //    ⚠️ 老链把它放在宿主侧适配器（`target.ts`）里，编辑器换新时整条掉了 ——
    //       于是"双击能打字"在生产界面上一度直接不存在（见 `text-session.ts` 的文件头）。
    textSession.enter(id);
    opts.onTextEditChange?.(id, flatten);
  }

  function exitTextEdit() {
    if (textEditId === null) return;
    const wasFlattened = (() => {
      const n = elementById(textEditId);
      return !!(n && n.type === 'text' && (n.path || n.curve));
    })();
    textEditId = null;
    textSession.exit();
    // 摊平过的 ⇒ 退出时要重渲一次让它回到弧线（`flatten: false` = "该还原了"）
    opts.onTextEditChange?.(null, wasFlattened);
  }

  // ── 手势 ───────────────────────────────────────────────────────────
  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    // 在选字 ⇒ 鼠标归画面，编辑器不插手
    if (textEditId) return;
    downAt = { x: e.clientX, y: e.clientY };
    pointerMoved = false;

    const p = localPoint(e);

    // ① 顶点手柄（只有多边形有）
    const vi = hitVertexDeco(e.target);
    let poly = polyOf(selectedId);
    // ⭐ 点在**解析形状**（rect / ellipse）的等效顶点上 ⇒ 先升格成 polygon（单向，Figma 同款）
    //    ⚠️ 先过 `blocked`：组带变换时**不许升格也不许编辑**（改了也是错位置）
    const selfV = elementById(selectedId);
    if (vi >= 0 && selfV?.type === 'shape' && (selfV.kind === 'rect' || selfV.kind === 'ellipse') && !blocked(selfV)) {
      poly = ensureEditablePoly(selectedId!);
    }
    if (vi >= 0 && poly && !blocked(poly)) {
      session = {
        kind: 'vertex',
        index: vi,
        origin: p,
        start: poly.points.map((q) => [q[0], q[1]] as Point01),
      };
      gesturePoints = session.start;
      overlay.setActive(vi);
      capture(e);
      // ⚠️ **不能**在这里 `preventDefault()`：它会把随后那次 `dblclick`
      // 一起吃掉 ⇒ 双击顶点删不掉。抑制文字选择改在 `mousedown` 里做（同 `index.ts`）。
      return;
    }

    // ② 包围盒：四角**方块**柄 = 缩放，顶部**圆**柄 = 旋转
    const node = elementById(selectedId);
    const deco = hitDecoration(e.target);
    if (node) {
      // ⭐ 组也有这两套柄了：
      //    - 缩放 = 按框缩放**里面的元素**（`endGesture` 走 `kids` 那条路）
      //    - 旋转 = 组的 `transform.rotate`（本来就是组自己的字段）
      //    ⚠️ 支点取**内容框**（不含组自己的旋转）—— 用含旋转的并集框当支点的话，
      //       中心会随旋转漂移（拖起来抖）。渲染那边也是绕内容框转的（`groupTransformCss`）。
      const isGrp = node.type === 'group';
      if (deco.kind === 'handle') {
        const start = isGrp ? groupContentBox(node, doc.canvas) : boxOf(node);
        const kids = isGrp
          ? collectLeaves(node).map((k) => ({ node: k, rect0: { ...k.rect } }))
          : undefined;
        if (isGrp && !kids?.length) return; // 空组，没什么可缩
        session = { kind: 'resize', dir: deco.dir, start, origin: p, kids };
        gestureBox = start;
        capture(e);
        return;
      }
      if (deco.kind === 'rotate' && !rotateBlocked(node)) {
        const start = isGrp ? groupContentBox(node, doc.canvas) : boxOf(node);
        const center = boxCenter(start);
        session = { kind: 'rotate', start, center, angle0: angleAt(center, p), rotate0: rotateOf(node) };
        gestureRotate = rotateOf(node);
          capture(e);
        return;
      }
    }

    // ③ 按在**已选中**的那一层上 ⇒ 整块移动
    //    ⚠️ 与旧实现一致：按在**别的**层上只做选中（交给 click），
    //    需要再按一次才拖得动 —— 免得"想选中却把它挪走了"。
    //
    //    ⚠️ **但光标压在边上时不起手势**：那儿归"加顶点"管。
    //    不划这条线的话，点边会被判成"移动" ⇒ 手势一起，`click` 就被吃掉 ⇒ **加不了顶点**
    //    （实测：加了整块移动之后，加顶点直接失效）。
    //    地盘划分：**边上 = 加顶点，图形内部 = 移动**。
    // ⚠️ 这里**不能**用 `resolveSelection` 的结果来决定"起不起手势"：
    //    它带"再点一次就下钻"的规则 ⇒ 选中组之后再按下去想拖，会被当成下钻（实测：拖不动）。
    //    手势的地盘只认一件事：**光标是不是压在"当前选中的那个东西"上**
    //    —— 压在它组里的元素上也算（那本来就是压在组上）。
    const rawId = hitLayer(root, p);
    const id = selectedId;
    const onSelected = !!id && (rawId === id || (rawId ? outermostGroupOf(rawId) === id : false));
    // ⭐ **组也能拖**：组的平移 = 把它里面的元素一起搬（落地在 `endGesture`）。
    //    ⚠️ 与"拖组内单个元素"区别开：那种情况在带变换的组里**不给拖**（方向会对不上），
    //    而"拖整组"没有这个问题 —— 平移按屏幕方向算，组转了多少都不影响。
    if (onSelected && node && !edgeUnder(p) && !ancestorTransform(id)) {
      const kids =
        node.type === 'group' ? collectLeaves(node).map((k) => ({ node: k, rect0: { ...k.rect } })) : undefined;
      if (node.type === 'group' && !kids?.length) return; // 空组，没什么可搬
      const start = boxOfAny(node);
      session = { kind: 'move', start, origin: p, kids };
      gestureBox = start;
      capture(e);
      return;
    }

    // 其余：「加顶点」是单击动作，交给 `click`；选中也交给 `click`。
  }

  function capture(e: PointerEvent) {
    try {
      wrap.setPointerCapture(e.pointerId);
    } catch {
      /* 指针已经没了 */
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (downAt && !pointerMoved) {
      if (Math.abs(e.clientX - downAt.x) > CLICK_SLOP || Math.abs(e.clientY - downAt.y) > CLICK_SLOP) {
        pointerMoved = true;
      }
    }
    const p = localPoint(e);

    // 没在拖的时候：让「加顶点」的小圆点跟着光标走（整条边都能点，不只那个小点）
    if (!session) {
      syncHover(downAt ? null : p);
      return;
    }

    if (!selectedId) return;

    // ── 顶点：改点集 ──────────────────────────────────────────────
    if (session.kind === 'vertex') {
      const poly = polyOf(selectedId);
      if (!poly) return;
      const delta = { x: p.x - session.origin.x, y: p.y - session.origin.y };
      const polyBox = boxOf(poly);
      const next = dragPoint(session.start, session.index, delta, polyBox, rotateOf(poly));
      gesturePoints = next;
      // 实时反馈：直接改子文档那条 polygon，不重新渲染整页
      // ⚠️ 必须把 `box` 一起传进去 —— 产物里 polygon 是**像素**坐标（见 `writePoints`）
      writePoints(selectedId, next, polyBox);
      overlay.show(polyBox, transformOf(poly), next);
      return;
    }

    // ── 旋转：用角度差，对指针离中心多远不敏感 ⇒ 天然不受 zoom 影响 ──
    if (session.kind === 'rotate') {
      const deg = rotateDegrees(session, p);
      gestureRotate = deg;
      setTransformStyle(selectedId, deg);
      boxOverlay.show(session.start, rotateCss(deg));
      return;
    }

    // ── 移动 / 缩放 ────────────────────────────────────────────────
    const box =
      session.kind === 'move'
        ? moveBox(session.start, session.origin, p)
        : resizeBox(session.start, session.dir, session.origin, p, { ratioLock: e.shiftKey });

    const n = elementById(selectedId);

    gestureBox = box;
    if (session.kids) {
      // ⭐ 组：预览就是**给组容器加一层变换** —— 容器铺满画布，等于整组在动 / 在缩放，
      //    一个子元素都不用碰。
      previewGroup(selectedId, session.start, box);
    } else {
      setBoxStyle(selectedId, box);
    }
    // ⚠️ 这里用的是**节点自己那串变换**（不是 gestureRotate）：移动 / 缩放期间旋转角没变，
    //    但 `skewX` / `scale` / 自定义 `origin` 都在里面 —— 少了它们框就圈不住元素。
    const liveTransform = n ? transformOf(n) : '';
    boxOverlay.show(box, liveTransform);
    // 多边形：盒子变了 ⇒ 顶点在屏幕上的位置也变了，圆点柄要跟着
    if (n && isPoly(n) && !blocked(n)) overlay.show(box, liveTransform, n.points);
  }

  function endGesture(commit: boolean) {
    const id = selectedId;
    const s = session;
    session = null;
    overlay.setActive(-1);

    if (!id || !s) {
      gestureBox = null;
      gestureRotate = null;
      gesturePoints = null;
      syncOverlay();
      return;
    }

    // ── 顶点 ──────────────────────────────────────────────────────
    if (s.kind === 'vertex') {
      const poly = polyOf(id);
      const moved =
        !!poly && !!gesturePoints &&
        gesturePoints.some((q, i) => q[0] !== s.start[i][0] || q[1] !== s.start[i][1]);

      if (commit && moved && poly && gesturePoints) {
        poly.points = gesturePoints.map((q) => [q[0], q[1]] as Point01);
        // ⭐ **拖完顶点必须重算包围盒**：用户可以把点拖到盒子外面，
        //    不重算的话 `rect` 就永久性地圈不住形状了（这就是那个 bug 的源头）。
        //    ⚠️ 也顺带把新点集写回子文档 —— 否则"拖顶点"不在重渲名单里，画面不跟手。
        normalizePolygon(id);
        submit(id, '拖顶点');
      } else if (!commit && poly) {
        // 撤销这一次：把子文档里的点还原回手势起点
        // ⚠️ 也要走 `normalizePolygon`：拖动期间若框已经跟着长过（其实没有 —— 框只在
        //    commit 时才改），这里至少保证 DOM 与文档一致。
        poly.points = s.start.map((q) => [q[0], q[1]] as Point01);
        normalizePolygon(id);
      }
      gesturePoints = null;
      syncOverlay();
      return;
    }

    // ── 旋转 ──────────────────────────────────────────────────────
    if (s.kind === 'rotate') {
      const deg = gestureRotate ?? s.rotate0;
      // 没真正动过 = 不是一次操作（原地单击），不发提交
      if (commit && deg !== s.rotate0) {
        const l = elementById(id);
        if (l) l.transform = { ...(l.transform ?? {}), rotate: deg };
        submit(id, '旋转');
      } else if (!commit) {
        setTransformStyle(id, s.rotate0);
      }
      gestureRotate = null;
      syncOverlay();
      return;
    }

    // ── 移动 / 缩放 ───────────────────────────────────────────────
    const box = gestureBox;
    const noop =
      !!box &&
      box.left === s.start.left && box.top === s.start.top &&
      box.width === s.start.width && box.height === s.start.height;

    if (commit && !noop && box) {
      const kids = s.kind === 'move' || s.kind === 'resize' ? s.kids : undefined;
      if (kids) {
        // ⭐ 组：把框的变化**分摊到每个子元素**上（组自己不动 —— 它没有 `rect`）。
        //    平移：各自加同样的位移；缩放：按"相对起始框的位置"缩放。
        //
        // ⚠️ 这里曾经乘除 `canvas.width/height`（`rect` 还是 0–1 比例时的事）。
        //    现在 `rect` **就是画布 px** ⇒ 全是 px 算术，一次乘除都不用。
        const sx = s.start.width ? box.width / s.start.width : 1;
        const sy = s.start.height ? box.height / s.start.height : 1;
        for (const k of kids) {
          k.node.rect = {
            x: r4(box.left + (k.rect0.x - s.start.left) * sx),
            y: r4(box.top + (k.rect0.y - s.start.top) * sy),
            w: r4(Math.max(1, k.rect0.w * sx)),
            h: r4(Math.max(1, k.rect0.h * sy)),
          };
        }
      } else {
        const l = elementById(id);
        // ⚠️ `box` 与 `rect` 现在**同一单位**（画布 px）⇒ 直接搬四个数，没有换算函数
        if (l && l.type !== 'group') l.rect = { x: box.left, y: box.top, w: box.width, h: box.height };
      }
      submit(id, s.kind === 'move' ? (s.kids ? '移动组' : '移动') : '缩放');
    } else if (!commit) {
      const kids = s.kind === 'move' || s.kind === 'resize' ? s.kids : undefined;
      if (kids) previewGroup(id, s.start, s.start); // 撤销预览（变换归零）
      else setBoxStyle(id, s.start);
    }
    gestureBox = null;
    syncOverlay();
  }

  const onPointerUp = () => endGesture(true);
  const onPointerCancel = () => endGesture(false);
  /**
   * 抑制父页面的文字选择（同 `index.ts`）。
   *
   * ## ⚠️ 条件不能只看"起没起手势"
   *
   * 早先这里只写 `if (session) e.preventDefault()` —— 意思"只在真的起了手势时压"。
   * **但那漏掉了"双击删顶点"这一类**：双击删除**不会起手势**（`pointerdown` 只做选中，
   * `dblclick` 才删）⇒ `session` 是 `null` ⇒ 不压 ⇒ **浏览器把双击当成"全选"**
   * （实测：双击顶点时整页文字被选蓝，而不是把点删掉）。
   *
   * ## 为什么要压在这里（而不是 `pointerdown`）
   *
   * `pointerdown` 里 **不能** `preventDefault()` —— 它会把随后那次 `dblclick` 一起吃掉
   * ⇒ 顶点就删不掉了（这条是踩过的，见 `onPointerDown` 里的注释）。
   * `mousedown` 上压则两全：**挡住文字选择，但不影响 `dblclick` 触发**。
   *
   * ⇒ 判据改成"**只要落点是编辑器的装饰件**（顶点 / 角柄 / 旋转柄）或已经起了手势，
   *    就压"。装饰件上的一切鼠标操作都归编辑器，没有一处需要浏览器的默认选择行为。
   */
  const onMouseDown = (e: MouseEvent) => {
    if (session) {
      e.preventDefault();
      return;
    }
    const t = e.target as Element | null;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest('[data-ve-vtx],[data-ve-edge],[data-ve-handle],[data-ve-rot],[data-ve-overlay]')) {
      e.preventDefault();
    }
  };

  // ── 单击：选中 / 加顶点 ────────────────────────────────────────────
  function onClick(e: MouseEvent) {
    // 在选字 ⇒ 画面归浏览器，编辑器不抢（覆盖层手柄露在外头，点它不许改选中）
    if (textEditId) return;
    // ⚠️ 只看"**有没有真的移动过**"，不看"有没有起过手势"：
    //    按下不动**也是一次点击**（"起手势"只是预备动作，比如组要先备好一起搬的子元素）。
    //    用 `gestureRan` 会把"选中组之后想再点一下下钻"一起吃掉（实测踩到）。
    const skip = pointerMoved;
    pointerMoved = false;
    downAt = null;
    if (skip) return;

    const p = localPoint(e);

    // ①b 光标压在 rect / ellipse 的**边上** ⇒ 先升格再"在这儿加点"
    //    （这正是"在矩形/椭圆上插点"的入口；组带变换时 blocked 挡住，不升格）
    const selfC = elementById(selectedId);
    let poly = polyOf(selectedId);
    if (selfC?.type === 'shape' && (selfC.kind === 'rect' || selfC.kind === 'ellipse') && !blocked(selfC)) {
      poly = ensureEditablePoly(selectedId!);
    }

    // ① 光标压在某条边上 ⇒ **就在光标那儿**加一个顶点
    //    （不必瞄准那个小圆点 —— 位置由光标投影到边上算出来）
    if (poly && !blocked(poly)) {
      // 但离某个顶点太近时归顶点管（那是"拖 / 删"的地盘），别抢
      const onVertex = nearestVertex(pointsToLocal(poly.points, boxOf(poly)), p, VERTEX_TOL) >= 0;
      const hit = onVertex ? null : edgeUnder(p);
      if (hit) {
        // 双击会连来两下 click ⇒ 连插两个点。这不是用户想要的，挡掉第二下。
        const now = Date.now();
        if (now - lastInsert >= 300) {
          lastInsert = now;
          poly.points = insertPoint(poly.points, hit.edge, hit.t);
          // ⚠️ **必须把新点集写回子文档**：`submit` 只把它交给宿主，
          //    而宿主那条路径里"加顶点"**不在** STRUCT_LABELS ⇒ 不会重渲（设计如此，
          //    免得每次加点都重载 iframe）。不写的话画面上**看不见新点**，
          //    得等下一次重渲才冒出来（实测：doc 已经 4 个点，画面还是 3 个）。
          //
          // ⭐ `normalizePolygon` 一次做完两件事：**重算包围盒 + 重归一化点集 + 写 DOM**。
          //    加的点落在边上 ⇒ 本来就在盒内，框不会变；但它统一了这条路径的写法。
          normalizePolygon(poly.id);
          submit(poly.id, '加顶点');
          syncOverlay();
          syncHover(p);
        }
        return;
      }
    }

    // ② 其余：点内容层 → 选中（点在组里 ⇒ 选中的是**那个组**；已经选着它 ⇒ 下钻）
    //    ⚠️ 把坐标一起传进去：没命中的时候还要靠它判"是不是落在某个组的内容范围里"
    const id = hitLayer(root, p);
    select(resolveSelection(id, e.ctrlKey || e.metaKey || e.altKey, p));
  }

  // ── 双击：删顶点 ───────────────────────────────────────────────────
  /**
   * ⚠️ **这里不能看 `e.target`**，必须按**坐标**认顶点。
   *
   * 拖顶点时调了 `wrap.setPointerCapture()`，而 pointer capture 会把随后那些
   * **派生的鼠标事件**（`mouseup` / `click` / `dblclick`）的 `target` **重定向到
   * 捕获元素** —— 实测事件流是：
   *
   * ```
   * pointerdown→DIV[vtx=1]      ← 还没捕获，认得出手柄
   * mouseup→DIV[vtx=null]       ← 已经被捕获，target 变成 wrap
   * dblclick→DIV[vtx=null]      ← 同上 ⇒ 看 target 永远删不掉
   * ```
   *
   * 用坐标就绕开了整件事：**光标离哪个顶点最近就删哪个**，跟事件被重定向给谁无关。
   * （顺带也更符合 D1：真源是数据，不是 DOM。）
   */
  function onDblClick(e: MouseEvent) {
    const p = localPoint(e);

    // ① 双击顶点 = 删掉它（rect / ellipse 会先升格成 polygon）
    const selfD = elementById(selectedId);
    let poly = polyOf(selectedId);
    if (selfD?.type === 'shape' && (selfD.kind === 'rect' || selfD.kind === 'ellipse') && !blocked(selfD)) {
      poly = ensureEditablePoly(selectedId!);
    }
    if (poly && !blocked(poly)) {
      const index = nearestVertex(pointsToLocal(poly.points, boxOf(poly)), p, VERTEX_TOL);
      if (index >= 0) {
        const next = removePoint(poly.points, index);
        if (!next) return; // 到 3 个点了，删不动
        poly.points = next;
        // ⚠️ 这里原本**只 submit、不写 DOM** —— 而"删顶点"不在宿主的重渲名单里
        //    （见 App 的 STRUCT_LABELS）⇒ 画面上那个点**不会消失**。
        //    `normalizePolygon` 补上这一步（它内部就写 DOM）。
        normalizePolygon(poly.id);
        submit(poly.id, '删顶点');
        syncOverlay();
        return;
      }
    }

    // ② 双击**文字** = 进入选字态（Word 那样：接下来在字上拖，选中哪几个改哪几个）
    const id = hitLayer(root, p);
    const n = elementById(id);
    if (n && n.type === 'text') {
      select(n.id);
      enterTextEdit(n.id);
    }
  }

  const onKeyDown: EventListener = (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key !== 'Escape') return;
    if (session) return;
    // ⚠️ 先退文字态，再谈取消选中 —— 不然按一下 Esc 两件事一起发生，
    //    用户看不出来刚才那一下是退了"选字"还是丢了"选中"。
    if (textEditId) exitTextEdit();
    else select(null, false);
  };

  wrap.addEventListener('pointerdown', onPointerDown);
  wrap.addEventListener('pointermove', onPointerMove);
  wrap.addEventListener('pointerup', onPointerUp);
  wrap.addEventListener('pointercancel', onPointerCancel);
  wrap.addEventListener('mousedown', onMouseDown);
  wrap.addEventListener('click', onClick);
  wrap.addEventListener('dblclick', onDblClick);
  host.addEventListener('keydown', onKeyDown, true);

  /**
   * ⭐ 撤销：把栈顶命令的 `before` 装回（重渲由宿主的 `onChange` 完成）。
   *
   * ⚠️ 提成**文件级函数**而不是对象字面量上的方法：文字态里按 Ctrl+Z 时，
   * 子文档的 `keydown` 也要能调到它（对象还没造出来，裸标识符取不到）。
   */
  function undo(): boolean {
    // 文字态先退——文字态里浏览器的"原生撤销"改的是 DOM，会把我们的真源搞乱
    if (textEditId) exitTextEdit();
    const prev = stackUndo(stack);
    if (!prev) return false;
    // ⭐ **必须再克隆一层**：`stackUndo` 返回的就是 `stack.head` 本身——
    //    直接 `doc = prev` 会让 head 与 doc 变成**同一引用**，下一次编辑改 doc 时
    //    连 head 一起改 ⇒ 再下一次 push 的 before 就成了"已改状态"（实测：撤销后打字
    //    的命令 before 混入了已打的字符）。undo/redo 是 head 与 doc 唯一可能同引用的地方。
    doc = cloneDoc(prev);
    if (selectedId && !elementById(selectedId)) {
      selectedId = null;
      outline(null);
    }
    syncOverlay();
    opts.onChange?.(selectedId, doc);
    return true;
  }

  function redo(): boolean {
    if (textEditId) exitTextEdit();
    const next = stackRedo(stack);
    if (!next) return false;
    doc = cloneDoc(next); // ⭐ 同上：与 `stack.head` 保持引用分离
    if (selectedId && !elementById(selectedId)) {
      selectedId = null;
      outline(null);
    }
    syncOverlay();
    opts.onChange?.(selectedId, doc);
    return true;
  }

  return {
    attachRoot(next) {
      root = next;
      // 子文档换了（重渲）⇒ 描边要重画，覆盖层按当前 doc 摆一次
      outline(selectedId);
      syncOverlay();
      // ⭐ 文字态里重渲过：DOM 是新的一份 ⇒ `contentEditable`、子文档监听、
      //    光标与选区**全部要重来**（不然打完字一点、可编辑态就没了）
      textSession.refreshRunCount();
      textSession.reattach();
    },

    updateDoc(next) {
      doc = cloneDoc(next);
      resetStack(stack, doc); // ⭐ 宿主整体换文档 ⇒ 历史作废
      if (selectedId && !elementById(selectedId)) {
        selectedId = null;
        outline(null);
      }
      syncOverlay();
    },

    /** 内部工作副本的引用 —— 宿主靠它判断"要不要 updateDoc"（见接口注释） */
    get doc() {
      return doc;
    },

    /**
     * ⚠️ 这里是 **notify = true**，不是 `false`。
     * `handle.select` 是**外部（宿主 / 探针）**发起的，宿主必须知道选中变了，
     * 否则属性面板不会重画（实测：调 `select` 后面板还是空的）。
     * 内部那次 `select(..., false)` 是"编辑器自己决定选中"的场景，不回灌给宿主，免得绕圈。
     */
    select(id) {
      select(id, true);
    },

    fields(id) {
      const n = id ? elementById(id) : null;
      return n ? fieldsFor(n, doc.canvas) : [];
    },

    patch(id, path, value) {
      // ⭐ 先按**元素**找；找不到再看它是不是**图层**（图层有自己的字段：底色 / 旋转 / 不透明度）
      const l = elementById(id);
      if (!l) {
        const layer = findLayer(doc, id);
        if (!layer) return;
        const lf = findLayerField(path);
        if (!lf) return;
        lf.set(layer, value);
        scheduleCommit(id, path);
        return;
      }
      const f = findField(l, doc.canvas, path);
      if (!f) return;
      f.set(l, value);
      // 覆盖层**立刻**跟上（拖数字框时框得跟着动），重渲攒一下再发
      syncOverlay();
      scheduleCommit(id, path);
    },

    get editable() {
      const l = elementById(selectedId);
      return !!l && isPoly(l) && !blocked(l);
    },

    get blockReason() {
      return blockReason;
    },

    get textEditId() {
      return textEditId;
    },

    endTextEdit: exitTextEdit,

    /** ⭐ 撤销：把栈顶命令的 `before` 装回（重渲由宿主的 `onChange` 完成） */
    undo,

    redo,

    get canUndo() {
      return stackCanUndo(stack);
    },
    get canRedo() {
      return stackCanRedo(stack);
    },
    undoDepth: () => stackUndoDepth(stack),

    addLayer(node: ElementNode) {
      // ⚠️ **临时规则（文档模型改版迁移期）**：文档现在是「画布 → 图层 → 元素」，
      //    而"往文档里加一个新元素"这件事**还没说加进哪个图层** ⇒ 这里定：
      //    **加到第一个图层**；**一个图层都没有，就先建一个默认图层再加**
      //    （`id` 用 `layer-1` 这种就够 —— 空文档里不会有重名）。
      //    ⚠️ 图层**永远和画布一样大** ⇒ 里面的元素就是**画布坐标**，
      //       新元素加进去不用做任何坐标换算（与现有文档同一套口径）。
      //    ⭐ 等图层面板做出来，这个入口应改成"加进**当前选中**的那个图层"。
      let layer = doc.layers[0];
      if (!layer) {
        layer = { id: 'layer-1', elements: [] };
        doc.layers.push(layer);
      }
      // ⭐ 追加到**尾部**（数组后面的在上 ⇒ 新元素在最上层，压在所有东西上面）
      layer.elements.push(node);
      select(node.id);
      submit(node.id, `新增 ${node.type}`);
      syncOverlay();
    },

    removeLayer(id: string) {
      // ⭐ **图层自己**：叠放顺序就是 `doc.layers` 的顺序（画布的孩子之间）。
      //    ⚠️ 这一段是补的：`EditPanel` 给图层行也摆了「删除」按钮，
      //       没有它点了会**静默无反应**（按钮摆出来了就必须能用）。
      const li = doc.layers.findIndex((l) => l.id === id);
      if (li >= 0) {
        doc.layers.splice(li, 1);
        // 删的是当前选中的图层、或选中的元素正躺在这个图层里 ⇒ 清选中
        if (selectedId === id || !elementById(selectedId)) {
          selectedId = null;
          outline(null);
        }
        submit(null, '删除图层');
        syncOverlay();
        return;
      }
      // ⚠️ 删的可能是**任意一个图层里的元素**（甚至嵌在组里的）⇒ 先问词汇表
      //    "它所在的容器是谁"，再从**那一个** `elements` 里摘掉它。
      //    （旧实现是自己 walk `doc.layers` —— 那时 `doc.layers` 就是所有节点的扁平表。）
      const c = containerOf(doc, id);
      if (!c) return;
      const i = c.elements.findIndex((e) => e.id === id);
      if (i < 0) return;
      c.elements.splice(i, 1);
      // 删的是当前选中的（或其祖先）⇒ 清选中
      if (selectedId === id || !elementById(selectedId)) {
        selectedId = null;
        outline(null);
      }
      submit(null, '删除元素');
      syncOverlay();
    },

    moveLayer(id: string, to: 'up' | 'down' | 'top' | 'bottom') {
      // ⭐ **图层自己**：在 `doc.layers` 里跟兄弟换位（同样是叠放语义）。
      //    ⚠️ 与 `removeLayer` 同理，这一段是补的 —— 没有它图层行的「上移/下移」是静默无反应。
      const li = doc.layers.findIndex((l) => l.id === id);
      if (li >= 0) {
        const ll = doc.layers;
        let lj: number;
        if (to === 'up') lj = li + 1;
        else if (to === 'down') lj = li - 1;
        else if (to === 'top') lj = ll.length - 1;
        else lj = 0;
        if (lj < 0 || lj >= ll.length || lj === li) return; // 已在目标位置 ⇒ 无操作（不进栈）
        const [lmoved] = ll.splice(li, 1);
        ll.splice(lj, 0, lmoved);
        submit(null, '调整图层顺序');
        syncOverlay();
        return;
      }
      // ⚠️ 叠放顺序是**它所在的那个容器**里的事：图层里的元素只在**同一图层的兄弟之间**换位，
      //    组里的元素同理（组内也有叠放顺序）。旧模型里 `doc.layers` 是所有节点的扁平表，
      //    所以那时这是"顶层顺序"—— 照抄到现在会变成"移动图层"，那是另一件事。
      const c = containerOf(doc, id);
      if (!c) return;
      const list = c.elements;
      const i = list.findIndex((e) => e.id === id);
      if (i < 0) return;
      const at = (dir: -1 | 1) => i + dir;
      // ⚠️ 方向：数组**后面的层画在上面**（叠放语义）⇒
      //    `up`（视觉上移一层）= 与**后一个**交换（i+1）；`down` = 与前一个交换（i-1）；
      //    `top` = 数组尾（最上层）；`bottom` = 数组头（最底层）
      let j: number;
      if (to === 'up') j = at(1);
      else if (to === 'down') j = at(-1);
      else if (to === 'top') j = list.length - 1;
      else j = 0;
      if (j < 0 || j >= list.length || j === i) return; // 已在目标位置 ⇒ 无操作（不进栈）
      const [moved] = list.splice(i, 1);
      list.splice(j, 0, moved);
      submit(id, '调整图层顺序');
      syncOverlay();
    },
    /** 调试/未来 UI：栈内命令摘要（before/after 里 title 的文本） */
    dump(): {
      done: Array<{ label: string; before: string[]; after: string[]; at: number; key: string }>;
      undone: Array<{ label: string; before: string[]; after: string[]; at: number; key: string }>;
    } {
      // ⚠️ `doc.layers` 现在是**图层**表 ⇒ 直接 `map((x) => x.id)` 只会摘出 `layer-1` 这种
      //    名字，看不出改了什么。摘要要的是**元素** id ⇒ 按图层逐个 `iterElements` 展开。
      const idsOf = (d: DesignDocument): string[] =>
        d.layers.flatMap((l) => [...iterElements(l)].map((e) => e.id));
      const brief = (c: Command) => ({
        label: c.label,
        at: c.at,
        key: c.key ?? '',
        before: idsOf(c.before),
        after: idsOf(c.after),
      });
      return {
        done: stack.done.map((c) => ({ ...brief(c), at: c.at, key: c.key ?? '' })),
        undone: stack.undone.map((c) => ({ ...brief(c), at: c.at, key: c.key ?? '' })),
      };
    },

    applyRange(id, range, patch) {
      const l = elementById(id);
      if (!l || l.type !== 'text') return;
      l.runs = applyToRange(l.runs, range, patch);
      submit(id, '改选区样式');
      syncOverlay();
    },

    // ── 文字选区（给属性面板 / 探针用；打字那条链路是自动的，不必调这些）──

    /** 当前光标 / 选区（**绝对字符下标**）；没进文字态 = `null` */
    absChars() {
      return textSession.abs();
    },
    /** 当前选区在 `runs` 上的投影（喂 `applyRange`）；折叠的光标 = `null` */
    selectionRange() {
      return textSession.range();
    },
    /** 选中的那几个字（宿主拿去显示"正在改哪几个字"） */
    selectionText() {
      return textSession.selectedText();
    },
    /** ⭐ 给**选中的那几个字**刷样式（Word 式染色）。收 `(path, value)`，换算在里面做 */
    styleSelection(path: string, value: unknown) {
      return textSession.applyStyleToSelection(path, value);
    },

    /**
     * ⭐ **选区快照**（样式面板的唯一输入）。没选字 ⇒ `null`。
     *
     * 一次算齐：字段 + 每项此刻的生效值 + 选中的文字 + 绝对下标。
     * 面板不必碰 `runs`、不必知道 `RunPatch`。
     */
    selectionSnapshot: buildSelectionSnapshot,

    insertText(id, at, text) {
      const l = elementById(id);
      if (!l || l.type !== 'text' || !text) return;
      l.runs = insertRunText(l.runs, at, text).runs;
      // ⚠️ 换行（含 `\n` 的插入）打断合并——Enter 后再打的字应是**新的一条**
      commitTyping(id, text.includes('\n') ? String(Date.now()) : undefined);
      syncOverlay();
    },

    deleteRange(id, from, to) {
      const l = elementById(id);
      if (!l || l.type !== 'text') return;
      l.runs = deleteRunRange(l.runs, from, to).runs;
      commitTyping(id);
      syncOverlay();
    },

    setRunText(id, index, text) {
      const l = elementById(id);
      if (!l || l.type !== 'text') return;
      l.runs = replaceRunText(l.runs, index, text).runs;
      commitTyping(id);
      syncOverlay();
    },

    get selectedId() {
      return selectedId;
    },

    dispose() {
      wrap.removeEventListener('pointerdown', onPointerDown);
      wrap.removeEventListener('pointermove', onPointerMove);
      wrap.removeEventListener('pointerup', onPointerUp);
      wrap.removeEventListener('pointercancel', onPointerCancel);
      wrap.removeEventListener('mousedown', onMouseDown);
      wrap.removeEventListener('click', onClick);
      wrap.removeEventListener('dblclick', onDblClick);
      host.removeEventListener('keydown', onKeyDown, true);
      if (patchTimer) clearTimeout(patchTimer);
      // ⚠️ **文字会话也要退**：它在**子文档**上挂了 9 个监听（beforeinput / paste /
      //    keydown / selectionchange…）。漏了这一步，被卸载的编辑器仍然被那些监听
      //    引用着（React StrictMode 双挂载、或每次换版式重挂时积一份），
      //    而且可编辑态会留在被丢掉的那份 DOM 上。
      textSession.exit();
      boxOverlay.dispose();
      overlay.dispose();
    },
  };
}

/** 四位小数（与 `geometry.ts` 的精度口径一致） */
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** 四位小数（升格的 24 点用；与 `geometry.ts` 精度口径一致） */
const r4p = (v: number) => Math.round(v * 10000) / 10000;

/** `querySelector` 里的 id 要转义（id 里可能有引号 / 空格） */
function cssEscape(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}
