import { describe, expect, it } from 'vitest';

import { parsePaintCss, serializePaint } from '../src/editor/paint';

describe('颜色 / 渐变编辑器：解析 + 序列化', () => {
  it('纯色', () => {
    const d = parsePaintCss('#C8323C');
    expect(d.type).toBe('solid');
    expect(d.solid).toBe('#C8323C');
    expect(serializePaint(d)).toBe('#C8323C');
  });

  it('linear：rgba 顶层逗号 + 两位置色带', () => {
    const d = parsePaintCss('linear-gradient(90deg, rgba(0,0,0,.5) 0 20%, #fff 100%)');
    expect(d.type).toBe('linear');
    expect(d.angle).toBe(90);
    expect(d.stops.map((s) => [s.color, s.offset])).toEqual([
      ['rgba(0,0,0,.5)', 0],
      ['rgba(0,0,0,.5)', 20],
      ['#fff', 100],
    ]);
    expect(serializePaint(d)).toContain('linear-gradient(90deg');
  });

  it('radial：circle at 位置', () => {
    const d = parsePaintCss('radial-gradient(circle at 30% 40%, #fff, #000)');
    expect(d.type).toBe('radial');
    expect(d.shape).toBe('circle');
    expect(d.cx).toBe(30);
    expect(d.cy).toBe(40);
    expect(d.stops).toHaveLength(2);
    expect(serializePaint(d)).toBe('radial-gradient(circle at 30% 40%, #fff 0%, #000 100%)');
  });

  it('radial：尺寸关键字', () => {
    const d = parsePaintCss('radial-gradient(farthest-corner at 50% 50%, #fff, #000)');
    expect(d.type).toBe('radial');
    expect(d.size).toBe('farthest-corner');
    expect(serializePaint(d)).toContain('ellipse farthest-corner at 50% 50%');
  });

  it('radial：自定义椭圆半径', () => {
    const d = parsePaintCss('radial-gradient(ellipse 50% 30% at 20% 80%, #fff, #000)');
    expect(d.type).toBe('radial');
    expect(d.size).toBe('custom');
    expect([d.rx, d.ry]).toEqual([50, 30]);
    expect(serializePaint(d)).toContain('ellipse 50% 30% at 20% 80%');
  });

  it('conic / 解析不了的值保留原始 CSS', () => {
    const d = parsePaintCss('conic-gradient(from 90deg, #f00, #0f0)');
    expect(d.parsed).toBe(false);
    expect(d.raw).toBe('conic-gradient(from 90deg, #f00, #0f0)');
    expect(serializePaint(d)).toBe(d.raw);
  });

  it('空值给默认纯色', () => {
    const d = parsePaintCss('');
    expect(d.type).toBe('solid');
    expect(d.parsed).toBe(true);
  });
});
