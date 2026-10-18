import { describe, expect, it } from 'vitest';
import { applyPatches } from '../src/designharness/tools/patch-doc';
import { semanticView } from '../src/designharness/tools/get-design';
import type { DesignDocument, ImageNode, ShapeNode, TextNode } from '../src/document/vocabulary';

const doc: DesignDocument = {
  canvas: { width: 100, height: 100 },
  layers: [
    {
      id: 'L1',
      name: '内容层',
      elements: [
        {
          id: 't1',
          type: 'text',
          name: '标题',
          frame: { x: 0.1, y: 0.1, w: 0.5 },
          runs: [{ text: 'hi' }],
          fill: '#000000',
          fontFamily: 'A',
          fontSizePx: 12,
        },
        {
          id: 's1',
          type: 'shape',
          kind: 'rect',
          name: '色块',
          rect: { x: 0.1, y: 0.5, w: 0.2, h: 0.2 },
          fill: '#eeeeee',
        },
        {
          id: 'i1',
          type: 'image',
          name: '主图',
          rect: { x: 0.5, y: 0.5, w: 0.4, h: 0.3 },
          asset: '@placeholder',
        },
      ],
    },
  ],
};

describe('applyPatches', () => {
  it('批量改颜色/字体（元素级）', () => {
    const r = applyPatches(doc, [
      { id: 't1', path: 'fill', value: '#111111' },
      { id: 't1', path: 'fontSizePx', value: 24 },
      { id: 's1', path: 'fill', value: '#6c5ce7' },
      { id: 's1', path: 'stroke.paint', value: '#ffffff' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(4);

    const t = r.doc.layers[0].elements[0] as TextNode;
    const s = r.doc.layers[0].elements[1] as ShapeNode;
    expect(t.fill).toBe('#111111');
    expect(t.fontSizePx).toBe(24);
    expect(s.fill).toBe('#6c5ce7');
    expect(s.stroke?.paint).toBe('#ffffff');

    // 原 doc 不被改
    expect((doc.layers[0].elements[0] as TextNode).fill).toBe('#000000');
  });

  it('白名单外的字段报错；整批由调用方决定不写', () => {
    const r = applyPatches(doc, [
      { id: 't1', path: 'fill', value: '#111111' },
      { id: 't1', path: 'opacity', value: 0.5 },
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('不在白名单');
  });

  it('节点不存在 / 值类型不对', () => {
    expect(applyPatches(doc, [{ id: 'nope', path: 'fill', value: '#111' }]).errors[0]).toContain('找不到节点');
    expect(applyPatches(doc, [{ id: 't1', path: 'fontSizePx', value: '24' }]).errors[0]).toContain('值类型不对');
  });

  it('asset 只改 image/svg', () => {
    const r = applyPatches(doc, [{ id: 'i1', path: 'asset', value: 'hero.png' }]);
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(1);
    expect((r.doc.layers[0].elements[2] as ImageNode).asset).toBe('hero.png');

    const bad = applyPatches(doc, [{ id: 't1', path: 'asset', value: 'x.png' }]);
    expect(bad.errors[0]).toContain('只有 image/svg');
  });
});

describe('semanticView', () => {
  it('包含图层名和当前 fill/font', () => {
    const v = semanticView(doc) as {
      layers: Array<{
        name: string;
        elements: Array<{ id: string; fill: unknown; fontFamily?: unknown; frame?: unknown }>;
      }>;
    };
    expect(v.layers[0].name).toBe('内容层');
    expect(v.layers[0].elements[0].id).toBe('t1');
    expect(v.layers[0].elements[0].fill).toBe('#000000');
    expect(v.layers[0].elements[0].fontFamily).toBe('A');
    expect(v.layers[0].elements[0].frame).toEqual({ x: 0.1, y: 0.1, w: 0.5 });
  });
});
