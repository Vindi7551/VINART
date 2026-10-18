import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from '../src/designharness/tools/generate-assets';

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
  '<path d="M3 4h18v16H3z"/></svg>';

describe('sanitizeSvg', () => {
  it('线框 SVG 通过', () => {
    const r = sanitizeSvg(ICON);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.svg.startsWith('<svg')).toBe(true);
    // 外部 <img src="...svg"> 需要 xmlns，否则浏览器破图
    expect(r.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('拒绝脚本 / 事件 / javascript: / foreignObject / 外链', () => {
    expect(sanitizeSvg('<svg><script>alert(1)</script></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg onload="x()"></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg><a href="javascript:x">x</a></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg><foreignObject></foreignObject></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg><image href="https://x/a.png"/></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg><rect style="fill:url(https://x/a)"/></svg>').ok).toBe(false);
  });

  it('非 svg 拒绝', () => {
    expect(sanitizeSvg('<div></div>').ok).toBe(false);
  });
});
