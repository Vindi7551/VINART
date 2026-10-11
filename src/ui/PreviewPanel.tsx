import { useEffect, useRef, useCallback, useState } from 'react';
import { createEditor, type EditorHandle } from '../editor';
import type { LayerPatch } from '../editor/types';
import type { LayoutData, HostSignal } from './types';

interface PreviewPanelProps {
  /** 数据还没到时的兜底图（PNG） */
  previewUrl?: string | null;
  /** 版式编辑模式：有值 = 用服务端现场渲染的 HTML + 父侧编辑器 */
  layoutData?: LayoutData | null;
  /** 会话 id：有值 = 素材 base 走 file API（工作目录模式）；无 = 旧约定 /files/ */
  sessionId?: string | null;
  /** 图上操作(拖拽/缩放/旋转/就地改字)→ App 合并进持久数据 */
  onLayerChange?: (id: string, patch: LayerPatch) => void;
  /** 图上点选 → App 侧同步选中（右栏面板跟着切） */
  onLayerSelect?: (id: string) => void;
  /** 点在染色词上 → 面板单行颜色切换为该词的颜色 */
  onLayerWord?: (id: string, word: string) => void;
  /** 宿主信号：参数面板/图层清单发起的选中与 patch */
  hostSignal?: HostSignal | null;
  /**
   * 图层可视性（隐藏集合）—— **编辑器视角态，不进 spec**。
   * 整集下发（`setHidden`），幂等；iframe 重载后由 `onLoad` 重放。
   */
  hiddenLayers?: ReadonlySet<string> | null;
}

/** 默认画布尺寸，在解析不到 HTML 尺寸时使用 */
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 1200;

export function PreviewPanel({
  previewUrl,
  layoutData,
  sessionId,
  onLayerChange,
  onLayerSelect,
  onLayerWord,
  hostSignal,
  hiddenLayers,
}: PreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle | null>(null);

  // ── 画布状态：缩放 & 平移 ──
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** 就地改字中：此时把指针**还给 iframe**，好让鼠标能点光标位置 */
  const [editingText, setEditingText] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const [canvasSize, setCanvasSize] = useState({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });

  // ── 编辑器读取的一切都走 ref ──
  // 目的：`bind()` 保持**稳定**，只在 srcdoc 变化时重挂；否则每次 props 变
  // 都会 dispose + create（覆盖层会闪、编辑态会丢）。
  const cbRef = useRef({ onLayerChange, onLayerSelect, onLayerWord });
  cbRef.current = { onLayerChange, onLayerSelect, onLayerWord };
  const specRef = useRef(layoutData?.spec ?? null);
  specRef.current = layoutData?.spec ?? null;
  const appearanceRef = useRef(layoutData?.appearance ?? null);
  appearanceRef.current = layoutData?.appearance ?? null;
  const hiddenRef = useRef<ReadonlySet<string>>(hiddenLayers ?? new Set());
  hiddenRef.current = hiddenLayers ?? new Set();

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
  const layoutSrcdoc = !base
    ? ''
    : base.html.replace(
        '</head>',
        (sessionId
          ? `<base href="/api/sessions/${sessionId}/file/designs/${base.name}/">`
          : `<base href="/files/test_product/layout/${base.name}/">`) + '</head>',
      );

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
    const { width, height } = layoutData.spec.canvas;
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
    const spec = specRef.current;
    if (!wrap || !root || !spec) return;

    editorRef.current?.dispose();
    // `document` = 宿主（父）文档；`root` = 子文档。两者都从参数流入，
    // 编辑器自己不认识任何"当前页面"（见 src/editor/README.md 不变量①）。
    const ed = createEditor(document, wrap, root, {
      spec,
      appearance: appearanceRef.current ?? undefined,
      onSelect: (id) => {
        if (id) cbRef.current.onLayerSelect?.(id);
      },
      onChange: (id, patch) => cbRef.current.onLayerChange?.(id, patch),
      onWord: (id, word) => cbRef.current.onLayerWord?.(id, word),
      onEditingChange: setEditingText,
    });
    ed.setHidden(hiddenRef.current);
    editorRef.current = ed;
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

  // 数据变了 → 刷新编辑器的工作副本 + 覆盖层
  useEffect(() => {
    if (!layoutData) return;
    editorRef.current?.updateLayout(layoutData.spec, layoutData.appearance);
  }, [layoutData]);

  // 隐藏集合变了 → 整集下发（幂等）
  useEffect(() => {
    editorRef.current?.setHidden(hiddenLayers ?? new Set());
  }, [hiddenLayers]);

  // 宿主信号（面板发起的选中 / patch）→ 直接调编辑器，不再走 postMessage
  const lastSeq = useRef(0);
  useEffect(() => {
    if (!hostSignal || hostSignal.seq === lastSeq.current) return;
    lastSeq.current = hostSignal.seq;
    const ed = editorRef.current;
    if (!ed) return;
    if (hostSignal.type === 'select') ed.select(hostSignal.id);
    if (hostSignal.type === 'patch') ed.patch(hostSignal.id, hostSignal.patch ?? {});
  }, [hostSignal]);

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
