import { useMemo } from 'react';

import type { DesignDocument, Layer } from '../document/vocabulary';
import { emitLayerHtml } from '../render/vocabulary/emit';

/**
 * **图层缩略图**（方案 A：每层一个只读 iframe）。
 *
 * 取 `emitLayerHtml(layer)` —— 和画布同一套渲染器，但只发这一层的 DOM；
 * 外面套上画布 `.vc` + 主文档的 `baseCss`（字体 / 基础样式 / extraCss），
 * 再用 `transform: scale()` 缩到列表行里。iframe 不带编辑器、`pointer-events:none`，
 * 点击由父页面的图层行处理。
 *
 * ⚠️ A 的代价：`srcDoc` 一变，**这个 iframe 的 document 会重载**（只有这一层会闪）。
 *    其他图层的 `srcDoc` 字符串不变 ⇒ React 不碰它 ⇒ 不重载。
 * ⚠️ 不做 `useMemo(layer)`：图层的字段是**原地改**的，引用不一定变；
 *    每次渲染都重新 emit，靠 `iframe.srcDoc` 的字符串比较决定要不要真正重载。
 */

const THUMB_W = 112;

/** 从主文档 HTML 里取 `<style>`（基础样式 + extraCss + @font-face） */
export function baseCssOf(html: string): string {
  return /<style>([\s\S]*?)<\/style>/i.exec(html)?.[1] ?? '';
}

export function LayerThumb({
  layer,
  doc,
  assets,
  baseCss,
}: {
  layer: Layer;
  doc: DesignDocument;
  assets: Record<string, string>;
  baseCss: string;
}) {
  const cw = Math.max(1, doc.canvas.width);
  const ch = Math.max(1, doc.canvas.height);
  const scale = THUMB_W / cw;
  const th = Math.max(1, Math.round(ch * scale));
  // 不缓存：图层是原地改的，每次重算才能拿到最新元素。
  // ⚠️ 缩略图是“这层有什么”的预览 ⇒ **忽略 visible**：隐藏的图层也要能看到内容；
  //    主画布的 emitDocument 仍然尊重 visible（隐藏的图层在画布上不出现）。
  const layerHtml = emitLayerHtml({ ...layer, visible: true }, doc.canvas, { assets }).html;
  const canvasBg = Array.isArray(doc.canvas.background)
    ? `background-image:${[...doc.canvas.background].reverse().join(',')};background-color:transparent`
    : `background:${doc.canvas.background ?? '#FFFFFF'}`;
  const html = useMemo(
    () =>
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseCss}</style></head>` +
      `<body><div class="vc" style="width:${cw}px;height:${ch}px;${canvasBg}">${layerHtml}</div></body></html>`,
    [baseCss, cw, ch, canvasBg, layerHtml],
  );

  return (
    <span
      className={`ui-layer-thumb${layer.visible === false ? ' is-hidden' : ''}`}
      style={{ width: THUMB_W, height: th }}
      title={`图层 · ${layer.name ?? layer.id}${layer.visible === false ? '（已隐藏）' : ''}`}
    >
      <iframe
        srcDoc={html}
        sandbox="allow-same-origin"
        scrolling="no"
        tabIndex={-1}
        aria-hidden="true"
        loading="lazy"
        style={{ width: cw, height: ch, transform: `scale(${scale})` }}
      />
    </span>
  );
}
