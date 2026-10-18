import { useMemo, useState } from 'react';

import type { DesignDocument } from '../document/vocabulary';
import { emitDocument } from '../render/vocabulary/emit';

/**
 * **设计缩略图**（和 `LayerThumb` 同一套：只读 iframe + `transform: scale`）。
 *
 * 区别：
 * - `LayerThumb` 用 `emitLayerHtml` 只发一层；
 * - `DesignThumb` 用 `emitDocument` 发整份设计，画廊卡片里看的是**当前 doc**；
 * - 加载中/失败显示占位 SVG（不是 `final.png`；`final.png` 只用于导出）。
 */

const THUMB_W = 96;
const THUMB_H = 72;

const PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">' +
    '<g stroke="#9AA0A6" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" opacity="0.45">' +
    '<rect x="56" y="56" width="400" height="400" rx="40"/>' +
    '<circle cx="168" cy="168" r="36"/>' +
    '<path d="M96 400l128-128 96 96 64-64 96 96"/>' +
    '</g></svg>',
)}`;

export function DesignThumb({
  doc,
  assets,
}: {
  doc: DesignDocument;
  assets: Record<string, string>;
}) {
  const [loaded, setLoaded] = useState(false);

  const cw = Math.max(1, doc.canvas.width);
  const ch = Math.max(1, doc.canvas.height);
  const scale = Math.min(THUMB_W / cw, THUMB_H / ch);
  const html = useMemo(() => emitDocument(doc, { assets }).html, [doc, assets]);

  return (
    <span className="design-thumb" style={{ width: THUMB_W, height: THUMB_H }}>
      {!loaded && <img className="design-thumb-loading" src={PLACEHOLDER} alt="" />}
      <iframe
        srcDoc={html}
        sandbox="allow-same-origin"
        scrolling="no"
        tabIndex={-1}
        aria-hidden="true"
        loading="lazy"
        onLoad={() => setLoaded(true)}
        style={{ width: cw, height: ch, transform: `scale(${scale})` }}
      />
    </span>
  );
}
