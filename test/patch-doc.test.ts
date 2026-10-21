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
      { id: 't1', path: 'no-such-field', value: [] },
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

describe('applyPatches · 视觉字段', () => {
  it('元素级外观：radius / shadow / blend / filter / backdrop / clip / mask', () => {
    const r = applyPatches(doc, [
      { id: 's1', path: 'radius', value: 0.04 },
      {
        id: 's1',
        path: 'shadow',
        value: [{ offset: { x: 0, y: 0.02 }, blur: 0.03, color: '#00000033' }],
      },
      { id: 's1', path: 'blend', value: 'multiply' },
      { id: 's1', path: 'filter', value: 'blur(4px)' },
      { id: 's1', path: 'backdrop', value: 'blur(12px)' },
      { id: 's1', path: 'clip', value: 'circle(50%)' },
      { id: 's1', path: 'mask', value: 'linear-gradient(to bottom, #000, transparent)' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(7);
    const s = r.doc.layers[0].elements[1] as ShapeNode;
    expect(s.radius).toBe(0.04);
    expect(s.shadow?.[0]?.color).toBe('#00000033');
    expect(s.blend).toBe('multiply');
    expect(s.filter).toBe('blur(4px)');
    expect(s.backdrop).toBe('blur(12px)');
    expect(s.clip).toBe('circle(50%)');
    expect(s.mask).toBe('linear-gradient(to bottom, #000, transparent)');

    // normal 不留冗余字段
    const normal = applyPatches(r.doc, [{ id: 's1', path: 'blend', value: 'normal' }]);
    expect((normal.doc.layers[0].elements[1] as ShapeNode).blend).toBeUndefined();
  });

  it('描边：width / dash / inset / cap / join / over', () => {
    const r = applyPatches(doc, [
      { id: 's1', path: 'stroke.width', value: 2 },
      { id: 's1', path: 'stroke.dash', value: [4, 2] },
      { id: 's1', path: 'stroke.inset', value: true },
      { id: 's1', path: 'stroke.cap', value: 'round' },
      { id: 's1', path: 'stroke.join', value: 'round' },
      { id: 's1', path: 'stroke.over', value: true },
    ]);
    expect(r.errors).toEqual([]);
    const s = r.doc.layers[0].elements[1] as ShapeNode;
    expect(s.stroke).toEqual({ width: 2, dash: [4, 2], inset: true, cap: 'round', join: 'round', over: true });
  });

  it('图片：fit / position / render', () => {
    const r = applyPatches(doc, [
      { id: 'i1', path: 'fit', value: 'contain' },
      { id: 'i1', path: 'position', value: { x: 0.2, y: 0.8 } },
      { id: 'i1', path: 'render', value: 'pixelated' },
    ]);
    expect(r.errors).toEqual([]);
    const i = r.doc.layers[0].elements[2] as ImageNode;
    expect(i.fit).toBe('contain');
    expect(i.position).toEqual({ x: 0.2, y: 0.8 });
    expect(i.render).toBe('pixelated');

    expect(applyPatches(doc, [{ id: 't1', path: 'fit', value: 'contain' }]).errors[0]).toContain('只有 image');
  });

  it('文字：对齐 / 字距 / 拉伸 / OpenType / 装饰 / 方向 / 沿路径', () => {
    const r = applyPatches(doc, [
      { id: 't1', path: 'align', value: 'center' },
      { id: 't1', path: 'alignLast', value: 'right' },
      { id: 't1', path: 'wordSpacing', value: 0.1 },
      { id: 't1', path: 'stretch', value: 1.1 },
      { id: 't1', path: 'features', value: ['liga', 'smcp'] },
      { id: 't1', path: 'variations', value: { wght: 450 } },
      { id: 't1', path: 'textTransform', value: 'uppercase' },
      { id: 't1', path: 'smallCaps', value: true },
      { id: 't1', path: 'underline', value: true },
      { id: 't1', path: 'strike', value: true },
      { id: 't1', path: 'decoration', value: { style: 'wavy', color: '#ff0000' } },
      { id: 't1', path: 'baselineShift', value: 2 },
      { id: 't1', path: 'dropCap', value: 3 },
      { id: 't1', path: 'writingMode', value: 'vertical' },
      { id: 't1', path: 'direction', value: 'rtl' },
      { id: 't1', path: 'curve', value: 0.1 },
      { id: 't1', path: 'path', value: 'M0,0.8 Q0.5,-0.2 1,0.8' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(17);
    const t = r.doc.layers[0].elements[0] as TextNode;
    expect(t.align).toBe('center');
    expect(t.alignLast).toBe('right');
    expect(t.wordSpacing).toBe(0.1);
    expect(t.stretch).toBe(1.1);
    expect(t.features).toEqual(['liga', 'smcp']);
    expect(t.variations).toEqual({ wght: 450 });
    expect(t.textTransform).toBe('uppercase');
    expect(t.smallCaps).toBe(true);
    expect(t.underline).toBe(true);
    expect(t.strike).toBe(true);
    expect(t.decoration).toEqual({ style: 'wavy', color: '#ff0000' });
    expect(t.baselineShift).toBe(2);
    expect(t.dropCap).toBe(3);
    expect(t.writingMode).toBe('vertical');
    expect(t.direction).toBe('rtl');
    expect(t.curve).toBe(0.1);
    expect(t.path).toBe('M0,0.8 Q0.5,-0.2 1,0.8');

    // 空路径 = 移除字段
    const removed = applyPatches(r.doc, [{ id: 't1', path: 'path', value: '' }]);
    expect((removed.doc.layers[0].elements[0] as TextNode).path).toBeUndefined();
  });

  it('runs 整段替换：同一段多色 / 多字号', () => {
    const value = [
      { text: '限时', fill: '#ff0000', weight: 900 },
      { text: '特惠', fill: '#111111', fontSizePx: 18 },
      { text: ' 三天', italic: true },
    ];
    const r = applyPatches(doc, [{ id: 't1', path: 'runs', value }]);
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(1);
    const t = r.doc.layers[0].elements[0] as TextNode;
    expect(t.runs).toEqual(value);
  });

  it('runs：至少一段；未知字段 / 缺 text / 类型错用都报错', () => {
    expect(applyPatches(doc, [{ id: 't1', path: 'runs', value: [] }]).errors[0]).toContain('值类型不对');
    expect(
      applyPatches(doc, [{ id: 't1', path: 'runs', value: [{ text: 'x', bogus: 1 }] }]).errors[0],
    ).toContain('值类型不对');
    expect(
      applyPatches(doc, [{ id: 't1', path: 'runs', value: [{ fill: '#f00' }] }]).errors[0],
    ).toContain('值类型不对');
    expect(
      applyPatches(doc, [{ id: 's1', path: 'runs', value: [{ text: 'x' }] }]).errors[0],
    ).toContain('只有 text');
  });

  it('name：写入与清空', () => {
    const r = applyPatches(doc, [{ id: 's1', path: 'name', value: '新色块' }]);
    expect((r.doc.layers[0].elements[1] as ShapeNode).name).toBe('新色块');
    const cleared = applyPatches(r.doc, [{ id: 's1', path: 'name', value: '  ' }]);
    expect((cleared.doc.layers[0].elements[1] as ShapeNode).name).toBeUndefined();
  });

  it('非法值 / 用错节点类型都报错', () => {
    expect(applyPatches(doc, [{ id: 's1', path: 'radius', value: -0.1 }]).errors[0]).toContain('值类型不对');
    expect(applyPatches(doc, [{ id: 's1', path: 'shadow', value: 'x' }]).errors[0]).toContain('值类型不对');
    expect(applyPatches(doc, [{ id: 's1', path: 'blend', value: 'bogus' }]).errors[0]).toContain('值类型不对');
    expect(applyPatches(doc, [{ id: 'i1', path: 'fit', value: 'bogus' }]).errors[0]).toContain('值类型不对');
    expect(applyPatches(doc, [{ id: 's1', path: 'align', value: 'center' }]).errors[0]).toContain('只有 text');
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

  it('skewX / skewY / origin / scale 合并进 transform', () => {
    const r = applyPatches(geoDoc, [
      { id: 'i1', path: 'skewX', value: 8 },
      { id: 'i1', path: 'skewY', value: -4 },
      { id: 'i1', path: 'origin', value: { x: 0, y: 0.5 } },
      { id: 'i1', path: 'scale', value: { x: 1.1, y: 0.9 } },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(4);
    expect((r.doc.layers[0].elements[1] as ImageNode).transform).toEqual({
      skewX: 8,
      skewY: -4,
      origin: { x: 0, y: 0.5 },
      scale: { x: 1.1, y: 0.9 },
    });

    // 文字不允许 transform
    expect(applyPatches(geoDoc, [{ id: 't1', path: 'skewX', value: 8 }]).errors[0]).toContain(
      '只对 image/svg/shape',
    );
    expect(applyPatches(geoDoc, [{ id: 't1', path: 'scale', value: { x: 1.1, y: 1 } }]).errors[0]).toContain(
      '只对 image/svg/shape',
    );
    // scale 零值 / origin 越界
    expect(applyPatches(geoDoc, [{ id: 'i1', path: 'scale', value: { x: 0, y: 1 } }]).errors[0]).toContain(
      '值类型不对',
    );
    expect(
      applyPatches(geoDoc, [{ id: 'i1', path: 'origin', value: { x: 1.2, y: 0.5 } }]).errors[0],
    ).toContain('值类型不对');
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
