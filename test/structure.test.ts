import { describe, expect, it } from 'vitest';
import { applyStructure } from '../src/document/structure';
import type { DesignDocument, TextNode } from '../src/document/vocabulary';

function title(id: string, x = 0, text = '旧标题'): TextNode {
  return {
    id,
    type: 'text',
    name: 'title',
    frame: { x, y: 0, w: 50 },
    fontSizePx: 10,
    fill: '#111111',
    runs: [{ text }],
  };
}

function doc(): DesignDocument {
  return {
    canvas: { width: 100, height: 100, background: '#ffffff' },
    layers: [
      { id: 'layer-1', name: '文字', elements: [title('el-1-1')] },
      { id: 'layer-2', name: '图形', elements: [] },
    ],
  };
}

describe('applyStructure', () => {
  it('add-elements：生成 id、插入顺序、0–1 转 px', () => {
    const r = applyStructure(doc(), [
      {
        op: 'add-elements',
        layer: 'layer-1',
        index: 0,
        elements: [
          { type: 'text', name: 'eyebrow', rect: { x: 0.1, y: 0.2, w: 0.5 }, fontScale: 0.1, placeholder: '新' },
          { type: 'shape', kind: 'rect', name: 'rule', rect: { x: 0.1, y: 0.5, w: 0.3, h: 0.01 } },
        ],
      },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(1);
    expect(r.added.map((a) => a.id)).toEqual(['el-1-2', 'el-1-3']);

    const text = r.doc.layers[0]!.elements[0] as TextNode;
    expect(text.frame).toEqual({ x: 10, y: 20, w: 50 });
    expect(text.fontSizePx).toBe(10);
    expect(text.runs[0]!.text).toBe('新');
    expect(r.doc.layers[0]!.elements.map((e) => e.id)).toEqual(['el-1-2', 'el-1-3', 'el-1-1']);
  });

  it('add-layer：默认最上层；带 elements 时 id 与层号一致', () => {
    const r = applyStructure(doc(), [
      {
        op: 'add-layer',
        name: '背景',
        elements: [{ type: 'shape', kind: 'ellipse', name: 'circle', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
      },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.doc.layers.map((l) => l.id)).toEqual(['layer-1', 'layer-2', 'layer-3']);
    expect(r.added[0]).toMatchObject({ id: 'layer-3', type: 'layer' });
    expect(r.doc.layers[2]!.elements[0]!.id).toBe('el-3-1');
  });

  it('remove-elements：按 id 删掉元素', () => {
    const r = applyStructure(doc(), [{ op: 'remove-elements', ids: ['el-1-1'] }]);
    expect(r.errors).toEqual([]);
    expect(r.doc.layers[0]!.elements).toEqual([]);
    expect(r.removed).toEqual([{ id: 'el-1-1', type: 'text', name: 'title' }]);
  });

  it('remove-layer：非空层必须 force，空层可直接删', () => {
    const noForce = applyStructure(doc(), [{ op: 'remove-layer', ids: ['layer-1'] }]);
    expect(noForce.errors.join('')).toContain('force');
    expect(noForce.doc.layers).toHaveLength(2);

    const forced = applyStructure(doc(), [{ op: 'remove-layer', ids: ['layer-1'], force: true }]);
    expect(forced.errors).toEqual([]);
    expect(forced.doc.layers.map((l) => l.id)).toEqual(['layer-2']);

    const empty = applyStructure(doc(), [{ op: 'remove-layer', ids: ['layer-2'] }]);
    expect(empty.errors).toEqual([]);
    expect(empty.doc.layers.map((l) => l.id)).toEqual(['layer-1']);
  });

  it('move-elements：跨层移动并保持 id', () => {
    const r = applyStructure(doc(), [
      { op: 'move-elements', ids: ['el-1-1'], toLayer: 'layer-2', index: 0 },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.doc.layers[0]!.elements).toEqual([]);
    expect(r.doc.layers[1]!.elements.map((e) => e.id)).toEqual(['el-1-1']);
  });

  it('reorder-layers：必须是完整排列', () => {
    const bad = applyStructure(doc(), [{ op: 'reorder-layers', order: ['layer-1'] }]);
    expect(bad.errors.join('')).toContain('全部图层');

    const good = applyStructure(doc(), [{ op: 'reorder-layers', order: ['layer-2', 'layer-1'] }]);
    expect(good.errors).toEqual([]);
    expect(good.doc.layers.map((l) => l.id)).toEqual(['layer-2', 'layer-1']);
  });

  it('任何一条非法就返回 errors，调用方不应写盘', () => {
    const r = applyStructure(doc(), [
      { op: 'add-elements', layer: 'missing', elements: [{ type: 'text', name: 'x', rect: { x: 0, y: 0, w: 0.2 } }] },
    ]);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.applied).toBe(0);
  });
});
