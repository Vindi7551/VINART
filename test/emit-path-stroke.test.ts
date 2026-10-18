import { describe, expect, it } from 'vitest';

import { emitElementHtml } from '../src/render/vocabulary/emit';
import type { ShapeNode, TextNode } from '../src/document/vocabulary';

/**
 * 沿路径排字（`curve` / `path`）走 SVG `<textPath>`，描边必须落到 SVG 的
 * `stroke` / `stroke-width` —— 普通文字的 `-webkit-text-stroke` 在这条路上没有。
 *
 * 守的是实际踩过的坑：text-stroke 的字加弧形后，描边被静默丢掉，
 * 只剩 `fill:#F5F5F5` 的字面 ⇒ 和背景同色，整块字"消失"。
 */
const canvas = { width: 800, height: 600 };

const text = (stroke: TextNode['stroke']): TextNode => ({
  id: 't',
  type: 'text',
  frame: { x: 0, y: 0, w: 200, h: 80 },
  runs: [{ text: '描边字' }],
  fontSizePx: 20,
  curve: 0.2,
  stroke,
});

describe('沿路径文字的描边', () => {
  it('纯色描边落到 SVG <text> 的 stroke / stroke-width', () => {
    const { html, notes } = emitElementHtml(text({ paint: '#C8323C', width: 2 }), canvas);
    expect(html).toMatch(/<text\b[^>]*\bstroke="#C8323C"/);
    expect(html).toMatch(/<text\b[^>]*\bstroke-width="2"/);
    expect(notes.some((n) => n.field === 'stroke' || n.field === 'stroke.paint')).toBe(false);
  });

  it('渐变描边落到 stroke=url(...)，多档宽度仍会 note', () => {
    const { html, notes } = emitElementHtml(
      text({ paint: 'linear-gradient(#C8323C, #B8722F)', width: [2, 2, 2, 2] }),
      canvas,
    );
    expect(html).toMatch(/<linearGradient id="tp-t-stroke"/);
    expect(html).toMatch(/<text\b[^>]*stroke="url\(#tp-t-stroke\)"/);
    expect(notes.some((n) => n.field === 'stroke.paint')).toBe(false);
    expect(notes.some((n) => n.field === 'stroke.width')).toBe(true);
  });

  it('曲线上的删除线/下划线沿弧线画，不再用 text-decoration 的直线', () => {
    const node = text({ paint: '#C8323C', width: 2 });
    node.runs[0] = { text: '描边字', strike: true, underline: true };
    const { html, notes } = emitElementHtml(node, canvas);
    // 弧线装饰：至少两条带 stroke 的折线 path（删除线 + 下划线）
    const decoPaths = html.match(/<path d="M[^"]*"[^>]*stroke="#C8323C"/g) ?? [];
    expect(decoPaths.length).toBe(2);
    expect(decoPaths[0]).toMatch(/L/);
    // 不再往 tspan 上挂 text-decoration（那会画一条直弦）
    expect(html).not.toMatch(/text-decoration-line/);
    expect(notes.some((n) => n.field === 'underline' && n.reason.includes('弧线'))).toBe(true);
  });

  it('节点渐变作为底色，run fill 仍是字面（和普通文字一致）', () => {
    const node = text(undefined);
    node.fill = ['linear-gradient(#C8323C, #B8722F)', '#F5F5F5'];
    node.runs[0].fill = '#F5F5F5';
    const { html, notes } = emitElementHtml(node, canvas);
    expect(html).toMatch(/<linearGradient id="tp-t-fill"/);
    expect(html).toMatch(/<text\b[^>]*fill="url\(#tp-t-fill\)"/);
    // ⚠️ run fill 是普通文字里的字面（在节点底色之上）——不能为了露渐变而跳过它，
    //    否则 tx-stroke 的"浅色字面 + 红描边"会变成一整块红。
    expect(html).toMatch(/<tspan[^>]*style="[^"]*fill:#F5F5F5/);
    expect(notes.some((n) => n.field === 'fill')).toBe(false);
  });

  it('run 没有 fill 时，节点渐变才作为字面显示', () => {
    const node = text(undefined);
    node.fill = ['linear-gradient(#C8323C, #B8722F)'];
    // 不给 run.fill
    const { html } = emitElementHtml(node, canvas);
    expect(html).toMatch(/<text\b[^>]*fill="url\(#tp-t-fill\)"/);
    expect(html).not.toMatch(/<tspan[^>]*style="[^"]*fill:/);
  });

  it('多层渐变取最上层（数组末尾）的那个，和普通文字一致', () => {
    const node = text(undefined);
    node.fill = [
      'linear-gradient(#111111, #222222)',
      'linear-gradient(#C8323C, #B8722F)',
    ];
    const { html } = emitElementHtml(node, canvas);
    expect(html).toMatch(/stop-color="#C8323C"/);
    expect(html).not.toMatch(/stop-color="#111111"/);
  });

  it('radial-gradient 落到 SVG radialGradient（支持 at 位置）', () => {
    const node = text(undefined);
    node.fill = ['radial-gradient(circle at 30% 40%, #fff, #000)'];
    const { html } = emitElementHtml(node, canvas);
    expect(html).toMatch(/<radialGradient id="tp-t-fill" cx="0.3000" cy="0.4000"/);
    expect(html).toMatch(/<text\b[^>]*fill="url\(#tp-t-fill\)"/);
    expect(html).toMatch(/stop-color="#fff"/);
    expect(html).toMatch(/stop-color="#000"/);
  });

  it('repeating-radial-gradient 用 spreadMethod=repeat，并展开两位置色带', () => {
    const node = text(undefined);
    node.fill = ['repeating-radial-gradient(circle at center, red 0 10%, blue 10% 20%)'];
    const { html } = emitElementHtml(node, canvas);
    expect(html).toMatch(/<radialGradient id="tp-t-fill"[^>]*spreadMethod="repeat"/);
    const stops = html.match(/<stop\b[^>]*\/>/g) ?? [];
    expect(stops.length).toBe(4);
    expect(html).toMatch(/stop-color="red"/);
    expect(html).toMatch(/stop-color="blue"/);
  });

  it('repeating-linear 周期 ≥ 1 不再直接丢', () => {
    const node = text(undefined);
    node.fill = ['repeating-linear-gradient(red 0 60%, blue 60% 120%)'];
    const { html, notes } = emitElementHtml(node, canvas);
    expect(html).toMatch(/<linearGradient/);
    expect(html).toMatch(/stop-color="red"/);
    expect(html).toMatch(/stop-color="blue"/);
    expect(notes.some((n) => n.field === 'fill')).toBe(false);
  });

  it('linear 支持 rgba() 逗号、两位置色带', () => {
    const node = text(undefined);
    node.fill = ['linear-gradient(90deg, rgba(0,0,0,.5) 0 20%, #fff 100%)'];
    const { html } = emitElementHtml(node, canvas);
    expect(html).toMatch(/stop-color="rgba\(0,0,0,.5\)"/);
    const stops = html.match(/<stop\b[^>]*\/>/g) ?? [];
    expect(stops.length).toBe(3);
  });

  it('描边也支持渐变（stroke=url(#...)）', () => {
    const node = text({ paint: 'linear-gradient(90deg, #f00, #00f)', width: 2 });
    const { html } = emitElementHtml(node, canvas);
    expect(html).toMatch(/<linearGradient id="tp-t-stroke"/);
    expect(html).toMatch(/<text\b[^>]*stroke="url\(#tp-t-stroke\)"/);
  });

  it('radial 尺寸关键字按 bbox 归一化计算', () => {
    const a = text(undefined);
    a.fill = ['radial-gradient(farthest-corner at 50% 50%, #fff, #000)'];
    const ah = emitElementHtml(a, canvas).html;
    // 中心到角 = sqrt(.5²+.5²) ≈ .7071 → scale(1.4142)
    expect(ah).toMatch(/<radialGradient id="tp-t-fill"[^>]*gradientTransform=/);
    expect(ah).toMatch(/scale\(1\.4142/);

    const b = text(undefined);
    b.fill = ['radial-gradient(closest-side at 20% 30%, #fff, #000)'];
    const bh = emitElementHtml(b, canvas).html;
    // 最近边 = min(.2,.8,.3,.7) = .2 → scale(.4)
    expect(bh).toMatch(/scale\(0\.4000/);
  });

  it('曲线装饰线支持渐变', () => {
    const node = text({ paint: '#C8323C', width: 2 });
    node.runs[0] = {
      text: '描边字',
      strike: true,
      decoration: { color: 'linear-gradient(90deg, #f00, #00f)' },
    };
    const { html } = emitElementHtml(node, canvas);
    expect(html).toMatch(/<linearGradient id="tp-t-deco-0"/);
    expect(html).toMatch(/<path d="M[^"]*" [^>]*stroke="url\(#tp-t-deco-0\)"/);
  });

  it('形状描边支持渐变', () => {
    const shape: ShapeNode = {
      id: 's',
      type: 'shape',
      kind: 'rect',
      rect: { x: 0, y: 0, w: 100, h: 50 },
      fill: '#fff',
      stroke: { paint: 'linear-gradient(90deg, #f00, #00f)', width: 2 },
    };
    const { html } = emitElementHtml(shape, canvas);
    expect(html).toMatch(/<linearGradient id="grad-stroke-s"/);
    expect(html).toMatch(/stroke="url\(#grad-stroke-s\)"/);
  });
});
