import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { extractElements, type ExtractedElement } from '../preview/extract-elements';
import { createInteractionScript } from '../preview/interaction-script';

interface PreviewPanelProps {
  htmlCode?: string;
  previewUrl?: string | null;
  selectedElements: Set<string>;
  onToggleElement: (id: string) => void;
  onRegenerateSelected: () => void;
  onExport?: () => void;
}

export interface ElementSelectEvent {
  tag: string;
  id: string;
  className: string;
  text: string;
  slotId: string;
  rect: DOMRectReadOnly;
}

/** 默认画布尺寸，在解析不到 HTML 尺寸时使用 */
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 1200;

export function PreviewPanel({
  htmlCode,
  previewUrl,
  selectedElements,
  onToggleElement,
  onRegenerateSelected,
  onExport,
}: PreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hasSelection = selectedElements.size > 0;

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

  // ── iframe srcdoc ──
  const srcdoc = useMemo(() => {
    if (!htmlCode) return '';
    return htmlCode.replace(
      '</body>',
      `${createInteractionScript()}</body>`,
    );
  }, [htmlCode]);

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

  // 画布尺寸更新后重新适应
  useEffect(() => {
    fitToCanvas();
  }, [canvasSize, fitToCanvas]);

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

  // ── 滚轮缩放（以鼠标位置为中心） ──
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const container = canvasRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.max(0.1, Math.min(5, zoom * factor));

      // 以鼠标位置为缩放中心
      const newPanX = mx - ((mx - panX) / zoom) * newZoom;
      const newPanY = my - ((my - panY) / zoom) * newZoom;

      setZoom(newZoom);
      setPanX(newPanX);
      setPanY(newPanY);
    },
    [zoom, panX, panY],
  );

  // ── 与 iframe 通信 ──
  const sendToIframe = useCallback(
    (action: string, data?: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage(
        { source: 'vinart', action, ...data },
        '*',
      );
    },
    [],
  );

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
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [elements, selectedElements, onToggleElement]);

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
        onWheel={onWheel}
      >
        {htmlCode ? (
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
          <img className="preview-image" src={previewUrl} alt="设计预览" />
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
        {htmlCode && (
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
            {onExport && (
              <button className="export-btn" onClick={onExport} title="渲染导出为成品图">
                ⬇ 导出
              </button>
            )}
          </div>
        )}
      </div>

      <div className="element-list">
        <div className="element-list-header">
          <span className="element-list-title">
            {htmlCode ? `设计元素 (${elements.length})` : '图像元素'}
          </span>
          {hasSelection && (
            <button className="btn btn-sm" onClick={onRegenerateSelected}>
              重新生成 ({selectedElements.size})
            </button>
          )}
        </div>
        <div className="element-items">
          {htmlCode ? (
            elements.map((el) => (
              <label
                key={el.id}
                className={`element-tag${selectedElements.has(el.id) ? ' selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selectedElements.has(el.id)}
                  onChange={() => onToggleElement(el.id)}
                />
                <span className="element-tag-type">{el.type}</span>
                {el.label}
              </label>
            ))
          ) : (
            <>
              {['背景', '主视觉', '标题', '副标题', '价格标签', 'CTA 按钮'].map((label, i) => (
                <label
                  key={i}
                  className={`element-tag${selectedElements.has(label) ? ' selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedElements.has(label)}
                    onChange={() => onToggleElement(label)}
                  />
                  {label}
                </label>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
