import { describe, expect, it } from 'vitest';
import { computeGrid, DEFAULT_GRID, normalizeGrid, type GridConfig } from '../src/ui/grid';

const cfg = (patch: Partial<GridConfig> = {}): GridConfig => ({
  ...DEFAULT_GRID,
  enabled: true,
  ...patch,
});

describe('computeGrid', () => {
  it('12 等分列：margin=0 gutter=0', () => {
    const g = computeGrid(1200, 800, cfg({ columns: 12, rows: 0 }));
    expect(g.columns).toHaveLength(12);
    expect(g.columns[0]).toEqual({ x: 0, w: 100 });
    expect(g.columns[11]).toEqual({ x: 1100, w: 100 });
    expect(g.rows).toHaveLength(0);
    expect(g.marginBox).toBeNull();
  });

  it('margin 与 gutter 同时生效', () => {
    const g = computeGrid(1000, 1000, cfg({ columns: 3, rows: 3, margin: 100, gutter: 20 }));
    // 可用 800；3 列 + 2 gutter => 单列 (800-40)/3
    const w = (800 - 40) / 3;
    expect(g.columns[0].x).toBeCloseTo(100);
    expect(g.columns[1].x).toBeCloseTo(100 + w + 20);
    expect(g.columns[2].x).toBeCloseTo(100 + (w + 20) * 2);
    expect(g.columns[0].w).toBeCloseTo(w);

    expect(g.rows).toHaveLength(3);
    expect(g.rows[0].y).toBeCloseTo(100);
    expect(g.rows[0].h).toBeCloseTo(w);

    expect(g.marginBox).toEqual({ x: 100, y: 100, w: 800, h: 800 });
  });

  it('只画列 / 只画行都可以', () => {
    const cols = computeGrid(600, 400, cfg({ columns: 6, rows: 0 }));
    expect(cols.columns).toHaveLength(6);
    expect(cols.rows).toHaveLength(0);

    const rows = computeGrid(600, 400, cfg({ columns: 0, rows: 4 }));
    expect(rows.columns).toHaveLength(0);
    expect(rows.rows).toHaveLength(4);
  });

  it('数量为 0 时不画', () => {
    const g = computeGrid(600, 400, cfg({ columns: 0, rows: 0 }));
    expect(g.columns).toEqual([]);
    expect(g.rows).toEqual([]);
    expect(g.marginBox).toBeNull();
  });

  it('宽度不够时返回空列，不产生负宽', () => {
    const g = computeGrid(100, 400, cfg({ columns: 12, rows: 0, gutter: 20 }));
    expect(g.columns).toEqual([]);
  });

  it('单列 = 整个内容区', () => {
    const g = computeGrid(1000, 800, cfg({ columns: 1, rows: 0, margin: 50 }));
    expect(g.columns).toEqual([{ x: 50, w: 900 }]);
  });
});

describe('normalizeGrid', () => {
  it('钳制数量和透明度，非法颜色回默认', () => {
    const g = normalizeGrid({
      enabled: true,
      columns: 999,
      rows: -3,
      margin: -10,
      gutter: 99999,
      opacity: 9,
      color: 'red',
      lineWidth: 99,
      lineStyle: 'wavy',
    });
    expect(g.columns).toBe(24);
    expect(g.rows).toBe(0);
    expect(g.margin).toBe(0);
    expect(g.gutter).toBe(400);
    expect(g.opacity).toBe(1);
    expect(g.color).toBe(DEFAULT_GRID.color);
    expect(g.lineWidth).toBe(6);
    expect(g.lineStyle).toBe('solid');
  });

  it('非对象输入回默认', () => {
    expect(normalizeGrid(null)).toEqual(DEFAULT_GRID);
  });

  it('保留合法线型与线宽', () => {
    const g = normalizeGrid({ lineStyle: 'dotted', lineWidth: 3 });
    expect(g.lineStyle).toBe('dotted');
    expect(g.lineWidth).toBe(3);
  });
});
