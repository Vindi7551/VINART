/**
 * 画布网格：**纯视图配置**，不进 `doc.json`。
 *
 * 这里只放类型、计算和 localStorage 持久化；
 * 网格本身由 `GridOverlay` 画在 `.canvas-wrapper` 里，随 zoom 自动对齐。
 */

export type GridLineStyle = 'solid' | 'dashed' | 'dotted';

export interface GridConfig {
  enabled: boolean;
  columns: number;
  rows: number;
  /** 画布边到第一列 / 最后一列的距离（px） */
  margin: number;
  /** 相邻列 / 行之间的空隙（px） */
  gutter: number;
  color: string;
  opacity: number;
  /** 线宽：屏幕 px（`vector-effect` 下不随 zoom 变粗） */
  lineWidth: number;
  lineStyle: GridLineStyle;
}

export interface GridColumn {
  x: number;
  w: number;
}

export interface GridRow {
  y: number;
  h: number;
}

export interface ComputedGrid {
  columns: GridColumn[];
  rows: GridRow[];
  marginBox: { x: number; y: number; w: number; h: number } | null;
}

export const DEFAULT_GRID: GridConfig = {
  enabled: false,
  columns: 12,
  rows: 0,
  margin: 0,
  gutter: 0,
  color: '#6c5ce7',
  opacity: 0.14,
  lineWidth: 1,
  lineStyle: 'solid',
};

const KEY_PREFIX = 'vinart.grid.';

export function gridStorageKey(layout?: string | null): string {
  return KEY_PREFIX + (layout && layout.trim() ? layout : '__default__');
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 把任意来源（localStorage / 输入框）收敛成合法配置 */
export function normalizeGrid(raw: unknown): GridConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color)
    ? o.color
    : DEFAULT_GRID.color;
  const lineStyle: GridLineStyle =
    o.lineStyle === 'dashed' || o.lineStyle === 'dotted' || o.lineStyle === 'solid'
      ? o.lineStyle
      : DEFAULT_GRID.lineStyle;
  return {
    enabled: o.enabled === true,
    columns: clamp(Math.round(num(o.columns, DEFAULT_GRID.columns)), 0, 24),
    rows: clamp(Math.round(num(o.rows, DEFAULT_GRID.rows)), 0, 24),
    margin: clamp(Math.round(num(o.margin, DEFAULT_GRID.margin)), 0, 1000),
    gutter: clamp(Math.round(num(o.gutter, DEFAULT_GRID.gutter)), 0, 400),
    color,
    opacity: clamp(num(o.opacity, DEFAULT_GRID.opacity), 0, 1),
    lineWidth: clamp(Math.round(num(o.lineWidth, DEFAULT_GRID.lineWidth)), 1, 6),
    lineStyle,
  };
}

export function readGrid(layout?: string | null): GridConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_GRID };
  try {
    const raw = localStorage.getItem(gridStorageKey(layout));
    return raw ? normalizeGrid(JSON.parse(raw)) : { ...DEFAULT_GRID };
  } catch {
    return { ...DEFAULT_GRID };
  }
}

export function writeGrid(layout: string | null | undefined, cfg: GridConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(gridStorageKey(layout), JSON.stringify(normalizeGrid(cfg)));
  } catch {
    // 隐私模式 / quota 满：网格是视图状态，写不进去就算了
  }
}

/**
 * 计算网格线。
 *
 * 列：`contentW = W - 2*margin`，`colW = (contentW - (N-1)*gutter) / N`；
 * 行同理。宽度不够时返回空数组，不画负宽度的线。
 */
export function computeGrid(width: number, height: number, config: GridConfig): ComputedGrid {
  const cfg = normalizeGrid(config);
  const W = Math.max(0, width);
  const H = Math.max(0, height);
  const marginX = Math.min(cfg.margin, W / 2);
  const marginY = Math.min(cfg.margin, H / 2);
  const contentW = Math.max(0, W - marginX * 2);
  const contentH = Math.max(0, H - marginY * 2);

  const columns: GridColumn[] = [];
  if (cfg.columns > 0 && contentW > 0) {
    const colW = (contentW - (cfg.columns - 1) * cfg.gutter) / cfg.columns;
    if (colW > 0) {
      for (let i = 0; i < cfg.columns; i += 1) {
        columns.push({ x: marginX + i * (colW + cfg.gutter), w: colW });
      }
    }
  }

  const rows: GridRow[] = [];
  if (cfg.rows > 0 && contentH > 0) {
    const rowH = (contentH - (cfg.rows - 1) * cfg.gutter) / cfg.rows;
    if (rowH > 0) {
      for (let i = 0; i < cfg.rows; i += 1) {
        rows.push({ y: marginY + i * (rowH + cfg.gutter), h: rowH });
      }
    }
  }

  const marginBox =
    (marginX > 0 || marginY > 0) && (columns.length > 0 || rows.length > 0)
      ? { x: marginX, y: marginY, w: contentW, h: contentH }
      : null;

  return { columns, rows, marginBox };
}
