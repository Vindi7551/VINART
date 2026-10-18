import { useEffect, useRef, useCallback, useState } from 'react';
import { createVocabEditor, type VocabEditorHandle } from '../editor/vocab-editor';
import type { SelectionSnapshot } from '../editor/inspector';
import { emitElementHtml, emitLayerHtml } from '../render/vocabulary/emit';
import { findElement, findLayer, type ElementNode, type Rect } from '../document/vocabulary';
import { createEditorStack, type EditorStack } from '../editor/editor-stack';
import type { PreviewData, HostSignal } from './types';

interface PreviewPanelProps {
  /** 数据还没到时的兜底图（PNG） */
  previewUrl?: string | null;
  /** 版式编辑模式：有值 = 用服务端现场渲染的 HTML + 父侧编辑器 */
  layoutData?: PreviewData | null;
  /** 会话 id：有值 = 素材 base 走 file API（工作目录模式）；无 = 旧约定 /files/ */
  sessionId?: string | null;
  /** 图上操作 → App 接住整份文档（就地编辑存 state；结构性变化按 label 重取 html） */
  onLayerChange?: (id: string, doc: PreviewData['doc'], label?: string) => void;
  /** 打字（就地补 DOM，不重渲） */
  onTypingChange?: (id: string, doc: PreviewData['doc']) => void;
  /** 图上点选 → App 侧同步选中（右栏面板跟着切） */
  onLayerSelect?: (id: string) => void;
  /**
   * ⭐ **文字选区变了**（在画面上拖选了几个字）—— App 拿它驱动样式面板。
   * `null` = 没在选字（面板该把那一栏收起来）。
   */
  onSelectionChange?: (snap: SelectionSnapshot | null) => void;
  /** 点在染色词上 → 面板单行颜色切换为该词的颜色 */
  onLayerWord?: (id: string, word: string) => void;
  /** 宿主信号：参数面板/图层清单发起的选中 / 单字段 patch / 撤销 / 重做 */
  hostSignal?: HostSignal | null;
  /**
   * ⭐ **宿主的当前图层**（图层面板高亮的那一层）。
   *
   * 编辑器自己存一份 `currentLayerId`，但**重渲会换新实例**（`bind()`）⇒ 新实例
   * 默认回到"最上层可用图层"，而面板还高亮着旧的那层 ⇒ 画布上那层的元素被门禁
   * 静默忽略（"明明选了图层却点不动"）。⇒ 建编辑器时把宿主这一份传进去。
   */
  currentLayerId?: string | null;
  /**
   * ⭐ **形状工具的绘制模式**（工具页 = 形状时为 true）。
   *
   * 打开时在画布上盖一层透明"绘制层"：拖一个框就画出一个形状。
   * ⚠️ 这一层会**挡住**选元素/拖元素 —— 这是**故意的**（PS 同样是"形状工具下不选图层"），
   *    否则画形状时很容易误触到旁边的元素。切回「选择」工具即可恢复编辑。
   */
  drawMode?: boolean;
  /** ⭐ 形状工具当前种类（决定画出来的是哪种节点） */
  shapeKind?: 'rect' | 'ellipse' | 'polygon' | 'path';
  /**
   * ⭐ **取某个产物的撤销栈**（宿主按产物名持有，2026-10-17）。
   *
   * 编辑器是跟着 iframe 重建的 ⇒ 栈不能挂在它身上（否则切走再切回历史就没了）。
   * `bind()` 时按当前产物名取一次、注入编辑器；**顺便做一次版本对账**（见 `bind`）。
   */
  getStack?: (name: string, base: PreviewData['doc']) => EditorStack;
}

/**
 * **按种类造一个形状节点**（`rect` 由调用方给）。
 *
 * ⭐ 抽出来的原因：**两条路共用** —— 工具页的「＋ 新增」（放默认位置）和
 * 画布上**拖画**（位置尺寸由拖出来的框给）。模板只此一份，两边不会漂。
 */
function makeShapeNode(
  kind: 'rect' | 'ellipse' | 'polygon' | 'path',
  rect: Rect,
  /**
   * 描边颜色。默认中性灰（= 落盘的样子）；**拖画过程中的预览传强调色**，
   * 让人一眼看出"还在画、还没松手"（用户 2026-10-17 定）。
   */
  paint = '#9AA0A6',
): ElementNode {
  const id = `s${Date.now()}`;
  /**
   * ⭐ 新形状**只给描边、不给填充**（里面透明）—— 用户 2026-10-17 定。
   *
   * ⚠️ 为什么不能"什么都不给"：既没填充也没描边 ⇒ **完全看不见**，
   *    拖完一个框会以为没画出来（其实是画了个透明的）。
   * ⚠️ 为什么默认用**中性灰**：这是"占位框"，不预设任何设计色 —— 填充留给你去「外观」页给。
   *    （原来 4 种形状各写死一个颜色 `#2F6B8A`/`#B8722F`/`#C8323C`，纯属当年"能看见就行"。）
   */
  const stroke = { paint, width: 2 };
  if (kind === 'ellipse') return { id, type: 'shape', kind: 'ellipse', rect, stroke };
  if (kind === 'polygon')
    return {
      id,
      type: 'shape',
      kind: 'polygon',
      rect,
      // 默认正五边形（0–1，相对自己的盒子）
      points: [
        [0.5, 0],
        [1, 0.37],
        [0.81, 1],
        [0.19, 1],
        [0, 0.37],
      ],
      stroke,
    };
  if (kind === 'path')
    return {
      id,
      type: 'shape',
      kind: 'path',
      rect,
      // ⚠️ `path.d` 恒为 **0–1**（见词汇表分母表）—— 不是像素
      d: 'M0,1 C0.25,0 0.75,0 1,1 Z',
      stroke,
    };
  return { id, type: 'shape', kind: 'rect', rect, stroke };
}

/** 默认画布尺寸，在解析不到 HTML 尺寸时使用 */
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 1200;

export function PreviewPanel({
  previewUrl,
  layoutData,
  sessionId,
  onLayerChange,
  onTypingChange,
  onLayerSelect,
  onSelectionChange,
  hostSignal,
  currentLayerId,
  drawMode,
  shapeKind,
  getStack,
}: PreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** ⭐ 面板刚 patch 过哪个节点 —— 等新文档到了（`onChange`）再重发它的 DOM */
  const pendingPatchRef = useRef<string | null>(null);
  /**
   * ⭐ **重渲之后要自动回去的那个文字节点**（弧形/路径文字摊平会换一份 HTML）。
   *
   * 摊平流程：双击 → `onTextEditChange(id, flatten=true)` → 宿主 emit 一份"摊平版"
   * → 换 srcdoc → `bind()` **新建编辑器**。新实例没有 `textEditId` ⇒ 必须在这里记着，
   * 重绑后调 `beginTextEdit(id)` 把文字态接回去；否则就是"改完/摊平后直接没了"。
   *
   * ⚠️ 只在**退出文字态**（`onTextEditChange(null)`）时清空；普通重渲（没在编辑）留 null。
   */
  const pendingTextEditRef = useRef<string | null>(null);
  /** 宿主的当前图层 —— `bind()` 是稳定回调，只能从 ref 现取 */
  const currentLayerRef = useRef<string | null>(null);
  currentLayerRef.current = currentLayerId ?? null;
  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<VocabEditorHandle | null>(null);

  // ── 画布状态：缩放 & 平移 ──
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** 就地改字中：此时把指针**还给 iframe**，好让鼠标能点光标位置 */
  // 文字态：由编辑器的 onTextEditChange 回调驱动（**不再轮询**）。
  // ⚠️ 早先用 200ms 轮询 `ed.textEditId`（因为当时没传这个回调）—— 后果是
  //    双击之后最多要等 200ms 鼠标才落到画面上，拖选/点光标都会漏掉开头那一下。
  const [editingText, setEditingText] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const [canvasSize, setCanvasSize] = useState({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });

  // ── 编辑器读取的一切都走 ref ──
  // 目的：`bind()` 保持**稳定**，只在 srcdoc 变化时重挂；否则每次 props 变
  // 都会 dispose + create（覆盖层会闪、编辑态会丢）。
  const cbRef = useRef({ onLayerChange, onTypingChange, onLayerSelect, onSelectionChange });
  cbRef.current = { onLayerChange, onTypingChange, onLayerSelect, onSelectionChange };
  const docRef = useRef(layoutData?.doc ?? null);
  docRef.current = layoutData?.doc ?? null;
  /** 素材映射（摊平重渲时要用）—— 服务端随 data 下发 */
  const assetRef = useRef<PreviewData['assets']>({});
  assetRef.current = layoutData?.assets ?? {};
  /** 版式名（摊平重渲时要用；`applyFlatten` 的依赖必须是空的，所以走 ref） */
  const nameRef = useRef<string | null>(null);
  /**
   * ⭐ **当前这个编辑器实例绑定的产物名** —— 只在 `bind()` 里写。
   *
   * ⚠️ 不能拿 `nameRef` 判断：它在"新产物的数据到了"时就被更新了，而**旧编辑器
   *    还没被换掉** ⇒ 中间那一段会拿新产物的文档去喂旧编辑器（跨产物污染 ✗）。
   *    这个 ref 跟着**编辑器实例**走，才是准的。
   */
  const boundNameRef = useRef<string | null>(null);
  /** ⭐ 取撤销栈的回调（放 ref 里，`bind()` 的依赖必须是空的 ⇒ 不能闭包 props） */
  const getStackRef = useRef<((name: string, base: PreviewData['doc']) => EditorStack) | undefined>(undefined);
  getStackRef.current = getStack;
  nameRef.current = layoutData?.name ?? null;
  /**
   * ⭐ **编辑器刚交出来的那一份 doc**。
   *
   * 编辑器每次编辑完都会把自己那份交出来（`onChange` / `onTyping`）；宿主存下 ⇒ setState
   * ⇒ 组件重渲 ⇒ 下面那个 effect 又把它喂回 `updateDoc` ⇒ 里面 `resetStack`
   * **把撤销历史清一次**（实测：每编辑一次清一次，撤销/重做按钮一直是灰的）。
   *
   * ⇒ 记下"交出来的那一份"，effect 里一看是同一份就跳过。
   * ⚠️ 不能用 `ed.doc === layoutData.doc` 代替：编辑器 `updateDoc` 里会 `cloneDoc`，
   *    两边永远不是同一个对象（实测两者不等）。
   */
  const lastEmitted = useRef<PreviewData['doc'] | null>(null);

  // ── 版式编辑模式：srcdoc 只在换版式时构建一次 ──
  // base 快照与实时数据解耦：patch 走宿主 state 合并，若让 srcdoc 跟着数据重建，
  // iframe 整页重载会刷新掉实时编辑态（实测踩过）。
  const [base, setBase] = useState<{ name: string; html: string } | null>(null);
  useEffect(() => {
    if (layoutData && (!base || base.name !== layoutData.name)) {
      setBase({ name: layoutData.name, html: layoutData.html });
    }
  }, [layoutData, base]);

  /**
   * ⭐ **正在编辑「沿路径排字」的节点**（`curve` / `path`）。
   *
   * 那种文字的产物是 SVG `<textPath>` —— 页面上**没有 `.vt`**、也挂不上
   * `contentEditable`（SVG 元素没有这个能力，实测）。⇒ 编辑期间把它**只在这一个
   * 节点的 DOM 上**降级成普通文字，退出时换回弧线。
   *
   * ⚠️ **不是文档修改、不进撤销栈**：`swapNodeDom` 只换 DOM；文档里的 `path`/`curve`
   *    一个字节都不动（"平铺版"写回文档的话，退出就再也回不去弧线了）。
   *    用户打的字仍然走 `onTyping` → `commitTyping`，那才是撤销步。
   */
  const flatDomIdRef = useRef<string | null>(null);

  /**
   * 把**某一个节点**换成"摊平版 / 原版"的 DOM（就地 `insertAdjacentHTML + remove`）。
   *
   * - `flat=true`：深拷贝节点、删掉 `path`/`curve`（保留 `frame.h`，沿用原来的摊平口径），
   *   用 `emitElementHtml` 生成**摊平版**；
   * - `flat=false`：从**当前文档**（已经包含用户刚打的字）重新 emit 原版（弧线）。
   *
   * ⚠️ 只换节点、不换 `srcdoc` ⇒ 不重载 iframe、编辑器实例/文字态/当前图层都不丢。
   * ⚠️ 不进撤销栈：这里没有 `submit` / `commit`。
   */
  const swapNodeDom = useCallback((id: string, flat: boolean) => {
    const realm = iframeRef.current?.contentDocument;
    const doc = lastEmitted.current ?? docRef.current;
    if (!realm || !doc) return;
    const node = findElement(doc, id);
    const old = realm.querySelector(`[data-layer="${CSS.escape(id)}"]`);
    if (!node || !old) return;
    let emitNode: ElementNode = node;
    if (flat && node.type === 'text' && (node.path || node.curve)) {
      const copy = structuredClone(node);
      delete copy.path;
      delete copy.curve;
      emitNode = copy;
    }
    const html = emitElementHtml(emitNode, doc.canvas, { assets: assetRef.current }).html;
    old.insertAdjacentHTML('beforebegin', html);
    old.remove();
    // 新节点 = 新 DOM：描边 / 选中框按新的量一次（文字的高度是排版结果）
    editorRef.current?.refreshDom();
  }, []);

  /**
   * ⚠️ 这里**只**插一个 `<base>` 标签，不再注入任何 `<script>`。
   *
   * 编辑器已搬去**父文档**（`src/editor/`）：iframe 退化为纯渲染器，
   * 交互（点选 / 拖拽 / 缩放 / 旋转 / 就地改字）全由父侧覆盖层接管。
   * 因此子文档里的 `<script>` 数恒为 0 —— 这是 M1 的不变量之一。
   *
   * 相对素材的基准（必须进 head）：
   * - 会话工作目录模式：file API 作 base
   * - legacy：dev-server 的 /files 静态映射（test_product）
   */
  const withBase = useCallback(
    (html: string, name: string) =>
      html.replace(
        '</head>',
        (sessionId
          ? `<base href="/api/sessions/${sessionId}/file/designs/${name}/">`
          : `<base href="/files/test_product/layout/${name}/">`) + '</head>',
      ),
    [sessionId],
  );

  const layoutSrcdoc = !base ? '' : withBase(base.html, base.name);

  const srcdoc = layoutData ? layoutSrcdoc : '';

  // ── 自动适应画布 ──
  const fitToCanvas = useCallback(() => {
    const container = canvasRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scaleX = (cw - 64) / canvasSize.w; // 留边
    const scaleY = (ch - 64) / canvasSize.h;
    const fit = Math.min(scaleX, scaleY, 1); // 不超过 100%
    setZoom(fit);
    setPanX(0);
    setPanY(0);
  }, [canvasSize]);

  // 容器尺寸变化时自适应
  useEffect(() => {
    fitToCanvas();
    const onResize = () => fitToCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitToCanvas]);

  // 版式编辑模式：画布尺寸直接来自 spec
  // ⚠️ 尺寸没变就**必须原样返回 prev**：`layoutData` 每次提交（图上拖一下）
  // 都会换一个新对象，若这里无脑 `setCanvasSize({...})`，`canvasSize` 身份一变
  // → `fitToCanvas` 身份一变 → 下面那个"自适应"effect 重跑 → **zoom/pan 每次
  // 编辑都被打回 fit**。实测：改之前连点两次缩小都停在同一个值，改后是 0.3005 /
  // 0.2504 / 0.2087 三个不同档位。
  useEffect(() => {
    if (!layoutData) return;
    const { width, height } = layoutData.doc.canvas;
    setCanvasSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, [layoutData]);

  // ══════════════════════════════════════════════════════════════════
  // 编辑器：挂在父文档的覆盖层，target = iframe 的 contentDocument
  // ══════════════════════════════════════════════════════════════════

  /**
   * 重挂编辑器。必须在 **iframe load 之后**调：`srcdoc` 变了要等新文档建好，
   * 早调拿到的是上一份 `contentDocument`（或空壳）。
   */
  const bind = useCallback(() => {
    const wrap = wrapperRef.current;
    const iframe = iframeRef.current;
    const root = iframe?.contentDocument;
    const doc = docRef.current;
    if (!wrap || !root || !doc) return;

    editorRef.current?.dispose();
    // ⭐ **撤销栈注入**（宿主按产物名持有）+ **版本对账**：
    //    磁盘上的文档和栈里记的 `head` 不一致（AI / 另一个标签页 / 手改都会造成）
    //    ⇒ 那份历史是在**别的文档**上录的，套到当前文档上会**覆盖别人的改动** ✗
    //    ⇒ 直接作废（`resetStack` 以当前文档为新起点）。
    //    ⚠️ 这里是"穷人的 rev"（整份 JSON 比一次，每次 bind 才比一次）；
    //       服务端有了 rev 之后换成比 hash。
    const nm = nameRef.current;
    boundNameRef.current = nm; // ⭐ 这个 ref 跟着**编辑器实例**走（见声明处的注释）
    const st = (nm && getStackRef.current ? getStackRef.current(nm, doc) : null) ?? createEditorStack(doc);
    // ⚠️ 作废判断**只在 `updateDoc` 里做一处**（比内容），这里不要再重复一遍
    //    （原来是两处各比一次 JSON ✗ 重复且容易漂）。
    // `document` = 宿主（父）文档；`root` = 子文档。两者都从参数流入，
    // 编辑器自己不认识任何"当前页面"（见 src/editor/README.md 不变量①）。
    const ed = createVocabEditor(document, wrap, root, {
      doc,
      stack: st,
      // ⚠️ 重渲会新建实例 ⇒ 必须把**宿主**的当前图层带过去，否则新实例默认回最上层，
      //    而面板还高亮着旧那层 → 画布上那层的东西被门禁静默忽略。
      currentLayerId: currentLayerRef.current ?? undefined,
      onSelect: (id) => {
        if (id) cbRef.current.onLayerSelect?.(id);
      },
      // ⭐ 编辑器给的 label（见 editor-stack 的 submit）：App 靠它区分就地/结构变化
      onChange: (id, next, label) => {
        lastEmitted.current = next;
        // ⭐ **撤销 / 重做 ⇒ 画布整块重发**（这是"整份文档换了"，不是某个字段，
        //    所以没法像 `patch` 那样只重发一个节点）。
        //    ⚠️ 判据是 **label** —— 编辑器在 undo/redo 里必须带上 '撤销'/'重做'
        //      （原来没带 ⇒ 宿主不知道这是撤销 ⇒ 画布永远不跟 ✗ 实测抓到的）。
        //    图层容器的 HTML 里含它的元素 ⇒ 逐图层替换一次就够 ✓
        if (label === '撤销' || label === '重做' || label === '历史跳转') {
          const realm = iframeRef.current?.contentDocument;
          let replaced = false;
          if (realm) {
            for (const l of next.layers) {
              const n = realm.querySelector(`[data-layer="${CSS.escape(l.id)}"]`);
              if (!n) continue; // 画布上还没有这一层 ⇒ 交给 reconcile effect 插
              n.insertAdjacentHTML('beforebegin', emitLayerHtml(l, next.canvas, { assets: assetRef.current }).html);
              n.remove();
              replaced = true;
            }
          }
          // 图层节点被换成新的 DOM ⇒ 描边/选中框要重新量一遍（尤其是文字）
          if (replaced) editorRef.current?.refreshDom();
        }
        // ⭐ **面板改字段的"改 DOM"那一半**：真到这里才算拿到新文档。
        //    只重发**被改的那一个**节点（不重渲整页）：用它自己的 emit 产出替换掉旧节点。
        //    ⚠️ 用 `insertAdjacentHTML` + `remove` 而不是 `outerHTML =`：emit 对带 clip/mask
        //       的元素会**内联一段 defs `<svg>`**（自包含）⇒ 不止一个根节点，`outerHTML` 会塞错位置。
        const patchId = pendingPatchRef.current;
        if (patchId) {
          pendingPatchRef.current = null;
          const realm = iframeRef.current?.contentDocument;
          const node = realm?.querySelector(`[data-layer="${CSS.escape(patchId)}"]`);
          const asEl = findElement(next, patchId);
          const asLayer = asEl ? null : findLayer(next, patchId);
          if (realm && node && (asEl || asLayer)) {
            const html = asEl
              ? emitElementHtml(asEl, next.canvas, { assets: assetRef.current }).html
              : emitLayerHtml(asLayer!, next.canvas, { assets: assetRef.current }).html;
            node.insertAdjacentHTML('beforebegin', html);
            node.remove();
            // 节点是新的 DOM ⇒ 覆盖层按新的量一次（文字的高度是排版结果）
            editorRef.current?.refreshDom();
          }
        }
        // ⚠️ **必须无条件外发**，不能 `if (id)`：（2026-10-17 修）
        //    编辑器的 `submit` 在**结构性操作**上会传 `id = null` —— 移动/删除图层
        //    （`moveLayer` / `removeLayer` 的图层分支）、以及撤销时的选中节点。
        //    原来这里是 `if (id) …` ⇒ 那些操作**全都静默丢在编辑器里**：
        //    文档内部改了、App 收不到 ⇒ 不存盘、画布也不变（实测：点「上移一层」
        //    12 秒轮询，doc.json 一个字节没变）。而 `patch` 因为带 id 所以能存盘，
        //    于是只有"显隐/不透明度"能生效、"顺序/删除"不能 —— 就是这个原因。
        //    收方 `handleLayerChanged` 本来就忽略这个 id（只取 doc + label）⇒ 安全。
        cbRef.current.onLayerChange?.(id ?? '', next, label);
      },
      onTyping: (id, next) => {
        lastEmitted.current = next;
        if (id) cbRef.current.onTypingChange?.(id, next);
      },
      /**
       * ⭐ 进 / 出文字态。宿主在这里做**两件**自己才知道的事：
       *
       * ① 放开 iframe 的 `pointer-events` —— 让它真的能收到鼠标（拖选 / 点光标）。
       * ② `flatten` = 这块文字是「沿路径排字」（`curve` / `path`）⇒ 它的产物是 SVG
       *    `<textPath>`，**没有 `.vt`、挂不上 `contentEditable`** ⇒ 只把**这一个节点**
       *    换成"摊平版 / 原版"的 DOM（`swapNodeDom`），退出时换回弧线。
       *
       * ⚠️ 摊平/还原只是**显示用的 DOM 替换**：文档里的 `path`/`curve` 不动，
       *    **不进撤销栈**（只有用户真的改字/改样式才 `commitTyping`）。
       * 其余全在编辑器里：`contentEditable`、`beforeinput`、光标/选区、就地补 DOM。
       */
      onTextEditChange: (id, flatten) => {
        if (flatten) {
          if (id) {
            // 进：把这个节点换成摊平版（没有 .vt 就挂不上 contentEditable）
            flatDomIdRef.current = id;
            swapNodeDom(id, true);
          } else {
            // 出：用原版（从当前文档 emit ⇒ 用户刚打的字已经在里面）换回弧线
            const fid = flatDomIdRef.current;
            flatDomIdRef.current = null;
            if (fid) swapNodeDom(fid, false);
          }
        }
        // ⭐ 记着"重渲后要接回哪个文字态"（只对外部重渲有意义；摊平已经不重渲了）
        if (!id) pendingTextEditRef.current = null;
        else if (flatten) pendingTextEditRef.current = id;
        setEditingText(!!id);
        if (!id) cbRef.current.onSelectionChange?.(null);
      },
      /** ⭐ 文字选区变了 ⇒ 交给 App 驱动样式面板（面板是右栏，不在本组件里） */
      onSelectionChange: (snap) => cbRef.current.onSelectionChange?.(snap),
    });
    editorRef.current = ed;

    // ⭐ **重绑之后把文字态接回去**（只有"外部重渲"才会换 iframe；编辑动作不再换）。
    //    ⚠️ 没有 pending 就必须把 editingText 归 false：不然 iframe 一直吃指针，
    //       父侧编辑器收不到双击 = 整个画布"点不动/进不了编辑态"（实测踩过）。
    flatDomIdRef.current = null; // 新 document 里没有摊平过的节点
    const pendingEdit = pendingTextEditRef.current;
    if (pendingEdit) ed.beginTextEdit(pendingEdit);
    else setEditingText(false);
  }, []);

  // 换版式（srcdoc 变）→ 拆掉旧绑定；新绑定交给 onLoad
  useEffect(() => {
    if (!srcdoc) {
      editorRef.current?.dispose();
      editorRef.current = null;
      return;
    }
    // srcdoc 已是新值时，`onLoad` 一定会来；这里只负责把旧的拆掉
    editorRef.current?.dispose();
    editorRef.current = null;
  }, [srcdoc]);

  // 卸载时清干净（React StrictMode 会挂载两次，必须幂等）
  useEffect(
    () => () => {
      editorRef.current?.dispose();
      editorRef.current = null;
    },
    [],
  );

  // 数据变了 → 刷新编辑器的工作副本（**只在真换了文档时**）
  useEffect(() => {
    if (!layoutData) return;
    const ed = editorRef.current;
    if (!ed) return;
    // ⚠️ **不能无条件 updateDoc**：`updateDoc` 里有 `resetStack`（撤销历史作废），
    //    无条件调它的后果是"每编辑一次，撤销历史清一次" —— 撤销/重做按钮永远灰着（实测）。
    //    只有"宿主手里这份**不是**编辑器刚交出来的那份"（换版式 / 外部替换 / undo 后重取 html）
    //    才需要重装。
    //
    // 两个条件缺一不可，且各有各的用处：
    //  ① `lastEmitted`：这正是"编辑一次清一次"的主路径 —— 必须是**同一个对象引用**，
    //     因为 App 存的时候是 `{ ...prev, doc: next }`（浅拷贝），结构比较会被骗过。
    //  ② `ed.doc`：兜"宿主自己把 layout 换成一份陈旧数据"的情况（getter 见 handle 接口注释）。
    if (lastEmitted.current === layoutData.doc) return;
    // ⚠️ **用身份判等永远不成立**（编辑器内部的 `doc` 是克隆）⇒ 改成比**内容**：
    //    内容相同 ⇒ 这份文档就是编辑器自己刚交出来的 ⇒ **不要回灌**
    //    （回灌会把"撤销"冲掉：撤销后宿主 state 还是旧文档，一回灌就把它又盖回去了 ✗）
    // ⚠️⚠️ **跨产物污染**（2026-10-17 打点抓到）：换产物时**旧编辑器还没被 `bind()` 换掉**，
    //    而 `layoutData.doc` 已经是**新产物**的文档 ⇒ 一路喂进旧编辑器
    //    ⇒ `updateDoc` 判定"内容全变了" ⇒ **按新文档把旧产物的撤销栈重置** ✗
    //    （实测：vocab-full 的栈被 smoke 的文档清空 ⇒ 撤销永远没东西可撤）
    //    ⇒ 编辑器只接受**它自己绑定的那个产物**的文档。
    if (boundNameRef.current !== layoutData.name) return;
    if (JSON.stringify(ed.doc) === JSON.stringify(layoutData.doc)) return;
    ed.updateDoc(layoutData.doc);
    // ⚠️ `updateDoc` 只换编辑器的**工作副本**，不碰 iframe DOM（它只负责
    //    重置撤销栈 / 选中态 / overlay）。AI patch、另一个标签页这类**外部文档变更**
    //    必须像 undo 路径一样把整层 HTML 重发一遍，否则 fill/font 这类字段
    //    在 DOM 里不会变——表现就是“改了颜色但画布不动，刷新才出现”。
    const realm = iframeRef.current?.contentDocument;
    if (realm) {
      for (const l of layoutData.doc.layers) {
        const n = realm.querySelector(`[data-layer="${CSS.escape(l.id)}"]`);
        if (!n) continue;
        n.insertAdjacentHTML(
          'beforebegin',
          emitLayerHtml(l, layoutData.doc.canvas, { assets: layoutData.assets }).html,
        );
        n.remove();
      }
      ed.refreshDom();
    }
  }, [layoutData]);

  /**
   * ⭐ **图层的显示 / 隐藏 —— 就地做，不重载 srcdoc**（2026-10-17 定）。
   *
   * 为什么就地而不是重渲：**产物由 `emitDocument` 保证**（`emitLayer` 遇到 `visible === false`
   * 直接不产出那个容器 ⇒ 出图里根本没有它），画布只需要"看起来对"。而重载 `srcdoc` 会闪、
   * 还会打断正在编辑的状态（选中/光标）—— 那是踩过的坑。
   *
   * ⚠️ **必须挂在 `doc` 上、而不是只在"点眼睛"那一处改**：隐藏是文档变更，
   * **撤销 / 重做**也会改 `doc.layers[].visible` ⇒ 只有跟着文档同步，撤销才能把图层恢复出来。
   *
   * ⚠️ 用 `display:none` 而**不是** `opacity:0`：`opacity:0` 的元素**仍然接收指针事件**，
   * 等于在画布上埋一个看不见的陷阱；`display:none` 不接收事件、不占尺寸，最接近"不存在"。
   */
  useEffect(() => {
    const d = iframeRef.current?.contentDocument;
    if (!d) return;
    // ⚠️ **必须用 iframe 自己的 `HTMLElement`**：同源 iframe 有独立的全局对象，
    //    iframe 里的元素**不是**父窗口 `HTMLElement` 的实例 ⇒ 用父窗口的写
    //    `el instanceof HTMLElement` 永远 false，赋值会被**静默跳过**（实测踩过：
    //    打点显示文档对、节点也找到了，display 就是不生效）。
    const HTMLEl = d.defaultView?.HTMLElement;
    if (!HTMLEl) return;
    /**
     * 这一轮**真的动了 DOM** 吗（插入了新节点）。
     * 只重排/显隐不需要重画覆盖层；插入/替换之后必须 `refreshDom()` ——
     * 否则新文字节点的选中框会按"还没进 DOM"量成 0 高。
     */
    let domChanged = false;
    const layers = layoutData?.doc.layers ?? [];
    const live = new Set(layers.map((l) => l.id));
    // ① 文档里**已经删掉**的图层 ⇒ 把残留的容器藏起来。
    //    用 `display:none` 而不是删节点：撤销把图层加回来时还能恢复（下面的 ② 会复原）。
    //    （画布的 srcdoc 是快照、不随文档重载，所以"文档删了"不会自动从 DOM 消失。）
    for (const el of Array.from(d.querySelectorAll('[data-layer-type="layer"]'))) {
      const id = el.getAttribute('data-layer') ?? '';
      if (el instanceof HTMLEl && !live.has(id)) el.style.display = 'none';
    }
    // ② 按**文档顺序**把容器重新 append 一遍（`appendChild` 会移动已有节点）——
    //    这样"上移/下移"的叠放顺序在画布上也立刻跟上，不用重载 srcdoc。
    //
    // ③ **递归**把每个容器里的**元素**也同步一遍（含组内元素）：元素也要能被删、能换顺序，
    //    而画布的 srcdoc 是快照 ⇒ 不主动同步的话"文档删了元素、画布上还留着"。
    //    ⚠️ 判据是 `data-layer` 属性在不在文档的那份清单里；用 `display:none` 而不是删节点，
    //    撤销回来还能恢复。
    const syncChildren = (parentDom: Element, want: readonly ElementNode[]) => {
      const wantIds = new Set(want.map((e) => e.id));
      for (const el of Array.from(parentDom.children)) {
        const id = el.getAttribute('data-layer') ?? '';
        if (!wantIds.has(id) && el instanceof HTMLEl) el.style.display = 'none';
      }
      for (const e of want) {
        let el = parentDom.querySelector(`:scope > [data-layer="${CSS.escape(e.id)}"]`);
        // ⭐ **双写**：文档里有、DOM 里没有（刚新增的元素 / 撤销恢复回来的）⇒
        //    用 `emitElementHtml` 生成那一段插进去。它**自包含**（clip/mask 要的 defs 一起带上），
        //    所以插进去的和整份渲染出来的逐字节相同。
        if (!(el instanceof HTMLEl) && layoutData) {
          parentDom.insertAdjacentHTML(
            'beforeend',
            emitElementHtml(e, layoutData.doc.canvas, { assets: layoutData.assets }).html,
          );
          el = parentDom.querySelector(`:scope > [data-layer="${CSS.escape(e.id)}"]`);
          domChanged = true;
        }
        if (!(el instanceof HTMLEl)) continue;
        el.style.display = '';
        parentDom.appendChild(el);
        if (e.type === 'group') {
          // 组内元素：`GroupNode.elements`
          syncChildren(el, e.elements);
        }
      }
    };

    for (const l of layers) {
      let el = d.querySelector(`[data-layer="${CSS.escape(l.id)}"]`);
      // ⭐ **双写**：文档里有、DOM 里没有（新建的图层 / 撤销恢复回来的）⇒
      //    用 `emitLayerHtml` 生成那一段**直接插进去**，不重渲整页（不闪、不打断编辑态）。
      //    和整份渲染是**同一段代码**产的 ⇒ 不会和产物漂。
      if (!(el instanceof HTMLEl) && layoutData) {
        // ⚠️ 必须插进**画布** `.vc`（图层容器在 emit 里就是 `.vc` 的孩子）。
        //    以前写的是 `.stage` / `body`——emit 里根本没有 `.stage`，
        //    于是新图层被插到 `body`（画布外面，不被 `.vc` 的 overflow 裁）。
        //    以前整页重渲把它盖过去了，就地补 DOM 之后就藏不住了。
        (d.querySelector('.vc') ?? d.body).insertAdjacentHTML(
          'beforeend',
          emitLayerHtml(l, layoutData.doc.canvas, { assets: layoutData.assets }).html,
        );
        el = d.querySelector(`[data-layer="${CSS.escape(l.id)}"]`);
        domChanged = true;
      }
      if (!(el instanceof HTMLEl)) continue;
      el.style.display = l.visible === false ? 'none' : '';
      el.parentElement?.appendChild(el);
      syncChildren(el, l.elements);
    }
    // 插过节点 ⇒ 覆盖层要按**新 DOM** 重量一次（新文字节点的框高 = 实测高度）
    if (domChanged) editorRef.current?.refreshDom();
  }, [layoutData]);

  // 宿主信号（面板发起的选中 / patch）→ 直接调编辑器，不再走 postMessage
  const lastSeq = useRef(0);
  useEffect(() => {
    if (!hostSignal || hostSignal.seq === lastSeq.current) return;
    lastSeq.current = hostSignal.seq;
    const ed = editorRef.current;
    if (!ed) return;
    const sig = hostSignal;
    switch (sig.type) {
      case 'select':
        if (sig.id) ed.select(sig.id);
        break;
      case 'patch':
        if (sig.id && sig.path) {
          ed.patch(sig.id, sig.path, sig.value);
          // ⭐ **补齐"改 DOM"那一半**：面板改字段原来只写了 doc，画布不动。
          //    ⚠️ **不能在这里就地重发**：`ed.patch()` 之后新文档要经过
          //      `scheduleCommit` 的防抖（80ms）才通过 `onChange` 送到宿主，
          //      此刻手上还是**旧文档** ⇒ 重发出来的 HTML 里没有这次改动（实测踩过）。
          //      ⇒ 只记下"改的是谁"，真正的重发放到 `onChange` 里（那时 `next` 才是新的）。
          pendingPatchRef.current = sig.id;
        }
        break;
      /**
       * ⭐ 给画面上**选中的那几个字**刷样式（样式面板发起的）。
       *
       * 面板给的是 `path + value`（`path` 来自 `selectionFields()`），
       * px → 0–1 换算、装饰线的逐项合并**都在编辑器里做** ——
       * 面板不必知道 `RunPatch` 的形状，宿主也不必。
       */
      case 'style-selection':
        if (sig.path !== undefined) ed.styleSelection(sig.path, sig.value);
        break;
      case 'undo':
        ed.undo();
        break;
      case 'redo':
        ed.redo();
        break;
      // ⭐ 增删/排序走 handle（M3 API）——id 生成在这里（add 用时间戳，保唯一）
      case 'add-text':
        ed.addElement({
          id: `t${Date.now()}`,
          type: 'text',
          // ⚠️ 文字只有 `frame`（x/y/换行宽），**没有高度**（高度是排版结果）
          frame: { x: 270, y: 192, w: 360 },
          runs: [{ text: '双击编辑文字' }],
          fontSizePx: 36,
          fill: '#2B2B2B',
          align: 'left',
        });
        break;
      // ⚠️ 这里原来有 `add-rect` / `add-ellipse` / `add-polygon` / `add-path` 四个分支
      //    （在写死的位置放个写死的尺寸）—— **已删**（2026-10-17）：形状一律**拖画**出来
      //    （见 `.canvas-draw-layer` + `makeShapeNode`），那 4 个信号再没有任何 UI 会发。
      case 'new-layer':
        ed.createLayer();
        break;
      case 'goto-step':
        // ⭐ 历史面板：跳到第 index 步（`0` = 最初）。整份文档会换 ⇒ 上面那条
        //   `label === '历史跳转'` 的重发会负责把画布整块换掉 ✓
        ed.gotoStep(sig.index ?? 0);
        break;
      case 'remove-history':
        // ⭐ 历史面板右键"删除这条历史"：删当前步 ⇒ 编辑器会退到上一步，
        //   并带 `label='历史跳转'` 发一次变更 ⇒ 画布整块重发 ✓
        //   删的不是当前步 ⇒ 文档不变（label='历史删除'，画布不用动）✓
        ed.removeHistoryStep(sig.index ?? 0);
        break;
      case 'remove':
      case 'up':
      case 'down':
        if (sig.id) {          if (sig.type === 'remove') ed.removeLayer(sig.id);
          else ed.moveLayer(sig.id, sig.type);
        }
        break;
    }
  }, [hostSignal]);

  /**
   * ⭐ **形状绘制层**（`drawMode` 打开时才有）—— 在画布上拖一个框就画出一个形状。
   *
   * 为什么放在**父文档**、而不是编辑器里：绘制是"工具模式"的行为，宿主本来就管着
   * 画布外的一切（平移、覆盖层）；而且这样**不需要懂 `vocab-editor` 的任何内部**。
   * 编辑器只负责最后一步 `addElement`（进当前图层 + 双写立刻可见）。
   *
   * ⚠️ **坐标不用换算**：这一层是 `.canvas-wrapper`（挂着 `scale(zoom)`）的直接子元素，
   *    `position:absolute; inset:0` ⇒ 它的本地坐标**就是画布 px** ✓
   */
  const [draft, setDraft] = useState<Rect | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  /** Esc 按下 ⇒ 这一笔作废（松手时**不要**建节点） */
  const drawCancelledRef = useRef(false);

  /**
   * 屏幕 px → 画布 px 的比例。
   *
   * ⚠️ **不能直接用 `offsetX`**：它不认 CSS transform —— 它是"相对元素**视觉**框的屏幕 px"，
   *    而 `.canvas-wrapper` 上挂着 `scale(zoom)` ⇒ 拿到的是 `画布px × zoom`（偏小）。
   *    实测踩过：拖 140×90 的框，画出来只有 `140×zoom`。
   */
  const canvasScaleOf = (el: Element): number => {
    const r = el.getBoundingClientRect();
    return r.width > 0 ? canvasSize.w / r.width : 1;
  };

  const onDrawDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const r = e.currentTarget.getBoundingClientRect();
      const k = canvasScaleOf(e.currentTarget);
      const x = (e.clientX - r.left) * k;
      const y = (e.clientY - r.top) * k;
      drawStartRef.current = { x, y };
      drawCancelledRef.current = false; // 新的一笔 ⇒ 清掉上一笔的"取消"标记
      setDraft({ x, y, w: 0, h: 0 });
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [canvasSize.w],
  );

  const onDrawMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const st = drawStartRef.current;
      if (!st) return;
      const r = e.currentTarget.getBoundingClientRect();
      const k = canvasScaleOf(e.currentTarget);
      let dx = (e.clientX - r.left) * k - st.x;
      let dy = (e.clientY - r.top) * k - st.y;
      if (e.shiftKey) {
        // Shift ⇒ 正方形 / 正圆
        const s = Math.max(Math.abs(dx), Math.abs(dy));
        dx = (Math.sign(dx) || 1) * s;
        dy = (Math.sign(dy) || 1) * s;
      }
      // ⚠️ **反向拖**（右下往左上）必须归一化，否则出现负宽高
      setDraft({ x: Math.min(st.x, st.x + dx), y: Math.min(st.y, st.y + dy), w: Math.abs(dx), h: Math.abs(dy) });
    },
    [canvasSize.w],
  );

  const onDrawUp = useCallback(() => {
    const st = drawStartRef.current;
    const d = draft;
    const cancelled = drawCancelledRef.current;
    drawStartRef.current = null;
    drawCancelledRef.current = false;
    setDraft(null);
    if (!st || !d || cancelled) return;
    // ⚠️ 太小 ⇒ 当作**点击**（不创建）：防止手一抖出现一个看不见的元素
    if (d.w < 2 || d.h < 2) return;
    editorRef.current?.addElement(makeShapeNode(shapeKind ?? 'rect', d));
  }, [draft, shapeKind]);

  /**
   * **Esc 取消正在画的那一笔**（拖到一半反悔）。
   *
   * ⚠️ 只在"正在画"时挂监听（`draft` 有值）—— 平时不能抢 `Esc`
   *    （别的地方可能用它，比如关 `Dialog` / 取消文字编辑）。
   * ⚠️ 取消标记必须留到**松手**才消费：Esc 之后鼠标还按着，松手那一下
   *    如果不清掉标记，就会把作废的这一笔画出来。
   */
  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      drawCancelledRef.current = true;
      drawStartRef.current = null;
      setDraft(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [draft]);

  // ── 鼠标拖拽平移 ──
  // ⚠️ 只在**画布外的灰底**上拖才平移。画布内部的指针归编辑器：
  // iframe 现在 `pointer-events:none`，画布内的 mousedown 目标会变成
  // `.canvas-wrapper` —— 若沿用旧条件（target === wrapper）就会和"拖图层"打架。
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === canvasRef.current) {
        setDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
      }
    },
    [panX, panY],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;
      setPanX(dragStart.current.px + (e.clientX - dragStart.current.x));
      setPanY(dragStart.current.py + (e.clientY - dragStart.current.y));
    },
    [dragging],
  );

  const onMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  // ── 滚轮缩放（以鼠标位置为中心）──
  // ⚠️ 必须用原生 addEventListener({passive:false}):React 合成 onWheel 是
  // passive 监听,里面调 preventDefault 会刷「Unable to preventDefault」警告
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setZoom((z) => {
        const newZoom = Math.max(0.1, Math.min(5, z * factor));
        // 以鼠标位置为缩放中心(pan 用当前值;函数式更新里读不到其他 state,
        // 用 setPan 的函数式串联)
        setPanX((px) => mx - ((mx - px) / z) * newZoom);
        setPanY((py) => my - ((my - py) / z) * newZoom);
        return newZoom;
      });
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, []);

  // ══════════════════════════════════
  // 渲染
  // ══════════════════════════════════

  return (
    <section className="preview-panel">
      <div
        ref={canvasRef}
        className={`preview-canvas${dragging ? ' dragging' : ''}`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {srcdoc ? (
          <div
            ref={wrapperRef}
            className="canvas-wrapper"
            style={{
              transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
              transformOrigin: '0 0',
              width: canvasSize.w,
              height: canvasSize.h,
            }}
          >
            <iframe
              ref={iframeRef}
              className="preview-frame"
              srcDoc={srcdoc}
              // 收紧：不再需要 allow-scripts —— 子文档里已无脚本。
              // （旧配置 `allow-scripts allow-same-origin` 是"能逃出沙箱"的
              //  反模式，浏览器自己会在控制台报警。）
              sandbox="allow-same-origin"
              title="设计预览"
              onLoad={bind}
              style={{
                width: canvasSize.w,
                height: canvasSize.h,
                border: 'none',
                // 纯渲染器：平时不收指针（事件由父侧覆盖层接管）；
                // 就地改字时临时放开，好让鼠标能点到光标位置。
                pointerEvents: editingText ? 'auto' : 'none',
              }}
            />
            {/* ⭐ **形状绘制层**（只在「形状」工具下挂载）：拖一个框就画出来。
                ⚠️ 它会挡住选元素/拖元素 —— 故意的（PS 同款），避免画形状时误触。 */}
            {drawMode ? (
              <div
                className="canvas-draw-layer"
                onPointerDown={onDrawDown}
                onPointerMove={onDrawMove}
                onPointerUp={onDrawUp}
              >
                {draft && draft.w > 0 && draft.h > 0 ? (
                  <>
                    {/* ⭐ 预览 = **真实形状**，用 `emitElementHtml` 生成的那一段
                        （和松手后落盘的是同一段代码 ⇒ 不可能出现"看着是圆、松手变方"）。
                        拖的时候描边用强调色，一眼看出"还在画"；松手落盘是中性灰。 */}
                    <div
                      className="canvas-draw-preview"
                      dangerouslySetInnerHTML={{
                        __html: layoutData
                          ? emitElementHtml(makeShapeNode(shapeKind ?? 'rect', draft, '#6C5CE7'), layoutData.doc.canvas, {
                              assets: layoutData.assets,
                            }).html
                          : '',
                      }}
                    />
                    {/* 很淡的包围盒（只是尺寸参考，不抢形状的戏） */}
                    <div
                      className="canvas-draw-box"
                      style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }}
                    />
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : previewUrl ? (
          <img className="preview-image" src={previewUrl ?? undefined} alt="设计预览" />
        ) : (
          <div className="preview-placeholder">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
            <span className="preview-placeholder-text">设计预览将在此展示</span>
            <span className="preview-placeholder-hint">输入设计描述，开始生成</span>
          </div>
        )}

        {/* 缩放控件 + 导出 */}
        {layoutData && (
          <div className="zoom-controls">
            <button className="zoom-btn" onClick={() => setZoom((z) => Math.min(5, z * 1.2))} title="放大">
              +
            </button>
            <span className="zoom-value" onClick={fitToCanvas} title="适应画布">
              {Math.round(zoom * 100)}%
            </span>
            <button className="zoom-btn" onClick={() => setZoom((z) => Math.max(0.1, z / 1.2))} title="缩小">
              −
            </button>
            <button className="zoom-btn zoom-fit" onClick={fitToCanvas} title="适应窗口">
              ⊡
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
