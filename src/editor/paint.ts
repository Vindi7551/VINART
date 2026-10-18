/**
 * **填充/描边/装饰线的“可编辑颜色”模型** —— 纯函数，UI 与测试共用。
 *
 * 词汇里的这些值是一个 CSS 字符串（`fill` 还可以是 string[] 多层）。
 * 这里把"纯色 / 线性渐变 / 径向渐变"解析成可编辑的草稿，再序列化回 CSS。
 * 解析不了的值（conic、图片、`in oklab` 等）保留 `raw`，编辑器走“原始 CSS”模式。
 *
 * ⚠️ 只做编辑器需要的子集，不追求覆盖全部 CSS 渐变语法；真正的渲染解析在 `emit.ts`。
 */
export type PaintType = 'solid' | 'linear' | 'radial';

export interface PaintStop {
  color: string;
  /** 0–100 */
  offset: number;
}

export interface PaintDraft {
  type: PaintType;
  solid: string;
  /** 线性渐变角度（deg） */
  angle: number;
  shape: 'circle' | 'ellipse';
  /**
   * radial 尺寸：`''`（默认 farthest-corner）/ `closest-side` / `closest-corner`
   * / `farthest-side` / `farthest-corner` / `custom`（用 rx/ry 百分比）
   */
  size: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  stops: PaintStop[];
  /** 解析失败时保留的原始字符串 */
  raw: string;
  parsed: boolean;
}

export const DEFAULT_STOPS: PaintStop[] = [
  { color: '#000000', offset: 0 },
  { color: '#ffffff', offset: 100 },
];

export function defaultPaintDraft(): PaintDraft {
  return {
    type: 'solid',
    solid: '#000000',
    angle: 180,
    shape: 'ellipse',
    size: '',
    cx: 50,
    cy: 50,
    rx: 50,
    ry: 50,
    stops: DEFAULT_STOPS.map((s) => ({ ...s })),
    raw: '',
    parsed: true,
  };
}

/** 顶层逗号切分（`rgb(0,0,0,.5)` 里的逗号不切） */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function gradientArgs(css: string): { kind: 'linear' | 'radial'; args: string } | null {
  const m = /^\s*(linear|radial)-gradient\s*\(/i.exec(css);
  if (!m) return null;
  const start = m[0].length;
  let depth = 1;
  let i = start;
  for (; i < css.length; i++) {
    if (css[i] === '(') depth++;
    else if (css[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;
  return { kind: m[1]!.toLowerCase() as 'linear' | 'radial', args: css.slice(start, i) };
}

const COLOR_TOKEN =
  /^(#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|transparent|currentColor|[a-zA-Z]+)/i;

interface ParsedColorStop {
  color: string;
  offsets: number[];
}

function parseColorStops(parts: string[]): ParsedColorStop[] {
  const out: ParsedColorStop[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    // 纯位置 = 颜色提示，编辑器不表示
    if (/^[\d.]+%$/.test(s)) continue;
    const m = COLOR_TOKEN.exec(s);
    if (!m) continue;
    const color = m[1]!;
    const rest = s.slice(color.length);
    const offsets: number[] = [];
    const re = /([\d.]+)(%)?/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(rest))) {
      const v = parseFloat(mm[1]!);
      if (!Number.isFinite(v)) continue;
      // `red 0 10%`：0 是无单位的零长度，算 0%；其它长度不换算
      if (mm[2] === '%' || v === 0) offsets.push(Math.max(0, Math.min(100, v)));
    }
    out.push({ color, offsets });
  }
  return out;
}

function normalizeStops(parsed: ParsedColorStop[]): PaintStop[] {
  const stops: PaintStop[] = [];
  for (const p of parsed) {
    if (p.offsets.length) for (const o of p.offsets) stops.push({ color: p.color, offset: o });
    else stops.push({ color: p.color, offset: -1 });
  }
  if (!stops.length) return DEFAULT_STOPS.map((s) => ({ ...s }));
  if (stops.every((s) => s.offset < 0)) {
    stops.forEach((s, i) => (s.offset = stops.length === 1 ? 0 : (i / (stops.length - 1)) * 100));
  } else {
    let prev = 0;
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i]!;
      if (s.offset < 0) s.offset = i === stops.length - 1 ? 100 : prev;
      s.offset = Math.max(prev, Math.min(100, s.offset));
      prev = s.offset;
    }
  }
  return stops;
}

function angleToDeg(raw: string): number | null {
  const m = /^(-?[\d.]+)(deg|grad|rad|turn)?$/i.exec(raw.trim());
  if (!m) return null;
  const v = parseFloat(m[1]!);
  const unit = (m[2] ?? 'deg').toLowerCase();
  if (unit === 'deg') return v;
  if (unit === 'grad') return v * 0.9;
  if (unit === 'rad') return (v * 180) / Math.PI;
  return v * 360;
}

function toDeg(head: string): number {
  const h = head.trim();
  if (/^to\s/i.test(h)) {
    const d = h.toLowerCase();
    return d.includes('right') && d.includes('top') ? 45
      : d.includes('right') && d.includes('bottom') ? 135
      : d.includes('left') && d.includes('bottom') ? 225
      : d.includes('left') && d.includes('top') ? 315
      : d.includes('right') ? 90
      : d.includes('left') ? 270
      : d.includes('top') ? 0
      : 180;
  }
  return angleToDeg(h) ?? 180;
}

function parsePosition(tokens: string[]): { x: number; y: number } {
  const val = (t: string): number | undefined => {
    const k = t.toLowerCase();
    if (k === 'left' || k === 'top') return 0;
    if (k === 'right' || k === 'bottom') return 100;
    if (k === 'center') return 50;
    return k.endsWith('%') ? parseFloat(k) : undefined;
  };
  const vals = tokens.map(val).filter((v): v is number => v !== undefined);
  if (vals.length >= 2) return { x: vals[0]!, y: vals[1]! };
  if (!vals.length) return { x: 50, y: 50 };
  const t0 = tokens[0]?.toLowerCase() ?? '';
  if (t0 === 'top' || t0 === 'bottom') return { x: 50, y: vals[0]! };
  return { x: vals[0]!, y: 50 };
}

const SIZE_KEYWORDS = new Set(['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner']);

function parseRadialPrelude(head: string): { shape: 'circle' | 'ellipse'; size: string; cx: number; cy: number; rx: number; ry: number } | null {
  const t = head.trim().toLowerCase();
  const at = t.indexOf('at');
  const before = (at >= 0 ? t.slice(0, at) : t).trim();
  const after = at >= 0 ? t.slice(at + 2).trim() : '';
  const bt = before.split(/\s+/).filter(Boolean);
  let shape: 'circle' | 'ellipse' = 'ellipse';
  let sizeTokens = bt;
  if (bt[0] === 'circle' || bt[0] === 'ellipse') {
    shape = bt[0] === 'circle' ? 'circle' : 'ellipse';
    sizeTokens = bt.slice(1);
  }
  const pos = parsePosition(after.split(/\s+/).filter(Boolean));
  const keyword = sizeTokens.find((x) => SIZE_KEYWORDS.has(x)) ?? '';
  const pct = sizeTokens.filter((x) => x.endsWith('%')).map((x) => parseFloat(x));
  let size = keyword;
  let rx = 50;
  let ry = 50;
  if (pct.length >= 2) {
    rx = pct[0]!;
    ry = pct[1]!;
    size = 'custom';
  } else if (pct.length === 1) {
    rx = ry = pct[0]!;
    size = 'custom';
  }
  return { shape, size, cx: pos.x, cy: pos.y, rx, ry };
}

/** 解析一个 paint 字符串；解析不了 ⇒ `parsed:false` + `raw`。 */
export function parsePaintCss(css: string | undefined | null): PaintDraft {
  const s = (css ?? '').trim();
  if (!s) return defaultPaintDraft();
  const g = gradientArgs(s);
  if (!g) {
    if (/gradient\(/i.test(s)) {
      // conic / repeating / 其它解析不了的渐变
      return { ...defaultPaintDraft(), raw: s, parsed: false };
    }
    return { ...defaultPaintDraft(), type: 'solid', solid: s };
  }
  const parts = splitTopLevel(g.args);
  if (!parts.length) return { ...defaultPaintDraft(), raw: s, parsed: false };
  const head = parts[0] ?? '';

  if (g.kind === 'linear') {
    const hasPrelude = /^(?:-?[\d.]+(?:deg|grad|rad|turn)|to\s)/i.test(head.trim());
    const colorStops = parseColorStops(parts.slice(hasPrelude ? 1 : 0));
    if (!colorStops.length) return { ...defaultPaintDraft(), raw: s, parsed: false };
    return {
      ...defaultPaintDraft(),
      type: 'linear',
      angle: hasPrelude ? toDeg(head) : 180,
      stops: normalizeStops(colorStops),
    };
  }

  const hasPrelude = /\bat\b/.test(head) || /^(circle|ellipse)\b/.test(head.trim()) || SIZE_KEYWORDS.has(head.trim()) || /^[\d.]+%/.test(head.trim());
  const prelude = hasPrelude ? parseRadialPrelude(head) : null;
  const colorStops = parseColorStops(parts.slice(hasPrelude ? 1 : 0));
  if (!colorStops.length) return { ...defaultPaintDraft(), raw: s, parsed: false };
  return {
    ...defaultPaintDraft(),
    type: 'radial',
    ...(prelude ?? {}),
    stops: normalizeStops(colorStops),
  };
}

/** 序列化回 CSS；解析失败的草稿原样返回 raw。 */
export function serializePaint(d: PaintDraft): string {
  if (!d.parsed) return d.raw || d.solid;
  if (d.type === 'solid') return d.solid;
  const stops = d.stops
    .map((s) => `${s.color} ${Math.max(0, Math.min(100, s.offset)).toFixed(0)}%`)
    .join(', ');
  if (d.type === 'linear') return `linear-gradient(${Math.round(d.angle)}deg, ${stops})`;
  let size = '';
  if (d.size === 'custom') {
    size = d.shape === 'ellipse' ? `${d.rx.toFixed(0)}% ${d.ry.toFixed(0)}%` : `${d.rx.toFixed(0)}%`;
  } else if (d.size) {
    size = d.size;
  }
  const head = `${d.shape}${size ? ' ' + size : ''} at ${d.cx.toFixed(0)}% ${d.cy.toFixed(0)}%`;
  return `radial-gradient(${head}, ${stops})`;
}
