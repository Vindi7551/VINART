/**
 * **词汇 → 编译器 逐字段覆盖对账** —— 清单 + 运行器（**单一真源**）
 *
 * 被两处消费：
 * - `test/vocab-coverage.test.ts`（vitest，正式断言）
 * - `scripts/_probe-vocab-coverage.mjs`（node 直跑，打印报告）
 *
 * ⚠️ 本文件**只允许 type-import** —— 这样 Node 24 的原生类型剥离能直接跑它
 * （esbuild 在本机沙箱里 `spawn EPERM`，所以走这条不依赖打包器的路）。
 *
 * ## 三种状态
 *
 * | 状态 | 判据 | 含义 |
 * |---|---|---|
 * | **落地** | 产物里出现对应的 CSS / XML 属性 | 编译器真的表达出来了 |
 * | **已报** | 进了 `unsupported` | 翻不出，但**没装作支持**（设计允许） |
 * | **静默丢弃** | 既没产出、也没报 | ⚠️ 缺陷：写了字段，画面上什么都没有，还不告诉人 |
 *
 * `emit.ts` 自己立的规矩是「**绝不静默丢弃**」⇒ 第 3 类即该规矩的违例。
 */

import type { DesignDocument, ElementNode, Layer } from '../src/document/vocabulary.ts';
// ⚠️ 带 `.ts` 扩展名：这样 `node --import ./scripts/_ts-resolve.mjs` 能直接跑本文件
//    （正式代码 import 时**不要**写扩展名 —— 项目惯例是打包器风格）。
import { emitDocument } from '../src/render/vocabulary/emit.ts';
import { fitTargets } from '../src/render/vocabulary/fit.ts';

// ══════════════════════════════════════════════════════════════════════
// 字段清单
// ══════════════════════════════════════════════════════════════════════

export type Case = {
  field: string;
  /** 造一个只带这一个字段（+ 必要骨架）的元素（图层由 `wrapInLayer` 在外面包上） */
  node: ElementNode;
  /** 期望在产物里出现的串（全部命中才算"落地"） */
  want: string[];
  /** 排除串：命中了说明这个产出是别的字段带来的（防假绿） */
  not?: string[];
};

const R = { x: 90, y: 60, w: 360, h: 180 };
/** ⭐ 文字的框：**没有高度**（高度是排版结果 ✗ 见 `TextFrame`）*/
const F = { x: R.x, y: R.y, w: R.w };

/** 画布 901×601 —— 故意用非整数，`Math.round` 的口径也一起验了 */
const CANVAS = { width: 901, height: 601, background: '#010203' };

const ASSETS: Record<string, string> = {
  'a.png': 'DATA:a.png',
  'i.svg': 'DATA:i.svg',
  'leaf.png': 'DATA:leaf.png',
  'mm.png': 'DATA:mm.png',
};

/**
 * ⚠️ **画布的孩子一律是图层**，而本文件的用例给的是**单个元素**
 * （`{ type: 'shape', kind: 'rect', … }` 这种）⇒ 送进 `emitDocument()` 之前包一层图层。
 *
 * ⚠️ 图层**永远和画布一样大** ⇒ 里面的元素仍然是**画布坐标**
 * —— 所以用例的数值与断言**一个字都不用改**，几何一个换算都不做。
 *
 * ⚠️ 用**手写的裸图层**而不是 `vocabulary.ts` 的 `wrapIntoLayers()`：后者会把
 * **顶层的组直接升格成图层**（见它的规则 1），而本文件有一组用例正是要测
 * `group` 元素自己（`group.transform` / `data-layer-type="group"` …）——
 * 升格之后那些断言测的就不是组了。
 */
function wrapInLayer(node: ElementNode, id = 'L'): Layer {
  return { id, elements: [node] };
}

export const CASES: Case[] = [
  // ── 画布 ──────────────────────────────────────────────────────────
  { field: 'canvas.width/height', node: { id: 'x', type: 'shape', kind: 'rect', rect: R }, want: ['width:901px'] },
  { field: 'canvas.background', node: { id: 'x', type: 'shape', kind: 'rect', rect: R }, want: ['background:#010203'] },

  // ── ElementBase（所有元素共有）─────────────────────────────────────
  { field: 'id', node: { id: 'uniq-id-7391', type: 'shape', kind: 'rect', rect: R }, want: ['data-layer="uniq-id-7391"'] },
  {
    field: 'rect',
    node: { id: 'x', type: 'shape', kind: 'rect', rect: { x: 99, y: 132, w: 297, h: 264 } },
    want: ['left:99px', 'top:132px', 'width:297px', 'height:264px'],
  },
  { field: 'opacity', node: { id: 'x', type: 'shape', kind: 'rect', rect: R, opacity: 0.4321 }, want: ['opacity:0.4321'] },
  { field: 'blend', node: { id: 'x', type: 'shape', kind: 'rect', rect: R, blend: 'color-dodge' }, want: ['mix-blend-mode:color-dodge'] },
  { field: 'backdrop', node: { id: 'x', type: 'shape', kind: 'rect', rect: R, backdrop: 'blur(13px)' }, want: ['backdrop-filter:blur(13px)'] },
  { field: 'filter', node: { id: 'x', type: 'shape', kind: 'rect', rect: R, filter: 'contrast(1.77)' }, want: ['contrast(1.77)'] },
  { field: 'clip', node: { id: 'x', type: 'shape', kind: 'rect', rect: R, clip: 'circle(47%)' }, want: ['clip-path:circle(47%)'] },
  {
    field: 'mask',
    node: { id: 'x', type: 'shape', kind: 'rect', rect: R, mask: 'linear-gradient(to bottom, #000, transparent)' },
    want: ['mask-image:linear-gradient(to bottom, #000, transparent)'],
  },
  {
    field: 'radius（单值 · shape rect）',
    // 短边 = 0.3 × 601 = 180.3 → round(0.25 × 180.3) = 45 ⇒ rx="45"
    node: { id: 'x', type: 'shape', kind: 'rect', rect: R, radius: 0.25 },
    want: ['rx="45"'],
  },
  {
    field: 'radius（四角 · shape rect）',
    // ⚠️ 四个角不同 ⇒ 该出四个值；这里**故意写死单值断言**，看它是不是被悄悄丢了
    node: { id: 'x', type: 'shape', kind: 'rect', rect: R, radius: [0.1, 0.2, 0.3, 0.4] },
    want: ['rx="18" ry="36"'],
  },
  {
    field: 'radius（四角 · image）',
    // image 是 div，走 `border-radius`（这条能承载四角）
    node: { id: 'x', type: 'image', rect: R, asset: 'a.png', radius: [0.1, 0.2, 0.3, 0.4] },
    want: ['border-radius:18px 36px 54px 72px'],
  },
  { field: 'transform.rotate', node: { id: 'x', type: 'shape', kind: 'rect', rect: R, transform: { rotate: -12.5 } }, want: ['rotate(-12.5deg)'] },
  {
    field: 'transform.origin',
    node: { id: 'x', type: 'shape', kind: 'rect', rect: R, transform: { rotate: 5, origin: { x: 0.23, y: 0.67 } } },
    want: ['transform-origin:23.000% 67.000%'],
  },

  // ── 文字（元素级）─────────────────────────────────────────────────
  { field: 'text.runs', node: { id: 'x', type: 'text', frame: F, runs: [{ text: '甲' }, { text: '乙' }] }, want: ['data-run="0"', 'data-run="1"'] },
  { field: 'text.fontFamily', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], fontFamily: 'Fam-A' }, want: ['font-family:Fam-A'] },
  { field: 'text.fontScale', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], fontSizePx: 69 }, want: ['font-size:69px'] },
  { field: 'text.weight', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], weight: 733 }, want: ['font-weight:733'] },
  { field: 'text.italic', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], italic: true }, want: ['font-style:italic'] },
  { field: 'text.stretch', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], stretch: 0.87 }, want: ['font-stretch:87%'] },
  { field: 'text.features', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], features: ['liga'] }, want: ['font-feature-settings:"liga" 1'] },
  { field: 'text.variations', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], variations: { wght: 427 } }, want: ['font-variation-settings:"wght" 427'] },
  { field: 'text.textTransform', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], textTransform: 'uppercase' }, want: ['text-transform:uppercase'] },
  { field: 'text.smallCaps', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], smallCaps: true }, want: ['font-variant-caps:small-caps'] },
  { field: 'text.underline', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], underline: true }, want: ['text-decoration-line:underline'] },
  { field: 'text.strike', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], strike: true }, want: ['text-decoration-line:line-through'] },
  {
    field: 'text.decoration',
    node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], underline: true, decoration: { color: '#123456', style: 'wavy', thickness: 7 } },
    want: ['text-decoration-color:#123456', 'text-decoration-style:wavy', 'text-decoration-thickness:7px'],
  },
  { field: 'text.letterSpacing', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], letterSpacing: 0.044 }, want: ['letter-spacing:0.044em'] },
  { field: 'text.wordSpacing', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], wordSpacing: 0.055 }, want: ['word-spacing:0.055em'] },
  { field: 'text.lineHeight', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], lineHeight: 1.77 }, want: ['line-height:1.77'] },
  { field: 'text.align', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], align: 'justify' }, want: ['text-align:justify'] },
  { field: 'text.alignLast', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], alignLast: 'center' }, want: ['text-align-last:center'] },
  { field: 'text.baselineShift', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], baselineShift: 0.31 }, want: ['vertical-align:0.31em'] },
  { field: 'text.dropCap', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], dropCap: 3 }, want: ['initial-letter:3'] },
  { field: 'text.writingMode', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], writingMode: 'vertical' }, want: ['writing-mode:vertical-rl'] },
  { field: 'text.direction', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], direction: 'rtl' }, want: ['direction:rtl'] },
  { field: 'text.wrap', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], wrap: 'normal' }, want: ['white-space:normal'] },
  { field: 'text.curve', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], curve: 0.25 }, want: ['<textPath', 'Q0.5,0.5'] },
  { field: 'text.path', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], path: 'M0,1 Q0.5,-0.3 1,1' }, want: ['d="M0,1 Q0.5,-0.3 1,1"'] },

  // ── 文字片段（TextRun）────────────────────────────────────────────
  { field: 'run.fill（纯色）', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', fill: '#abcdef' }] }, want: ['color:#abcdef'] },
  {
    field: 'run.fill（渐变）',
    node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', fill: 'linear-gradient(90deg,#f00,#00f)' }] },
    want: ['background-clip:text', 'linear-gradient(90deg,#f00,#00f)'],
  },
  { field: 'run.fontFamily', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', fontFamily: 'RunFam' }] }, want: ['font-family:RunFam'] },
  { field: 'run.fontScale', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', fontSizePx: 81 }] }, want: ['font-size:81px'] },
  { field: 'run.weight', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', weight: 311 }] }, want: ['font-weight:311'] },
  { field: 'run.italic', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', italic: true }] }, want: ['font-style:italic'] },
  { field: 'run.stretch', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', stretch: 0.66 }] }, want: ['font-stretch:66%'] },
  { field: 'run.underline', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', underline: true }] }, want: ['text-decoration-line:underline'] },
  { field: 'run.strike', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', strike: true }] }, want: ['text-decoration-line:line-through'] },
  { field: 'run.decoration', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', underline: true, decoration: { color: '#654321' } }] }, want: ['text-decoration-color:#654321'] },
  { field: 'run.letterSpacing', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', letterSpacing: 0.066 }] }, want: ['letter-spacing:0.066em'] },
  { field: 'run.wordSpacing', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', wordSpacing: 0.077 }] }, want: ['word-spacing:0.077em'] },
  { field: 'run.baselineShift', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', baselineShift: 0.44 }] }, want: ['vertical-align:0.44em'] },
  { field: 'run.textTransform', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', textTransform: 'lowercase' }] }, want: ['text-transform:lowercase'] },
  { field: 'run.smallCaps', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', smallCaps: true }] }, want: ['font-variant-caps:small-caps'] },
  { field: 'run.features', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', features: ['smcp'] }] }, want: ['font-feature-settings:"smcp" 1'] },
  { field: 'run.variations', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a', variations: { wdth: 88 } }] }, want: ['font-variation-settings:"wdth" 88'] },

  // ── 文字填充 / 描边（元素级）──────────────────────────────────────
  { field: 'text.fill（纯色）', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], fill: '#0f0f0f' }, want: ['color:#0f0f0f'] },
  { field: 'text.fill（渐变）', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], fill: 'linear-gradient(#111,#222)' }, want: ['background-clip:text'] },
  { field: 'text.stroke', node: { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], stroke: { paint: '#ff0000', width: 5 } }, want: ['-webkit-text-stroke:5px #ff0000'] },

  // ── image ─────────────────────────────────────────────────────────
  { field: 'image.asset', node: { id: 'x', type: 'image', rect: R, asset: 'a.png' }, want: ['src="DATA:a.png"'] },
  { field: 'image.fit', node: { id: 'x', type: 'image', rect: R, asset: 'a.png', fit: 'contain' }, want: ['object-fit:contain'] },
  { field: 'image.position', node: { id: 'x', type: 'image', rect: R, asset: 'a.png', position: { x: 0.13, y: 0.87 } }, want: ['object-position:13.0% 87.0%'] },
  { field: 'image.render', node: { id: 'x', type: 'image', rect: R, asset: 'a.png', render: 'pixelated' }, want: ['image-rendering:pixelated'] },
  { field: 'image.stroke', node: { id: 'x', type: 'image', rect: R, asset: 'a.png', stroke: { paint: '#00ff00', width: 6 } }, want: ['outline:6px solid #00ff00'] },
  {
    field: 'image.shadow',
    node: { id: 'x', type: 'image', rect: R, asset: 'a.png', shadow: [{ offset: { x: 0.02, y: 0.03 }, blur: 0.04, spread: 0.05, color: '#010203' }] },
    want: ['box-shadow:'],
  },

  // ── svg ───────────────────────────────────────────────────────────
  { field: 'svg.asset', node: { id: 'x', type: 'svg', rect: R, asset: 'i.svg' }, want: ['src="DATA:i.svg"'] },

  // ── shape 几何 ────────────────────────────────────────────────────
  { field: 'shape.kind=rect', node: { id: 'x', type: 'shape', kind: 'rect', rect: R }, want: ['<rect x="0" y="0"'] },
  { field: 'shape.kind=rect + radius', node: { id: 'x', type: 'shape', kind: 'rect', rect: R, radius: 0.3 }, want: ['rx="'] },
  { field: 'shape.kind=ellipse', node: { id: 'x', type: 'shape', kind: 'ellipse', rect: R }, want: ['<ellipse cx='] },
  { field: 'shape.kind=polygon', node: { id: 'x', type: 'shape', kind: 'polygon', rect: R, points: [[0, 0], [1, 0], [0.5, 1]] }, want: ['<polygon points='] },
  { field: 'shape.kind=path', node: { id: 'x', type: 'shape', kind: 'path', rect: R, d: 'M0,0 L1,1 L0,1 Z' }, want: ['d="M0,0 L1,1 L0,1 Z"'] },
  { field: 'shape.fill（纯色）', node: { id: 'x', type: 'shape', kind: 'rect', rect: R, fill: '#a1b2c3' }, want: ['fill="#a1b2c3"'] },
  {
    field: 'shape.fill（线性渐变）',
    node: { id: 'x', type: 'shape', kind: 'rect', rect: R, fill: 'linear-gradient(115deg, #b8722f, #2f6b8a)' },
    want: ['<linearGradient', 'fill="url(#grad-x)"'],
  },
  { field: 'shape.fill（图案）', node: { id: 'x', type: 'shape', kind: 'rect', rect: R, fill: 'url(leaf.png)' }, want: ['<pattern', 'fill="url(#pat-x)"'] },
  {
    field: 'shape.stroke（全套）',
    node: {
      id: 'x', type: 'shape', kind: 'rect', rect: R,
      stroke: { paint: '#0a0b0c', width: 3, dash: [4, 2], cap: 'round', join: 'bevel', over: true },
    },
    want: ['stroke="#0a0b0c"', 'stroke-width="3"', 'stroke-dasharray="4 2"', 'stroke-linecap="round"', 'stroke-linejoin="bevel"', 'paint-order="stroke fill"'],
  },
  { field: 'shape.shadow（外投影）', node: { id: 'x', type: 'shape', kind: 'rect', rect: R, shadow: [{ offset: { x: 0.02, y: 0.02 }, blur: 0.03, color: '#040506' }] }, want: ['drop-shadow('] },
  { field: 'shape.shadow（内阴影）', node: { id: 'x', type: 'shape', kind: 'rect', rect: R, shadow: [{ inset: true, blur: 0.03, color: '#040506' }] }, want: ['<filter id="insetsh-'] },
  {
    field: 'shape.shadow.follow=outline',
    node: { id: 'x', type: 'shape', kind: 'path', rect: R, d: 'M0,0 L1,0 L1,1 Z', shadow: [{ follow: 'outline', color: '#040506' }] },
    want: ['drop-shadow('],
  },
  { field: 'shape.filter', node: { id: 'x', type: 'shape', kind: 'rect', rect: R, filter: 'brightness(1.33)' }, want: ['brightness(1.33)'] },

  // ── group ─────────────────────────────────────────────────────────
  {
    field: 'group.elements',
    node: { id: 'g1', type: 'group', elements: [{ id: 'kid', type: 'shape', kind: 'rect', rect: R, fill: '#0c0d0e' }] },
    want: ['data-layer-type="group"', 'data-layer="kid"'],
  },
  { field: 'group.transform', node: { id: 'g2', type: 'group', transform: { rotate: 33 }, elements: [{ id: 'kid', type: 'shape', kind: 'rect', rect: R }] }, want: ['rotate(33deg)'] },
  { field: 'group.opacity', node: { id: 'g3', type: 'group', opacity: 0.3123, elements: [{ id: 'kid', type: 'shape', kind: 'rect', rect: R }] }, want: ['opacity:0.3123'] },
  { field: 'group.blend', node: { id: 'g4', type: 'group', blend: 'exclusion', elements: [{ id: 'kid', type: 'shape', kind: 'rect', rect: R }] }, want: ['mix-blend-mode:exclusion'] },
  { field: 'group.clip', node: { id: 'g5', type: 'group', clip: 'inset(3%)', elements: [{ id: 'kid', type: 'shape', kind: 'rect', rect: R }] }, want: ['clip-path:inset(3%)'] },
  // ⚠️ `mask` 里的 `url(名字)` 是**素材名**，必须过 `assets` 映射 ⇒ 产物里是**映射后的 URL**。
  //    这条断言曾经写的是 `mask-image:url(mm.png)`（**原样名字**）—— 那等于**替 bug 背书**：
  //    原样名字进 CSS ⇒ 浏览器拿它当相对路径 ⇒ 404，而当时测试是绿的。
  { field: 'group.mask', node: { id: 'g6', type: 'group', mask: 'url(mm.png)', elements: [{ id: 'kid', type: 'shape', kind: 'rect', rect: R }] }, want: ['mask-image:url("DATA:mm.png")'] },
  { field: 'group.filter', node: { id: 'g7', type: 'group', filter: 'sepia(0.44)', elements: [{ id: 'kid', type: 'shape', kind: 'rect', rect: R }] }, want: ['sepia(0.44)'] },
  { field: 'group.backdrop', node: { id: 'g8', type: 'group', backdrop: 'blur(21px)', elements: [{ id: 'kid', type: 'shape', kind: 'rect', rect: R }] }, want: ['backdrop-filter:blur(21px)'] },
];

// ══════════════════════════════════════════════════════════════════════
// 运行器
// ══════════════════════════════════════════════════════════════════════

export type CoverageState = '落地' | '已报' | '静默丢弃';

export type CoverageRow = { field: string; state: CoverageState; detail: string };

export function runCoverage(): CoverageRow[] {
  const rows: CoverageRow[] = [];
  for (const c of CASES) {
    const doc: DesignDocument = { canvas: { ...CANVAS }, layers: [wrapInLayer(c.node)] };
    const res = emitDocument(doc, { assets: ASSETS });
    const missing = c.want.filter((w) => !res.html.includes(w));
    const excluded = (c.not ?? []).filter((w) => res.html.includes(w));
    const reported = res.unsupported.length > 0;

    if (!missing.length && !excluded.length) {
      rows.push({ field: c.field, state: '落地', detail: c.want.join(' + ') });
    } else if (reported) {
      rows.push({ field: c.field, state: '已报', detail: res.unsupported.map((u) => `${u.field}: ${u.reason}`).join(' | ') });
    } else {
      rows.push({
        field: c.field,
        state: '静默丢弃',
        detail: `缺 ${missing.join(' + ') || '（无）'}${excluded.length ? ` / 不该有却出现 ${excluded.join(' + ')}` : ''}`,
      });
    }
  }
  return rows;
}

/** 把三分清单排成一份可读报告 */
export function formatReport(rows: CoverageRow[]): string {
  const pick = (s: CoverageState) => rows.filter((r) => r.state === s);
  const silent = pick('静默丢弃');
  const reported = pick('已报');
  return (
    `\n═══ 词汇 → 编译器 逐字段覆盖 ═══\n` +
    `合计 ${rows.length} · 落地 ${pick('落地').length} · 已报 ${reported.length} · 静默丢弃 ${silent.length}\n\n` +
    `【静默丢弃 —— 字段写了，产物里没有，也没报错】\n` +
    (silent.map((r) => `  ${r.field}  ⟵  ${r.detail}`).join('\n') || '  （无）') +
    `\n\n【已报 —— 翻不出，但明确说了】\n` +
    (reported.map((r) => `  ${r.field}  ⟵  ${r.detail}`).join('\n') || '  （无）') +
    '\n'
  );
}

// ══════════════════════════════════════════════════════════════════════
// 附带检查：**同一个 `Stroke` 字段，在不同元素类型上的落点**
// ══════════════════════════════════════════════════════════════════════

/**
 * 词表对 `Stroke` 是"**同一句话，三种落地**"（shape=SVG stroke / text=文字描边 /
 * image=outline）：一个 `Stroke` 接口，三种实现。
 *
 * ⇒ 风险在内：**某些字段只在某一种落点上说得通**，换一种就无声无息。
 * 这里逐字段 × 逐类型铺开，看它是"落地 / 已报 / 静默丢"。
 */
type StrokeProbe = { field: string; value: unknown; marker: string };

const STROKE_PROBES: StrokeProbe[] = [
  { field: 'paint', value: '#0b0c0d', marker: '#0b0c0d' },
  { field: 'width', value: 3, marker: '3' },
  { field: 'width（四边不同）', value: [1, 2, 3, 4], marker: '1px 2px 3px 4px' },
  { field: 'inset', value: true, marker: '-3px' },
  { field: 'dash', value: [4, 2], marker: '4' },
  { field: 'cap', value: 'round', marker: 'round' },
  { field: 'join', value: 'bevel', marker: 'bevel' },
  { field: 'over', value: true, marker: 'stroke fill' },
];

/** 三种落点各给一个元素（骨架相同，只换 type） */
function strokeNodeFor(kind: 'shape' | 'text' | 'image', stroke: Record<string, unknown>): ElementNode {
  if (kind === 'shape') return { id: 'x', type: 'shape', kind: 'rect', rect: R, stroke } as ElementNode;
  if (kind === 'text') return { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], stroke } as ElementNode;
  return { id: 'x', type: 'image', rect: R, asset: 'a.png', stroke } as ElementNode;
}

export type StrokeRow = { field: string; kind: string; state: CoverageState; detail: string };

export function runStrokeMatrix(): StrokeRow[] {
  const rows: StrokeRow[] = [];
  for (const kind of ['shape', 'text', 'image'] as const) {
    for (const p of STROKE_PROBES) {
      // 每一项都带一个 baseline `width`：没有它就出不来描边，测不出"这一项有没有生效"
      const stroke: Record<string, unknown> = { width: 3 };
      if (p.field === 'width' || p.field === 'width（四边不同）') stroke.width = p.value;
      else stroke[p.field] = p.value;

      const doc: DesignDocument = { canvas: { ...CANVAS }, layers: [wrapInLayer(strokeNodeFor(kind, stroke))] };
      const res = emitDocument(doc, { assets: ASSETS });
      const has = res.html.includes(p.marker);
      // ⚠️ `unsupported` 和 `notes` **都算"报了"** —— 前者是"翻不出"，后者是"这么算的"。
      //    两者都让用户看得见，所以都不算静默丢弃。
      const said = [...res.unsupported, ...res.notes].filter((u) => u.field.startsWith('stroke'));
      if (has) rows.push({ field: p.field, kind, state: '落地', detail: `产物里有 ${p.marker}` });
      else if (said.length)
        rows.push({
          field: p.field,
          kind,
          state: '已报',
          detail: said.map((u) => u.reason).join(' | '),
        });
      else rows.push({ field: p.field, kind, state: '静默丢弃', detail: '产物里没有，也没报' });
    }
  }
  return rows;
}

// ══════════════════════════════════════════════════════════════════════
// 附带检查：**元素级效果字段**在各类型上的落地 + 三条读代码推断的机检
// ══════════════════════════════════════════════════════════════════════

export type VisualRow = { field: string; kind: string; state: CoverageState; detail: string };

/** 元素级效果字段（`VisualBase` / `ElementBase` 上的那几条），值给得能一眼认出来 */
const EFFECTS: Array<{ field: string; value: Record<string, unknown>; marker: RegExp }> = [
  { field: 'opacity', value: { opacity: 0.4321 }, marker: /opacity:0\.4321/ },
  { field: 'blend', value: { blend: 'color-dodge' }, marker: /mix-blend-mode:color-dodge/ },
  { field: 'filter', value: { filter: 'contrast(1.77)' }, marker: /contrast\(1\.77\)/ },
  { field: 'backdrop', value: { backdrop: 'blur(13px)' }, marker: /backdrop-filter:blur\(13px\)/ },
  { field: 'clip', value: { clip: 'circle(47%)' }, marker: /clip-path:circle\(47%\)/ },
  // ⚠️ 与 CASES 里 `group.mask` 同理：断言**映射后**的 URL，不是原样名字
  { field: 'mask', value: { mask: 'url(mm.png)' }, marker: /mask-image:url\("DATA:mm\.png"\)/ },
  { field: 'transform.rotate', value: { transform: { rotate: -12.5 } }, marker: /rotate\(-12\.5deg\)/ },
];

/** 元素级 `fill`（不是 TextRun 的）在四类节点上各自怎么落 */
const FILLS: Array<{ field: string; value: Record<string, unknown>; marker: RegExp }> = [
  { field: 'fill（纯色）', value: { fill: '#a1b2c3' }, marker: /#a1b2c3/ },
  { field: 'fill（线性渐变）', value: { fill: 'linear-gradient(115deg, #b1222f, #2f6b8a)' }, marker: /#b1222f/ },
  { field: 'fill（多层）', value: { fill: ['#111111', '#222222'] }, marker: /#111111/ },
  { field: 'fill（图案 url）', value: { fill: 'url(leaf.png)' }, marker: /leaf\.png|pat-/ },
];

function nodeFor(kind: 'shape' | 'text' | 'image' | 'svg', extra: Record<string, unknown>): ElementNode {
  if (kind === 'shape') return { id: 'x', type: 'shape', kind: 'rect', rect: R, ...extra } as ElementNode;
  if (kind === 'text') return { id: 'x', type: 'text', frame: F, runs: [{ text: 'a' }], ...extra } as ElementNode;
  if (kind === 'image') return { id: 'x', type: 'image', rect: R, asset: 'a.png', ...extra } as ElementNode;
  return { id: 'x', type: 'svg', rect: R, asset: 'i.svg', ...extra } as ElementNode;
}

export function runVisualMatrix(): { effects: VisualRow[]; fills: VisualRow[] } {
  const effects: VisualRow[] = [];
  const fills: VisualRow[] = [];
  const kinds = ['shape', 'text', 'image', 'svg'] as const;

  for (const kind of kinds) {
    for (const e of EFFECTS) {
      const res = emitDocument({ canvas: { ...CANVAS }, layers: [wrapInLayer(nodeFor(kind, e.value))] }, { assets: ASSETS });
      const said = [...res.unsupported, ...res.notes];
      effects.push(
        e.marker.test(res.html)
          ? { field: e.field, kind, state: '落地', detail: '' }
          : said.length
            ? { field: e.field, kind, state: '已报', detail: said.map((u) => `${u.field}: ${u.reason}`).join(' | ') }
            : { field: e.field, kind, state: '静默丢弃', detail: '产物里没有，也没报' },
      );
    }
    for (const f of FILLS) {
      const res = emitDocument({ canvas: { ...CANVAS }, layers: [wrapInLayer(nodeFor(kind, f.value))] }, { assets: ASSETS });
      const said = [...res.unsupported, ...res.notes];
      // ⚠️ 判据顺序要紧：**先看它有没有报**。
      //    不能只看"HTML 里有没有这个 token" —— `svg.fill` 会把原值写进
      //    `style="background:#a1b2c3"` 而同时报 unsupported，光看 token 会**假绿**。
      if (f.marker.test(res.html) && !res.unsupported.length) {
        fills.push({ field: f.field, kind, state: '落地', detail: '' });
      } else if (said.length) {
        fills.push({ field: f.field, kind, state: '已报', detail: said.map((u) => `${u.field}: ${u.reason}`).join(' | ') });
      } else {
        fills.push({ field: f.field, kind, state: '静默丢弃', detail: '产物里没有，也没报' });
      }
    }
  }
  return { effects, fills };
}

/**
 * 三条**读代码推断出来的**问题，这里机检坐实（不是肉眼读转录）。
 *
 * 1. **文字渐变填色的半透明上游会露底**：`fillClip` 给内层写了
 *    `background-clip:text` + `color:transparent`，但**没有盖住内层自己的背景** ——
 *    `background-image` 会铺满内层的整个盒（`background-clip` 只裁"画到哪"，
 *    不裁"底色铺在哪"）。上游有半透明图层时，那层实色会从字形之间透出来。
 * 2. **多层 fill 数组只喂一个节点时**：`fills` 里只剩一个元素 ⇒ "多层"这件事看不出来，
 *    得看两层颜色是不是**都**出现在同一份产物里。
 */
export function runSemanticChecks(): Array<{ name: string; ok: boolean; detail: string }> {
  const out: Array<{ name: string; ok: boolean; detail: string }> = [];

  // ① 文字渐变填色：内层有没有把"自己的背景"关掉
  {
    const res = emitDocument(
      { canvas: { ...CANVAS }, layers: [wrapInLayer({ id: 't', type: 'text', frame: F, runs: [{ text: 'a' }], fill: 'linear-gradient(#111,#222)' })] },
      {},
    );
    // 内层那个 div 的 style 里，`background-clip:text` 必须配一个"不铺满盒"的兜底
    const inner = /data-fit="t" style="([^"]*)"/.exec(res.html)?.[1] ?? '';
    const hasClip = inner.includes('background-clip:text');
    const guards = /background-color:\s*transparent|background-size|background-repeat|background-position/.test(inner);
    out.push({
      name: '文字渐变填色：内层盒的底色被关掉 / 收紧（不然上游半透明会从字缝里透出来）',
      ok: hasClip && guards,
      detail: hasClip
        ? guards
          ? '已收紧'
          : `内层 style 里只有 background-clip:text，没有任何"别铺满整盒"的兜底 ⇒ 原样输出：${inner.slice(0, 160)}`
        : '（没出 background-clip:text，检查前提不成立）',
    });
  }

  // ② 多层 fill：两层颜色是不是都在产物里
  {
    const res = emitDocument(
      {
        canvas: { ...CANVAS },
        layers: [wrapInLayer({ id: 's', type: 'shape', kind: 'rect', rect: R, fill: ['#aabbcc', '#ddeeff'] })],
      },
      {},
    );
    const both = res.html.includes('#aabbcc') && res.html.includes('#ddeeff');
    out.push({
      name: 'shape 多层 fill：两层都画出来（不是只留最上/全丢）',
      ok: both,
      detail: both ? '两层都在' : `产物里 #aabbcc=${res.html.includes('#aabbcc')} #ddeeff=${res.html.includes('#ddeeff')}；notes=${JSON.stringify(res.notes.map((n) => n.field))}`,
    });
  }

  // ③ shape 的四角圆角：四个值有没有都落下去
  {
    const res = emitDocument(
      { canvas: { ...CANVAS }, layers: [wrapInLayer({ id: 's', type: 'shape', kind: 'rect', rect: R, radius: [0.1, 0.2, 0.3, 0.4] })] },
      {},
    );
    const corners = (res.html.match(/rx="|ry="/g) ?? []).length;
    out.push({
      name: 'shape 四角圆角：四个角的值都落地',
      ok: corners >= 4,
      detail: `产物里 rx/ry 属性共 ${corners} 个（四个角至少要 4 个才表达得出来）`,
    });
  }

  return out;
}

// ══════════════════════════════════════════════════════════════════════
// 附带检查：**组内文字会不会被漏出「实测装填」这一环**
// ══════════════════════════════════════════════════════════════════════

/**
 * `fit.ts` 的 `fitTargets` 决定"哪些文字要拿去浏览器里量宽度"。
 *
 * ⚠️ 这里守的是「**只看一层**」那个坑：画布的孩子是**图层**，图层里才是**元素**，
 * 而文字还能待在**组里**（甚至套多层组）。
 * ⇒ 少走一层，那些文字就不在名单里，永远拿不到装填系数，**长文字会冲出框而且没人知道**。
 *
 * 这里把结论算出来（不抛错），给报告用。
 */
export function nestedTextFitGap(): { nested: string[]; listed: string[]; missing: string[] } {
  const doc: DesignDocument = {
    canvas: { width: 900, height: 600 },
    layers: [
      // 一个图层里装：一个**直接躺在图层里**的文字 + 一个组（组里还套了一层组）
      {
        id: 'L',
        elements: [
          { id: 'top-text', type: 'text', frame: { x: 45, y: 30, w: 360 }, runs: [{ text: '顶层' }] },
          {
            id: 'grp',
            type: 'group',
            opacity: 0.9,
            elements: [
              { id: 'in-group-text', type: 'text', frame: { x: 90, y: 240, w: 360 }, runs: [{ text: '组内' }] },
              {
                id: 'inner-grp',
                type: 'group',
                elements: [{ id: 'deep-text', type: 'text', frame: { x: 90, y: 361, w: 360 }, runs: [{ text: '深层' }] }],
              },
            ],
          },
        ],
      },
    ],
  };
  const nested = ['in-group-text', 'deep-text'];
  const listed = fitTargets(doc);
  return { nested, listed, missing: nested.filter((id) => !listed.includes(id)) };
}

