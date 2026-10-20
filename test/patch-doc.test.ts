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
      { id: 't1', path: 'shadow', value: [] },
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

  it('text 改文字（保留节点/首 run 样式，允许空串）', () => {
    const r = applyPatches(doc, [{ id: 't1', path: 'text', value: '新的标题' }]);
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(1);
    const t = r.doc.layers[0].elements[0] as TextNode;
    expect(t.runs[0].text).toBe('新的标题');
    expect(t.fill).toBe('#000000');
    expect(t.fontSizePx).toBe(12);

    const empty = applyPatches(doc, [{ id: 't1', path: 'text', value: '' }]);
    expect(empty.errors).toEqual([]);
    expect((empty.doc.layers[0].elements[0] as TextNode).runs[0].text).toBe('');

    const bad = applyPatches(doc, [{ id: 's1', path: 'text', value: 'x' }]);
    expect(bad.errors[0]).toContain('只有 text');
  });
});

const geoDoc: DesignDocument = {
  canvas: { width: 1000, height: 500 },
  layers: [
    {
      id: 'G1',
      name: '几何层',
      elements: [
        {
          id: 't1',
          type: 'text',
          name: '标题',
          frame: { x: 100, y: 50, w: 400 },
          runs: [{ text: 'hi' }],
        },
        {
          id: 'i1',
          type: 'image',
          name: '主图',
          rect: { x: 200, y: 100, w: 100, h: 100 },
          asset: '@placeholder',
        },
        { id: 'g1', type: 'group', name: '组', elements: [] },
      ],
    },
  ],
};

describe('applyPatches · 几何', () => {
  it('move 用 0–1 比例换算：text 改 frame，image 改 rect', () => {
    const r = applyPatches(geoDoc, [
      { id: 't1', path: 'move', value: { dx: 0.1, dy: 0.2 } },
      { id: 'i1', path: 'move', value: { dx: -0.05, dy: 0.1 } },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(2);

    const t = r.doc.layers[0].elements[0] as TextNode;
    const i = r.doc.layers[0].elements[1] as ImageNode;
    // 非正方形画布：x 用宽、y 用高
    expect(t.frame).toEqual({ x: 200, y: 150, w: 400 });
    expect(i.rect).toEqual({ x: 150, y: 150, w: 100, h: 100 });
  });

  it('size：text 只接受 w；image 需要 w+h', () => {
    const ok = applyPatches(geoDoc, [
      { id: 't1', path: 'size', value: { w: 0.5 } },
      { id: 'i1', path: 'size', value: { w: 0.2, h: 0.4 } },
    ]);
    expect(ok.errors).toEqual([]);
    expect((ok.doc.layers[0].elements[0] as TextNode).frame.w).toBe(500);
    const i = ok.doc.layers[0].elements[1] as ImageNode;
    expect(i.rect.w).toBe(200);
    expect(i.rect.h).toBe(200);

    const bad = applyPatches(geoDoc, [{ id: 't1', path: 'size', value: { w: 0.5, h: 0.2 } }]);
    expect(bad.errors[0]).toContain('只接受 w');
  });

  it('rotate 仅 image/svg/shape；opacity 所有元素', () => {
    const r = applyPatches(geoDoc, [
      { id: 'i1', path: 'rotate', value: -6 },
      { id: 't1', path: 'opacity', value: 0.5 },
    ]);
    expect(r.errors).toEqual([]);
    expect((r.doc.layers[0].elements[1] as ImageNode).transform).toEqual({ rotate: -6 });
    expect((r.doc.layers[0].elements[0] as TextNode).opacity).toBe(0.5);

    const bad = applyPatches(geoDoc, [{ id: 't1', path: 'rotate', value: 5 }]);
    expect(bad.errors[0]).toContain('只对 image/svg/shape');
  });

  it('group 不支持 move', () => {
    const r = applyPatches(geoDoc, [{ id: 'g1', path: 'move', value: { dx: 0.1, dy: 0.1 } }]);
    expect(r.errors[0]).toContain('是 group');
  });
});

describe('semanticView', () => {
  it('包含图层名和当前 fill/font，以及 0–1 的 frame01', () => {
    const v = semanticView(doc) as {
      layers: Array<{
        name: string;
        elements: Array<{
          id: string;
          fill: unknown;
          fontFamily?: unknown;
          frame?: unknown;
          frame01?: unknown;
        }>;
      }>;
    };
    expect(v.layers[0].name).toBe('内容层');
    expect(v.layers[0].elements[0].id).toBe('t1');
    expect(v.layers[0].elements[0].fill).toBe('#000000');
    expect(v.layers[0].elements[0].fontFamily).toBe('A');
    expect(v.layers[0].elements[0].frame).toEqual({ x: 0.1, y: 0.1, w: 0.5 });
    expect(v.layers[0].elements[0].frame01).toEqual({ x: 0.001, y: 0.001, w: 0.005 });
  });
});
