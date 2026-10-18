import { describe, expect, it } from 'vitest';

import { emitElementHtml } from '../src/render/vocabulary/emit';
import type { TextNode } from '../src/document/vocabulary';

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

  it('渐变描边退回 currentColor 并报 note', () => {
    const { html, notes } = emitElementHtml(
      text({ paint: 'linear-gradient(#C8323C, #B8722F)', width: [2, 2, 2, 2] }),
      canvas,
    );
    expect(html).toMatch(/<text\b[^>]*\bstroke="currentColor"/);
    expect(notes.some((n) => n.field === 'stroke.paint')).toBe(true);
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
});
