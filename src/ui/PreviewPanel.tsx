import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { extractElements, type ExtractedElement } from '../preview/extract-elements';
import { createInteractionScript } from '../preview/interaction-script';
import { createLayoutEditorScript } from '../preview/layout-editor-script';
import type { LayoutData, HostSignal } from './types';

export interface ElementSelectEvent {
  tag: string;
  id: string;
  className: string;
  text: string;
  slotId: string;
  rect: DOMRectReadOnly;
}

interface PreviewPanelProps {
  htmlCode?: string;
  previewUrl?: string | null;
  selectedElements: Set<string>;
  onToggleElement: (id: string) => void;
  onExport?: () => void;
  /** 版式编辑模式:有值 = 用服务端现场渲染的 HTML + 受控编辑器(逐元素修改) */
  layoutData?: LayoutData | null;
  /** 会话 id:有值 = 素材 base 走 file API(工作目录模式);无 = 旧约定 /files/ */
  sessionId?: string | null;
  /** 图上操作(拖拽/缩放/旋转/就地改字)→ App 合并进持久数据 */
  onLayerChange?: (id: string, patch: Record<string, unknown>) => void;
  /** 图上点选 → App 侧同步选中(右栏面板跟着切) */
  onLayerSelect?: (id: string) => void;
  /** 点在染色词上 → 面板单行颜色切换为该词的颜色 */
  onLayerWord?: (id: string, word: string) => void;
  /** 宿主信号:参数面板/图层清单发起的选中与 patch,转发给 iframe */
  hostSignal?: HostSignal | null;
}

/** 默认画布尺寸，在解析不到 HTML 尺寸时使用 */
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 1200;

export function PreviewPanel({
  htmlCode,
  previewUrl,
  selectedElements,
  onToggleElement,
  onExport,
  layoutData,
  sessionId,
  onLayerChange,
  onLayerSelect,
  onLayerWord,
  hostSignal,
}: PreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // ── 画布状态：缩放 & 平移 ──
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const [canvasSize, setCanvasSize] = useState({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });

  // ── 动态提取元素 ──
  const elements: ExtractedElement[] = useMemo(
    () => (htmlCode ? extractElements(htmlCode) : []),
    [htmlCode],
  );

  // ── 版式编辑模式:srcdoc 只在换版式时构建一次 ──
  // base 快照与实时数据解耦:patch 走 postMessage + App 数据合并,
  // 若让 srcdoc 跟随数据重建,iframe 整页重载会刷新掉实时编辑态(实测踩过)
  const [base, setBase] = useState<{
    name: string;
    html: string;
    spec: string;
    appearance: string;
  } | null>(null);
  useEffect(() => {
    if (layoutData && (!base || base.name !== layoutData.name)) {
      setBase({
        name: layoutData.name,
        html: layoutData.html,
        spec: JSON.stringify(layoutData.spec),
        appearance: JSON.stringify(layoutData.appearance),
      });
    }
  }, [layoutData, base]);
  const layoutSrcdoc = useMemo(() => {
    if (!base) return '';
    // 服务端现场渲染的成品 HTML（data 端点）——不再有"独立编辑器注入残留"要剥：
    // 那份注入（scripts/editor.inject.js + injectEditor）已于 2026-10-09 随
    // final.html / final.linked.html 一起删除（见 emit-html.ts 头注释）。
    const html = base.html;
    // 相对素材的基准(必须进 head):
    // - 会话工作目录模式:file API 作 base——query 型 base 下,相对文件名会追加到
    //   rel 参数后(base 带 ?rel=designs/<name>/ + img src="hero.png"
    //   → ?rel=designs/<name>/hero.png),后端从工作目录流式返回
    // - legacy:dev-server 的 /files 静态映射(test_product)
    const baseTag = sessionId
      ? `<base href="/api/sessions/${sessionId}/file/designs/${base.name}/">`
      : `<base href="/files/test_product/layout/${base.name}/">`;
    // 数据块 + 编辑脚本必须注入 **body 末尾**——放 head 里执行时 body/canvas
    // 还不存在,脚本会静默退出,交互全无(实测踩过)
    const inject =
      `<script type="application/json" id="__vinart-data">${base.spec}</script>` +
      `<script type="application/json" id="__vinart-appearance">${base.appearance}</script>` +
      createLayoutEditorScript();
    return html
      .replace('</head>', baseTag + '</head>')
      .replace('</body>', inject + '</body>');
  }, [base, sessionId]);

  // ── iframe srcdoc ──
  const srcdoc = useMemo(() => {
    if (layoutData) return layoutSrcdoc;
    if (!htmlCode) return '';
    return htmlCode.replace('</body>', `${createInteractionScript()}</body>`);
  }, [layoutData, layoutSrcdoc, htmlCode, sessionId]);

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

  // 每次 htmlCode 变更时自适应
  useEffect(() => {
    if (htmlCode) fitToCanvas();
  }, [htmlCode, fitToCanvas]);

  // htmlCode 变更时重置画布尺寸，等 iframe 上报真实尺寸
  useEffect(() => {
    if (htmlCode) setCanvasSize({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });
  }, [htmlCode]);

  // 版式编辑模式:画布尺寸直接来自 spec
  useEffect(() => {
    if (layoutData) setCanvasSize({ w: layoutData.spec.canvas.width, h: layoutData.spec.canvas.height });
  }, [layoutData]);

  // ── 鼠标拖拽平移 ──
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === wrapperRef.current || e.target === canvasRef.current) {
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

  // ── 与 iframe 通信 ──
  // 信封同时带 action(旧 interaction-script)与 type(受控编辑脚本)——两代脚本共用一个通道
  const sendToIframe = useCallback(
    (action: string, data?: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage(
        { source: 'vinart', action, type: action, ...data },
        '*',
      );
    },
    [],
  );

  // zoom 变化 → 编辑脚本换算鼠标 delta 用
  useEffect(() => {
    if (layoutData) sendToIframe('ve:viewport', { zoom });
  }, [zoom, layoutData, sendToIframe]);

  // 宿主信号(面板发起的选中/patch)转发给 iframe
  const lastSeq = useRef(0);
  useEffect(() => {
    if (!hostSignal || hostSignal.seq === lastSeq.current) return;
    lastSeq.current = hostSignal.seq;
    if (hostSignal.type === 'select') sendToIframe('ve:select', { id: hostSignal.id });
    if (hostSignal.type === 'patch')
      sendToIframe('ve:patch', { id: hostSignal.id, patch: hostSignal.patch });
  }, [hostSignal, sendToIframe]);

  // ── 列表→画布：选中新增元素时通知 iframe 高亮 ──
  const prevSelected = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const id of selectedElements) {
      if (!prevSelected.current.has(id)) {
        const el = elements.find((e) => e.id === id);
        if (el) {
          sendToIframe('select-by-id', {
            vinartId: el.id,
            slotId: el.slotId,
            tag: el.tag,
            text: el.textSnippet,
          });
        }
        break;
      }
    }
    prevSelected.current = new Set(selectedElements);
  }, [selectedElements, elements, sendToIframe]);

  // ── 画布→列表：监听 iframe postMessage ──
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      const msg = e.data;
      if (!msg || msg.source === 'vinart') return;

      if (msg.type === 'vinart:select') {
        const el = msg.element as ElementSelectEvent & { vinartId?: string; vinartType?: string };
        // 优先用 data-vinart-id 精确匹配
        let targetId = el.vinartId ?? '';
        if (!targetId && el.slotId) {
          // 回退：slotId 直接匹配（元素 id 就是 slotId 值）
          targetId = el.slotId;
        }
        if (!targetId) {
          // 最终回退：文本前 10 字模糊匹配
          const found = elements.find(
            (ext) =>
              ext.textSnippet && el.text.includes(ext.textSnippet.slice(0, 10)),
          );
          targetId = found?.id ?? '';
        }
        if (targetId && !selectedElements.has(targetId)) {
          onToggleElement(targetId);
        }
      }

      if (msg.type === 'vinart:deselect') {
        selectedElements.forEach((id) => onToggleElement(id));
      }

      if (msg.type === 'vinart:canvas-size' && msg.width > 0 && msg.height > 0) {
        setCanvasSize({ w: msg.width, h: msg.height });
      }

      // 版式编辑通路:图上点选/图上操作 → App 合并持久数据
      if (layoutData && msg.source === 'vinart-editor') {
        if (msg.type === 've:select' && msg.id) onLayerSelect?.(msg.id as string);
        if (msg.type === 've:word' && msg.id) onLayerWord?.(msg.id as string, msg.word as string);
        if (msg.type === 've:change' && msg.id) {
          onLayerSelect?.(msg.id as string);
          onLayerChange?.(msg.id as string, (msg.patch ?? {}) as Record<string, unknown>);
        }
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [elements, selectedElements, onToggleElement, layoutData, onLayerChange, onLayerSelect]);

  const modifyElementStyle = useCallback(
    (property: string, value: string) => {
      sendToIframe('modify-style', { property, value });
    },
    [sendToIframe],
  );

  const modifyElementText = useCallback(
    (text: string) => {
      sendToIframe('modify-text', { text });
    },
    [sendToIframe],
  );

  useEffect(() => {
    (window as any).__vinartPreview = { modifyStyle: modifyElementStyle, modifyText: modifyElementText };
    return () => { delete (window as any).__vinartPreview; };
  }, [modifyElementStyle, modifyElementText]);

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
              sandbox="allow-scripts allow-same-origin"
              title="设计预览"
              style={{
                width: canvasSize.w,
                height: canvasSize.h,
                border: 'none',
                pointerEvents: dragging ? 'none' : 'auto',
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
        {(htmlCode || layoutData) && (
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
            {onExport && htmlCode && (
              <button className="export-btn" onClick={onExport} title="渲染导出为成品图">
                ⬇ 导出
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
