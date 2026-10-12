/**
 * RenderStyle —— 渲染参数（配色与排版）
 *
 * 版式契约只声明"用哪一套"（`StyleRefs` 写引用名），**具体值在这里**。
 *
 * 📖 完整说明见同目录 `README.md`。
 *
 * ⚠️ 权威定义**不在本文件**：
 *   · 配色 → `designassets/elements/palette/<名>.json`
 *   · 排版 → `designassets/fonts/schemes/<名>.json`
 * 下面的常量只是兜底默认值，存在的唯一理由是让渲染器不依赖文件系统。
 * **改配色/字体请改那些 JSON，不要改这里。**
 */

/** 字体栈。整体兜底用，具体族由排版方案给出 */
export const FONT_SERIF = `Rockwell, "Roboto Slab", "Bookman Old Style", Georgia, serif`;
export const FONT_SANS = `"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif`;

/** 配色方案。ink 必有（渲染兜底色），其余角色任意（resolveColor 查表） */
export interface Palette {
  ink: string;
  [role: string]: string;
}

/**
 * 默认配色的兜底值。**权威定义在 `designassets/elements/palette/warm-copper.json`**——
 * 驱动脚本会读那份 JSON 并通过 `renderDesign(spec, { palette })` 注入。
 * 保留这份是为了让渲染器不依赖文件系统。改配色请改 JSON，不要改这里。
 */
export const PALETTE: Palette = {
  ink: '#120C07',
  copper: '#B8722F',
  copperLight: '#D9A05B',
  amber: '#E8A24A',
  cream: '#F2E8DA',
  white: '#FFFFFF',
};

/**
 * 排版方案（注入渲染器）。
 *
 * 字体是**参数**不是常量——多个家族并存于 `designassets/fonts/families/`，
 * 由命名方案（`designassets/fonts/schemes/*.json`）挑选组合，版式规格再引用方案名。
 * 与 `palette` 同一套做法。
 *
 * `faceCss` 由驱动脚本生成（把 woff2 内联成 data URL），
 * 这样渲染器本身不依赖文件系统。
 */
export interface Typography {
  /** @font-face 声明（含内联 data URL） */
  faceCss: string;
  /** 方案名，写进溯源注释 */
  schemeName: string;
  headingFamily: string;
  headingWeight: number;
  headingLetterSpacing: string;
  bodyFamily: string;
  bodyWeight: number;
  bodyLetterSpacing: string;
}

/** 未指定方案时的兜底排版（系统衬线、700 字重） */
export const DEFAULT_TYPOGRAPHY: Typography = {
  faceCss: '',
  schemeName: 'default',
  headingFamily: FONT_SERIF,
  headingWeight: 700,
  headingLetterSpacing: '.02em',
  bodyFamily: FONT_SERIF,
  bodyWeight: 700,
  bodyLetterSpacing: '.02em',
};
