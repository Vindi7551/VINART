/**
 * 两条回归：`style` 属性必须转义；`fill` 不许再铺到节点容器上。
 *
 * 背景（2026-10-19 实测）：
 * - `url("…")` 里的双引号会把外层 `style="…"` 提前闭合 ⇒ mask 直接进不了 DOM，
 *   data URL 和 http URL 都一样坏；带引号的 `fontFamily` 也会把后面的字号/颜色一起截掉。
 * - `fill` 曾经同时写在容器 `background` 和内层（图标走 mask）⇒ 图标变成整块实色。
 */

import { describe, expect, it } from 'vitest';

import type { DesignDocument } from '../src/document/vocabulary';
import { emitDocument } from '../src/render/vocabulary/emit';

const ASSETS: Record<string, string> = {
  'i.svg': 'data:image/svg+xml;base64,AAAA',
  'm.png': 'DATA:mm.png',
  'a.png': 'DATA:a.png',
};
const CANVAS = { width: 400, height: 300 };

const inLayer = (node: unknown): DesignDocument =>
  ({ canvas: CANVAS, layers: [{ id: 'L', elements: [node] }] }) as DesignDocument;

describe('style 属性转义 / fill 不落容器', () => {
  it('svg fill：mask 的 url 引号被转义，容器上不再有 background', () => {
    const r = emitDocument(
      inLayer({ id: 'icon', type: 'svg', asset: 'i.svg', rect: { x: 0, y: 0, w: 10, h: 10 }, fill: '#d33636' }),
      { assets: ASSETS },
    );
    expect(r.html).toContain('-webkit-mask:url(&quot;');
    expect(r.html).toContain('background-color:#d33636');
    const container = /<div class="vl" data-layer="icon"[^>]*style="([^"]*)"/.exec(r.html)?.[1] ?? '';
    expect(container).not.toContain('background');
  });

  it('带引号的 fontFamily 不会把 style 截断（后面的字号仍在同一个属性里）', () => {
    const r = emitDocument(
      inLayer({
        id: 't',
        type: 'text',
        frame: { x: 0, y: 0, w: 100 },
        fontFamily: '"Marker Felt", cursive',
        fontSizePx: 40,
        runs: [{ text: 'x' }],
      }),
      {},
    );
    expect(r.html).toMatch(/data-fit="t" style="[^"]*font-family:&quot;Marker Felt&quot;[^"]*font-size:40px/);
  });

  it('元素级 mask 的 url 引号同样被转义', () => {
    const r = emitDocument(
      inLayer({ id: 's', type: 'shape', kind: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 }, mask: 'url(m.png)' }),
      { assets: ASSETS },
    );
    expect(r.html).toContain('mask-image:url(&quot;DATA:mm.png&quot;)');
  });

  it('image 的 fill 不再画到容器上（仍然报 unsupported）', () => {
    const r = emitDocument(
      inLayer({ id: 'p', type: 'image', asset: 'a.png', rect: { x: 0, y: 0, w: 10, h: 10 }, fill: '#00ff00' }),
      { assets: ASSETS },
    );
    expect(r.html).not.toContain('00ff00');
    expect(r.unsupported.some((u) => u.field === 'fill')).toBe(true);
  });
});
