/**
 * 词汇渲染器 —— 把 `DesignDocument`（词汇表）变成一段**自包含 HTML**。
 *
 * ## 它只做一件事
 *
 * `DesignDocument` → `string`。**纯函数 · 零模型调用 · 不读文件系统** ——
 * 字体与素材由调用方以**值**注入（`faceCss` / `assets`），本文件不碰盘。
 *
 * ## ⚠️ 「绝不静默丢弃」
 *
 * 凡是词汇里有、这一版翻不出来的东西，一律进 `unsupported` 列表，
 * **带节点 id 和字段名报出来**，不装作支持。
 * ⇒ 这正是"**词汇 → HTML 哪里说不清，当场暴露**"的用意，
 *    而不是等写完几百上千行才发现。
 *
 * ⚠️ 现状：还有几处违例（shape 的四角圆角、`stroke.dash` 用在 text/image 上），
 *    复现见 `test/vocab-coverage.test.ts`。
 */

import type {
  Canvas,
  DesignDocument,
  GroupNode,
  /** ⚠️ 名字带 Node 后缀：`Element` 会和 DOM 全局的 `Element` 撞名 */
  ElementNode,
  /** 元素与图层**共用**的那组效果字段（`visualCss` 收它，两边都能传） */
  VisualBase,
  ImageNode,
  Layer,
  Rect,
  Shadow,
  ShapeNode,
  Stroke,
  SvgNode,
  TextNode,
  TextRun,
  Transform,
} from '../../document/vocabulary';

// ⚠️ **兜底字号住在文档模型里**（见 `vocabulary.ts` 的"文字"小节开头）——
//    它是渲染器与翻译器的**共同契约**：渲染器拿它当兜底，翻译器拿它报给模型。
//    这里 import 进来用，并**原样再导出**（历史的 `from 'render/vocabulary/emit'` 继续有效）。
import { DEFAULT_FONT_PX } from '../../document/vocabulary';
export { DEFAULT_FONT_PX };

// ══════════════════════════════════════════════════════════════════════
// 选项 / 产出
// ══════════════════════════════════════════════════════════════════════

export interface EmitOptions {
  /** `@font-face` 声明（**含内联 data URL**）。空 = 用系统字体兜底 */
  faceCss?: string;
  /**
   * 素材名 → 可直接放进 `src` 的东西（URL / data URL）。
   * 缺哪个，哪个就进 `unsupported`（**报错，不是画个空框糊过去**）。
   */
  assets?: Record<string, string>;
  /**
   * 每个节点的**装填系数**（≤1）：文字装不进框时，字号乘它缩下来。
   * 缺省 = 1（不缩）。
   *
   * ⚠️ **系数从外面传进来** —— 因为"装不装得下"**必须在浏览器里实测**
   * （`scrollWidth > clientWidth`），而本文件是纯函数、不碰浏览器。
   * 实测那一环在 `fit.ts` 的 `emitFitted`。
   */
  fits?: Record<string, number>;
}

/** 一条「词汇里有、这一版翻不出」的记录 */
export interface EmitIssue {
  /** 哪个节点（画布级问题用 `'<canvas>'`） */
  id: string;
  /** 哪个字段（如 `'runs[1].fill'` / `'stroke.cap'` / `'type'`） */
  field: string;
  reason: string;
}

export interface EmitResult {
  html: string;
  /** **空数组 = 这份文档被完整翻译了**。非空 = 有东西被丢下了，别当没看见 */
  unsupported: EmitIssue[];
  /** 只是提醒（有损但没有丢语义），例如"这个单位是猜的" */
  notes: EmitIssue[];
}

// ══════════════════════════════════════════════════════════════════════
// 小工具
// ══════════════════════════════════════════════════════════════════════

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** 内联样式串：`['a:1','b:2']` → `'a:1;b:2'`（空串会被丢掉） */
function css(parts: Array<string | '' | undefined | null | false>): string {
  return parts.filter(Boolean).join(';');
}

function joinCss(parts: Array<string | '' | undefined | null | false>): string {
  const s = css(parts);
  return s ? s + ';' : '';
}

/** 该填色是不是"纯色"（能当 CSS `color` 用）—— 渐变 / 图案不算 */
function isPlainColor(v: string): boolean {
  return !/gradient\(|url\(/i.test(v);
}

// ══════════════════════════════════════════════════════════════════════
// 几何 → CSS
// ══════════════════════════════════════════════════════════════════════

/**
 * 画布 local px 里的盒子。**导出给编辑器用** —— 实时拖动时要按同一套算法改 transform。
 */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * **位置尺寸 → px 盒子**。
 *
 * ⚠️ `rect` **就是画布 px**（见 `vocabulary.ts` 的 `Rect`）⇒ 这里**一个换算都不做**，
 *    **也不取整** —— 文档里是多少，产物里就写多少。
 *
 * ⚠️ **取整不是这一层的事**：一个坐标最终落在哪个**设备像素**上，由**出图那一步**决定
 *    （blink 按 `deviceScaleFactor` 把 CSS px 换成设备像素，见 `blink-renderer.ts`）。
 *    在这里抢先取整只会白亏：形状的轮廓在 `<svg>` 里、坐标 4 位小数，**照样是亚像素**；
 *    而"编辑器里看到的框"和"产物里真正的框"却会差最多半个像素。
 *    ⇒ 真要边缘锐，就去对齐**真正被画出来的那串坐标**，不是在容器上取整。
 *
 * ⚠️ 唯一保留的动作：宽高夹到非负。负宽会让 CSS **静默不渲染**（整块消失，一个字都不报）。
 */
function boxOf(rect: Rect): Box {
  return {
    left: rect.x,
    top: rect.y,
    width: Math.max(0, rect.w),
    height: Math.max(0, rect.h),
  };
}

const boxCss = (b: Box) => `left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px`;

/**
 * 一个**能写进 CSS 的数**；不是（`undefined` / `NaN` / 字符串）⇒ `null`。
 *
 * ⚠️ 为什么非要有这道关：**坏值的后果比"字段没实现"更糟。** 一条声明里只要有一个
 *    非法值，浏览器丢掉的是**整条声明** —— `scale(undefined,2)` 会把同一行好好的
 *    `rotate` 一起带走（实测，而且当时 `unsupported` 是空的，一声不响）。
 */
const finiteOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * `transform` 里**哪些字段是坏值**（`undefined` = 没写，不算坏）—— 调用方拿去报出来。
 *
 * 见 `finiteOrNull` 上面那段：坏值会让**整条** `transform` 失效。
 */
export function badTransformFields(t: Transform | undefined): string[] {
  if (!t) return [];
  const bad: string[] = [];
  if (t.rotate !== undefined && finiteOrNull(t.rotate) === null) bad.push('transform.rotate');
  if (t.skewX !== undefined && finiteOrNull(t.skewX) === null) bad.push('transform.skewX');
  if (t.skewY !== undefined && finiteOrNull(t.skewY) === null) bad.push('transform.skewY');
  if (t.scale && (finiteOrNull(t.scale.x) === null || finiteOrNull(t.scale.y) === null)) {
    bad.push('transform.scale');
  }
  return bad;
}

/**
 * `transform` 里的**变换函数串**（不含 `transform-origin`）—— 空数组 = 不变换。
 *
 * ⚠️ **逐字转写、零换算**：`rotate` / `skewX` / `skewY` 在词汇里**就是度**，符号也和 CSS 一致
 *    （y 轴朝下 ⇒ `rotate` 顺时针为正、`skewX` 正角度 = 底边向右顶边向左）。
 *    这里**不做任何数学** —— 斜切曾经存"比例"、要 `atan(r × 宽 ÷ 高)` 换算成角度，
 *    改成度之后那一步连同它的精度截断一起消失了。
 *
 * ⚠️ **坏值一律不拼**（`finiteOrNull` 为 `null` 就跳过那一项）—— 宁缺勿滥：
 *    拼进去会让整条 `transform` 被浏览器丢掉。**报出来是调用方的事**（见 `badTransformFields`）。
 *
 * ⚠️ **顺序 = CSS 从右往左作用。** 写 `rotate() skewX() scale()` 的实际效果是
 *    **先 scale、再 skew、最后 rotate** —— 先把盒子压扁/拉长，再斜切，最后转。
 */
function transformList(t: Transform): string[] {
  const tr: string[] = [];
  const rot = finiteOrNull(t.rotate);
  const kx = finiteOrNull(t.skewX);
  const ky = finiteOrNull(t.skewY);
  const sx = finiteOrNull(t.scale?.x);
  const sy = finiteOrNull(t.scale?.y);
  if (rot) tr.push(`rotate(${rot}deg)`);
  if (kx) tr.push(`skewX(${kx}deg)`);
  if (ky) tr.push(`skewY(${ky}deg)`);
  // ⚠️ `scale` 两个分量缺一不可 —— 只写一个也是非法值
  if (t.scale && sx !== null && sy !== null) tr.push(`scale(${sx},${sy})`);
  return tr;
}

/**
 * **文字节点上的 `scale` 是非法的** ⇒ 返回一份**去掉 `scale`** 的 `transform`。
 *
 * 理由见 `vocabulary.ts` 的 `scale`：文字的**大小**归 `fontSizePx`、文字的**形状**归字体文件，
 * `transform` 两样都不管。留着它只会画出"笔画粗细不一致"的**假压缩字**（faux condensed）。
 *
 * ⚠️ **编译器和编辑器必须共用这一个函数** —— 否则产物把 `scale` 丢了、而覆盖层还按老样子画，
 *    就又成了"两份口径漂开"（"组被转两遍"那类 bug 的温床）。
 *
 * ⚠️ **只处理节点自己**。组上的 `scale` 会连里面的 `shape` / `image` 一起改样，
 *    所以组那一层**只报不丢**（见 `emitGroup`）。
 */
export function effectiveTransform(n: { type: string; transform?: Transform }): Transform | undefined {
  const t = n.transform;
  if (!t) return undefined;
  if (n.type !== 'text' || !t.scale) return t;
  return { ...t, scale: undefined };
}

/**
 * `transform` → CSS。空串 = 不变换。
 *
 * ⚠️ **不需要盒子** —— 词汇与 CSS 同口径（都是度），转写就完了。
 *    （曾经要收 `Box` 只为把斜切比例换算成角度；那是词汇表的旧设计遗留。）
 *
 * ⚠️ 导出给**编辑器**用：拖着转的时候要直接在子文档上改 `transform`，
 * 必须和渲染产物**同一套算法**，否则"拖的时候看着对、松手重渲又变了"。
 */
export function transformCss(t: Transform | undefined): string {
  if (!t) return '';
  const tr = transformList(t);
  if (!tr.length) return '';
  return joinCss([
    `transform:${tr.join(' ')}`,
    t.origin ? `transform-origin:${(t.origin.x * 100).toFixed(3)}% ${(t.origin.y * 100).toFixed(3)}%` : '',
  ]);
}

/** 圆角：0–1 **相对短边**；四个角可不同。⚠️ 必须同时 `overflow:hidden` —— 不然子元素不裁 */
function radiusCss(radius: number | [number, number, number, number] | undefined, b: Box): string {
  if (!radius) return '';
  const short = Math.min(b.width, b.height);
  const r = Array.isArray(radius)
    ? radius.map((v) => `${Math.round(v * short)}px`).join(' ')
    : `${Math.round(radius * short)}px`;
  return joinCss([`border-radius:${r}`, 'overflow:hidden']);
}

/** 阴影 → `box-shadow`（可多层叠；**先写的在上层**，与 CSS 同序即同层叠） */
function shadowCss(
  list: Shadow[] | undefined,
  b: Box,
  no: (f: string, r: string) => void,
  userFilter?: string,
): string {
  if (!list?.length) return '';
  const short = Math.min(b.width, b.height);
  const boxes: string[] = [];
  const drops: string[] = [];
  for (const s of list) {
    const dx = Math.round((s.offset?.x ?? 0) * short);
    const dy = Math.round((s.offset?.y ?? 0) * short);
    const blur = Math.round((s.blur ?? 0) * short);
    const spread = Math.round((s.spread ?? 0) * short);
    const color = s.color ?? 'rgba(0,0,0,.35)';
    if (s.follow === 'outline') {
      if (spread) no('shadow[].spread', "`follow:'outline'` 走 filter:drop-shadow，没有 spread 参数（已忽略）");
      drops.push(`drop-shadow(${dx}px ${dy}px ${blur}px ${color})`);
      continue;
    }
    boxes.push(`${s.inset ? 'inset ' : ''}${dx}px ${dy}px ${blur}px ${spread}px ${color}`);
  }
  const parts: string[] = [];
  if (boxes.length) parts.push(`box-shadow:${boxes.join(',')}`);
  if (drops.length) parts.push(`filter:${[userFilter, ...drops].filter(Boolean).join(' ')}`);
  return joinCss(parts);
}

/**
 * 把 CSS 值里的 `url(名字)` 换成 `assets` 里映射过的**真 URL**。
 *
 * ⚠️ **词汇里的 `url(...)` 写的是"素材名"**（和 `asset` 字段同一个名字空间），
 *    **不是**相对页面 base 的路径。不过映射的话，浏览器会拿它当相对 URL 去 404 ——
 *    而报告里一个字都不会有（因为没走到"素材不在 assets 里"那条判断）。
 *
 * 已经是 `data:` / `http(s):` / 绝对路径的，**原样放行**（那不是素材名）。
 * 找不到映射的：**原样留着 + 报出来**（绝不静默）。
 */
function mapAssetUrls(
  value: string,
  field: string,
  assets: Record<string, string> | undefined,
  no: (f: string, r: string) => void,
): string {
  return value.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (whole, _q: string, raw: string) => {
    const name = raw.trim();
    if (/^(data:|https?:|\/|\.\.?\/)/i.test(name)) return whole;
    const href = assets?.[name];
    if (!href) {
      no(field, `素材 '${name}' 没在 assets 里 —— 渲染出来会是断图`);
      return whole;
    }
    return `url("${href}")`;
  });
}

/**
 * 元素级效果：透明 / 混合 / 滤镜 / 裁剪 / 蒙版（**所有元素共用这一组**）。
 *
 * ⚠️ 参数收 `VisualBase` 而不是某个具体类型：**元素和图层共用这一组字段**
 *    （图层是"又叠加的一张画布"，它整体也要能做这些效果）。
 */
function visualCss(
  n: VisualBase,
  assets?: Record<string, string>,
  no?: (f: string, r: string) => void,
): Array<string | false | undefined> {
  const maskList = n.mask
    ? mapAssetUrls(
        [...(Array.isArray(n.mask) ? n.mask : [n.mask])].reverse().join(','),
        'mask',
        assets,
        no ?? (() => {}),
      )
    : '';
  return [
    n.opacity != null && `opacity:${n.opacity}`,
    n.blend && `mix-blend-mode:${n.blend}`,
    n.filter && `filter:${n.filter}`,
    n.backdrop && joinCss([`-webkit-backdrop-filter:${n.backdrop}`, `backdrop-filter:${n.backdrop}`]),
    n.clip && `clip-path:${n.clip}`,
    maskList && joinCss([`-webkit-mask-image:${maskList}`, `mask-image:${maskList}`]),
  ];
}

// ══════════════════════════════════════════════════════════════════════
// 文字（DOM 排版那一条路）
// ══════════════════════════════════════════════════════════════════════

/**
 * 字号（px）= 文档里写的 px（片段覆盖 > 元素级 > 兜底）× 装填系数。
 *
 * ⚠️ **不再乘画布宽** —— `fontSizePx` 就是最终 px。`fit` 是文字自适应实测出来的
 * 系数（见 `fit.ts`），默认 1。下限 6px 是防"缩到零"。
 */
const textFontSize = (px: number | undefined, fit = 1) =>
  Math.max(6, Math.round((px ?? DEFAULT_FONT_PX) * fit));

/**
 * 这一段最终用的**字色**。规则：片段覆盖 > 元素级；**而且必须是个纯色** ——
 * 渐变/图案塞进 `color` 是无效 CSS，浏览器会静默忽略（那就成了"看着没生效"的暗坑）。
 */
function textColor(run: TextRun, node: TextNode): string | undefined {
  const c = run.fill ?? (typeof node.fill === 'string' ? node.fill : undefined);
  return c && isPlainColor(c) ? c : undefined;
}

/**
 * **装饰线**（下划线 / 删除线）的 CSS。
 *
 * ⚠️ 判断是"三态"：`true` 要 / `false` **明确不要**（用来取消元素级）/ `undefined` 跟随元素级。
 * 所以这里用 `??` 而不是 `||` —— 后者会把"明确不要"当成"没写"。
 */
function decoLineCss(run: TextRun, node: TextNode): string {
  const u = run.underline ?? node.underline ?? false;
  const s = run.strike ?? node.strike ?? false;
  const lines = [u && 'underline', s && 'line-through'].filter(Boolean) as string[];
  if (!lines.length) return '';
  const color = run.decoration?.color ?? node.decoration?.color;
  const style = run.decoration?.style ?? node.decoration?.style;
  const thick = run.decoration?.thickness ?? node.decoration?.thickness;
  return joinCss([
    `text-decoration-line:${lines.join(' ')}`,
    style && `text-decoration-style:${style}`,
    color && `text-decoration-color:${color}`,
    thick !== undefined && `text-decoration-thickness:${thick}px`,
  ]);
}

/**
 * **一个片段的样式**（DOM 排版这条路）。
 *
 * ⚠️ 与 `runCssSvg` 的硬区别：**沿路径排字那条路里，颜色是 SVG 的 `fill` 属性**，
 * 不是 CSS `color`（写 `color` 会一点反应都没有）。
 */
function runCss(run: TextRun, node: TextNode, fit: number): string {
  const fs = textFontSize(run.fontSizePx ?? node.fontSizePx, fit);
  const color = textColor(run, node);
  const shift = run.baselineShift ?? node.baselineShift;
  // ⚠️ **基线偏移必须落在片段上**：放整块那层是无效 CSS（整块是 `position:absolute` 的块，
  //    `vertical-align` 对它没有意义）—— 实测踩过。
  const gradFill =
    run.fill !== undefined && !isPlainColor(run.fill)
      ? joinCss([
          `background-image:${run.fill}`,
          '-webkit-background-clip:text',
          'background-clip:text',
          'color:transparent',
        ])
      : '';
  return joinCss([
    `font-size:${fs}px`,
    run.fontFamily && `font-family:${run.fontFamily}`,
    run.weight !== undefined && `font-weight:${run.weight}`,
    run.italic !== undefined && `font-style:${run.italic ? 'italic' : 'normal'}`,
    run.stretch !== undefined && `font-stretch:${run.stretch * 100}%`,
    color && `color:${color}`,
    run.letterSpacing !== undefined && `letter-spacing:${run.letterSpacing}em`,
    run.wordSpacing !== undefined && `word-spacing:${run.wordSpacing}em`,
    run.textTransform && `text-transform:${run.textTransform}`,
    run.smallCaps && 'font-variant-caps:small-caps',
    run.features?.length ? `font-feature-settings:${run.features.map((f) => `"${f}" 1`).join(',')}` : '',
    run.variations
      ? `font-variation-settings:${Object.entries(run.variations).map(([k, v]) => `"${k}" ${v}`).join(',')}`
      : '',
    shift !== undefined && shift !== 0 && `vertical-align:${shift}em`,
    decoLineCss(run, node),
    gradFill,
  ]);
}

/**
 * 文字 → **内层**那一块「文字本体」。
 *
 * 外层容器（`rect` / 变换 / 效果）由主入口统一生成，这里只出内层。
 *
 * ⚠️ 几个"不可继承或传播"的属性（基线偏移、装饰线）必须**每个片段都给最终值**：
 *    放在父级上浏览器不会往下传。
 *
 * ⚠️ `data-fit` 打在这一层（**内层**）—— 文字自适应与就地编辑都靠它定位。
 */
function emitText(
  node: TextNode,
  fit: number,
  no: (f: string, r: string) => void,
  note: (f: string, r: string) => void,
  cssOut: string[],
): string {
  // ── 元素级：翻不出的先报出来 ────────────────────────────────
  if (node.stroke) {
    if (Array.isArray(node.stroke.width)) no('stroke.width', '文字描边只做统一线宽（四边不同对文字没有意义）');
    if (node.stroke.paint && /url\(/i.test(node.stroke.paint)) no('stroke.paint', '图片描边要 border-image，文字上做不了');
    if (node.stroke.inset) note('stroke.inset', '文字描边是**居中**描（一半在外一半在内），没有"向内描"这个选项');
    if (node.stroke.over) note('stroke.over', '文字描边永远画在字面之上，没有"画在下面"这个选项');
    if (node.stroke.cap || node.stroke.join) note('stroke.cap', '端点 / 拐角只对**开放路径**有意义，字形轮廓上不适用');
  }
  if (node.dropCap && node.wrap !== 'normal') {
    note('dropCap', '首字下沉要有意义，这段文字**必须多行** —— 建议同时把 `wrap` 设成 `normal`');
  }
  if (node.baselineShift) note('baselineShift', '基线的基准词汇里没写，这里按"字号倍数（em）"算');

  const runs = node.runs.map((r, i) => {
    return `<span data-run="${i}" style="${runCss(r, node, fit)}">${escText(r.text).split('\n').join('<br>')}</span>`;
  });

  // 整块渐变填字（片段级的那条在 `runCss` 里）
  const gradFill = node.fill !== undefined && (typeof node.fill !== 'string' || !isPlainColor(node.fill));
  const fillClip = gradFill
    ? joinCss([
        `background-image:${[...(Array.isArray(node.fill) ? node.fill : [node.fill as string])].reverse().join(',')}`,
        '-webkit-background-clip:text',
        'background-clip:text',
        'color:transparent',
      ])
    : '';

  // ── 文字描边：`-webkit-text-stroke`（`paint` 缺省沿用当前字色）──
  let strokeInline = '';
  if (node.stroke) {
    const w = Array.isArray(node.stroke.width) ? node.stroke.width[0] : (node.stroke.width ?? 1);
    const paint = node.stroke.paint && !/url\(/i.test(node.stroke.paint) ? node.stroke.paint : 'currentColor';
    strokeInline = joinCss([`-webkit-text-stroke:${w}px ${paint}`]);
  }

  let cls = 'vt';
  if (node.dropCap) {
    const safe = node.id.replace(/[^A-Za-z0-9_-]/g, '_');
    cls = `vt vdc-${safe}`;
    cssOut.push(
      `.vdc-${safe}::first-letter{initial-letter:${node.dropCap};-webkit-initial-letter:${node.dropCap}}`,
    );
  }

  const inner = css([
    'position:absolute',
    'left:0',
    'right:0',
    'top:50%',
    'transform:translateY(-50%)',
    node.align && `text-align:${node.align}`,
    node.alignLast && `text-align-last:${node.alignLast}`,
    node.writingMode && `writing-mode:${node.writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb'}`,
    node.direction && `direction:${node.direction}`,
    node.fontFamily && `font-family:${node.fontFamily}`,
    node.weight !== undefined && `font-weight:${node.weight}`,
    node.italic !== undefined && `font-style:${node.italic ? 'italic' : 'normal'}`,
    node.stretch !== undefined && `font-stretch:${node.stretch * 100}%`,
    `font-size:${textFontSize(node.fontSizePx, fit)}px`,
    `line-height:${node.lineHeight ?? 1.15}`,
    node.letterSpacing !== undefined && `letter-spacing:${node.letterSpacing}em`,
    node.wordSpacing !== undefined && `word-spacing:${node.wordSpacing}em`,
    node.wrap === 'normal' ? 'white-space:normal' : 'white-space:nowrap',
    node.textTransform && `text-transform:${node.textTransform}`,
    node.smallCaps && 'font-variant-caps:small-caps',
    node.features?.length ? `font-feature-settings:${node.features.map((f) => `"${f}" 1`).join(',')}` : '',
    node.variations
      ? `font-variation-settings:${Object.entries(node.variations).map(([k, v]) => `"${k}" ${v}`).join(',')}`
      : '',
    fillClip,
    strokeInline,
  ]);

  return `<div class="${cls}" data-fit="${escAttr(node.id)}" style="${inner}">${runs.join('')}</div>`;
}

// ══════════════════════════════════════════════════════════════════════
// 文字（沿路径排版 —— SVG `<textPath>` 那一条路）
// ══════════════════════════════════════════════════════════════════════

/** 路径的 id（同一份文档里必须唯一，否则几个节点的 `textPath` 会互相抢） */
const pathIdOf = (id: string) => `tp-${id.replace(/[^A-Za-z0-9_-]/g, '')}`;

/**
 * `curve`（正圆弧的简写）→ 一条二次贝塞尔的 `d`。
 *
 * 0–1 坐标系：`M0,1`（左下）→ 控制点 `(0.5, 1-2·curve)` → `1,1`（右下）。
 * `curve = 0` 时控制点落在 `y=1`（直线）；越大拱得越高。
 */
function curveToPath(curve: number): string {
  return `M0,1 Q0.5,${+(1 - 2 * curve).toFixed(4)} 1,1`;
}

/**
 * **片段样式（SVG 版）**。
 *
 * ⚠️ 与 `runCss` 的硬区别：文字颜色在 SVG 里是 **`fill` 属性**，不是 CSS `color`
 * —— 写 `color` 会**一点反应都没有**（字形不填色）。
 */
function runCssSvg(run: TextRun, node: TextNode, fit: number): string {
  const fs = textFontSize(run.fontSizePx ?? node.fontSizePx, fit);
  const color = textColor(run, node);
  return joinCss([
    `font-size:${fs}px`,
    run.fontFamily && `font-family:${run.fontFamily}`,
    run.weight !== undefined && `font-weight:${run.weight}`,
    run.italic !== undefined && `font-style:${run.italic ? 'italic' : 'normal'}`,
    run.stretch !== undefined && `font-stretch:${run.stretch * 100}%`,
    run.letterSpacing !== undefined && `letter-spacing:${run.letterSpacing}em`,
    color && `fill:${color}`,
  ]);
}

/**
 * **沿路径排字** —— `curve`（正圆弧的简写）与 `path`（任意路径）走这一条。
 * 返回的是**内层**（一个 `<svg>`），外层容器仍由主入口统一生成。
 *
 * ## 为什么是"另一条渲染路径"
 *
 * 普通文字是**浏览器排版**（`div` + `span`，CSS 自己断行、居中）；
 * 排到一条线上只能靠 **SVG `<textPath>`** —— DOM 里没有别的手段。
 * 所以这里不是"再加几个字段"，而是换了一套渲染机制：产物结构完全不同。
 *
 * ## ⚠️ 坐标：不解析 `d`，让 SVG 自己缩放
 *
 * 词汇里路径坐标**恒为 0–1**（与 `rect` / `curve` 同一套比例）。要铺到像素空间，
 * 直接解析 `d` 里的数字再逐个乘宽高是**最容易出错**的做法（得区分坐标 / 控制点 / 半径，
 * 还要处理相对命令与隐式重复）。改用 `transform="scale(W,H)"`：
 * **路径在 0–1 空间里画、由 SVG 自己缩放**，而变换挂在 `<path>` 上 ⇒ `<text>` 不受影响，
 * **字形不会被拉变形**。
 * （若反过来用 `viewBox="0 0 1 1" preserveAspectRatio="none"`，字会跟着被压扁 —— 那是错的。）
 */
function emitPathText(
  node: TextNode,
  fit: number,
  note: (f: string, r: string) => void,
): string {
  // ── 沿路径排字**结构上就是单行**：这些字段先报明白，别让人以为生效了 ──
  if (node.runs.some((r) => r.text.includes('\n'))) {
    note('runs[].text', '沿路径排字只有一行 —— 文字里的换行会被当普通字符排下去');
  }
  if (node.lineHeight !== undefined) note('lineHeight', '沿路径排字是单行，行高没有意义');
  if (node.wrap === 'normal') note('wrap', '沿路径排字不能断行');
  if (node.alignLast) note('alignLast', '沿路径排字是单行，末行对齐没有意义');
  if (node.dropCap) note('dropCap', '首字下沉与沿路径排字不兼容');
  if (node.underline || node.strike || node.runs.some((r) => r.underline || r.strike)) {
    note('underline', '装饰线在 SVG 文字上这一版没做');
  }
  if (node.stroke) note('stroke', '沿路径的文字描边这一版没做');
  if (node.runs.some((r) => r.baselineShift)) note('runs[].baselineShift', '沿路径的文字这一版不做上下标');
  if (typeof node.fill !== 'string' || (node.fill && !isPlainColor(node.fill))) {
    note('fill', '沿路径的文字只支持纯色填充（渐变要另写 SVG 定义）');
  }
  if (node.runs.some((r) => r.fill && !isPlainColor(r.fill))) {
    note('runs[].fill', '沿路径的文字只支持纯色填充');
  }
  // ⚠️ 这是 SVG 的规矩，不是 bug：文字比路径长时，超出那段**根本不渲染**
  note('path', '文字比路径长时，超出路径的那部分**不会显示**（SVG 的规矩）—— 路径给长一点、或字号小一点');

  const b = boxOf(node.rect);
  const W = Math.max(1, b.width);
  const H = Math.max(1, b.height);
  const d = node.path ?? curveToPath(node.curve ?? 0);
  const pid = pathIdOf(node.id);

  const runs = node.runs
    .map(
      (r, i) =>
        // ⚠️ `data-run` 照打：选区（改样式）仍要按它把画面上的字对回 `runs[i]`
        `<tspan data-run="${i}" style="${runCssSvg(r, node, fit)}">${escText(r.text).split('\n').join(' ')}</tspan>`,
    )
    .join('');

  const fill = typeof node.fill === 'string' && isPlainColor(node.fill) ? node.fill : 'currentColor';
  // ⚠️ 对齐要**两件事一起**才成立（实测踩过）：
  //    `startOffset` 只说"从路径的哪个点开始排"，`text-anchor` 才说"文字相对那个点怎么摆"。
  //    只给 `startOffset="50%"` = **从正中间往后排**（后半段路径装不下的就没了）——
  //    看起来"居中"，实际是"从中间开始"，稍长一点就被截断。
  const anchor = node.align === 'center' ? '50%' : node.align === 'right' ? '100%' : '0%';
  const textAnchor = node.align === 'center' ? 'middle' : node.align === 'right' ? 'end' : 'start';
  const textCss = css([
    `font-size:${textFontSize(node.fontSizePx, fit)}px`,
    node.fontFamily && `font-family:${node.fontFamily}`,
    node.weight !== undefined && `font-weight:${node.weight}`,
    node.italic !== undefined && `font-style:${node.italic ? 'italic' : 'normal'}`,
    node.stretch !== undefined && `font-stretch:${node.stretch * 100}%`,
    node.letterSpacing !== undefined && `letter-spacing:${node.letterSpacing}em`,
    node.features?.length ? `font-feature-settings:${node.features.map((f) => `"${f}" 1`).join(',')}` : '',
    node.variations
      ? `font-variation-settings:${Object.entries(node.variations).map(([k, v]) => `"${k}" ${v}`).join(',')}`
      : '',
  ]);

  return (
    `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0;overflow:visible">` +
    // `scale(W,H)`：路径在 0–1 空间里写，铺到像素空间由 SVG 负责；`<text>` 不受它影响
    `<path id="${pid}" d="${escAttr(d)}" transform="scale(${W},${H})" fill="none"/>` +
    `<text text-anchor="${textAnchor}" fill="${escAttr(fill)}" style="${textCss}">` +
    `<textPath href="#${pid}" startOffset="${anchor}">${runs}</textPath>` +
    `</text></svg>`
  );
}

// ══════════════════════════════════════════════════════════════════════
// 渐变 / 图标
// ══════════════════════════════════════════════════════════════════════

/** `linear-gradient(115deg, #A, #B)` → `<linearGradient>` 定义；解析不了 ⇒ `null` */
function cssGradientToSvgDef(css: string, id: string): string | null {
  const repeating = /repeating-linear-gradient/i.test(css);
  const m = /(?:repeating-)?linear-gradient\(([^)]+)\)/i.exec(css);
  if (!m) return null;
  const parts = m[1].split(',').map((x) => x.trim());
  let deg = 180; // CSS 缺省方向 = to bottom
  let i = 0;
  const head = parts[0] ?? '';
  const degM = /^(-?[\d.]+)deg$/i.exec(head);
  if (degM) {
    deg = parseFloat(degM[1]);
    i = 1;
  } else if (/^to\s/i.test(head)) {
    const d = head.toLowerCase();
    deg = d.includes('right') && d.includes('top') ? 45
      : d.includes('right') && d.includes('bottom') ? 135
      : d.includes('left') && d.includes('bottom') ? 225
      : d.includes('left') && d.includes('top') ? 315
      : d.includes('right') ? 90
      : d.includes('left') ? 270
      : d.includes('top') ? 0
      : 180;
    i = 1;
  }
  const stops = parts.slice(i).map((raw) => {
    const pm = /^(.+?)\s+([\d.]+)%$/.exec(raw);
    return pm ? { color: pm[1].trim(), offset: parseFloat(pm[2]) / 100 } : { color: raw, offset: -1 };
  });
  if (!stops.length) return null;
  if (stops.every((s) => s.offset < 0) && stops.length > 1) {
    stops.forEach((s, idx) => (s.offset = idx / (stops.length - 1)));
  } else {
    let last = 0;
    for (const st of stops) {
      if (st.offset < 0) st.offset = last;
      last = st.offset;
    }
  }
  if (repeating) {
    const period = stops.length ? Math.max(...stops.map((s2) => s2.offset)) : 0;
    if (period <= 0 || period >= 1) return null;
    const base = stops.map((s2) => ({ ...s2 }));
    const copies = Math.ceil(1 / period);
    for (let c = 1; c < copies; c++) {
      for (const s2 of base) stops.push({ color: s2.color, offset: Math.min(1, s2.offset + c * period) });
    }
  }

  const rad = (deg * Math.PI) / 180;
  const x = Math.sin(rad);
  const y = -Math.cos(rad);
  const f = (v: number) => (0.5 + v / 2).toFixed(4);
  const stopXml = stops
    .map((s2) => `<stop offset="${s2.offset.toFixed(4)}" stop-color="${escAttr(s2.color)}"/>`)
    .join('');
  return `<linearGradient id="${id}" x1="${f(-x)}" y1="${f(-y)}" x2="${f(x)}" y2="${f(y)}">${stopXml}</linearGradient>`;
}

/**
 * **图标**（外部 SVG 素材）→ 一个 `<img>`。
 *
 * ⚠️ 固定 `object-fit:contain`：照片可以裁，**图标裁一条边就废了**。
 *
 * ⚠️ 染色（`fill`）没做 —— `<img>` 引的是另一份文档，CSS 进不去（要 `mask-image`）。
 */
function emitSvg(node: SvgNode, ctx: EmitCtx, no: (f: string, r: string) => void): string {
  if (node.fill !== undefined) {
    no('fill', '外部 SVG 的换色要 mask-image，这一版没做（<img> 引的是另一份文档，CSS 进不去）');
  }
  const src = ctx.opts.assets?.[node.asset];
  if (!src) no('asset', `素材 '${node.asset}' 没在 assets 里 —— 渲染出来会是断图`);
  const style = css(['display:block', 'width:100%', 'height:100%', 'object-fit:contain']);
  return `<img src="${escAttr(src ?? '')}" style="${style}">`;
}

// ══════════════════════════════════════════════════════════════════════
// 组
// ══════════════════════════════════════════════════════════════════════

/**
 * 组的**内容框** —— 子元素 `rect` 的并集（像素）。
 *
 * ⚠️ 为什么需要它：`transform` 的**支点**必须相对一个框才算得出来，而组**没有 `rect`**。
 *    拿"画布"当参照也能算，但那样组会**绕画布中心**转 —— 一个待在角上的组一转就甩出去了，
 *    与"组绕自己转"的直觉不符。⇒ 用**内容并集**当参照，默认支点就是组自己的中心。
 *
 * ⚠️ 近似（**必须与编辑器口径一致**，否则选中框和实际位置会错开）：
 *    子元素**自身的 `transform` 不参与**求并集。
 */
export function groupContentBox(node: GroupNode, C: Canvas): Box {
  // 空组：退回画布（没有内容就没有"自己的中心"可言）
  return contentBoxOf(node.elements) ?? { left: 0, top: 0, width: C.width, height: C.height };
}

/**
 * **一组元素的并集框**（不含嵌套组自身的 `transform`）。空列表 ⇒ `null`。
 *
 * 组和**图层**都要用它算支点，所以单拎出来一份 —— 见 `groupContentBox` / `emitLayer`。
 */
export function contentBoxOf(els: readonly ElementNode[]): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (ls: readonly ElementNode[]) => {
    for (const l of ls) {
      if (l.type === 'group') {
        walk(l.elements);
        continue;
      }
      const b = boxOf(l.rect);
      minX = Math.min(minX, b.left);
      minY = Math.min(minY, b.top);
      maxX = Math.max(maxX, b.left + b.width);
      maxY = Math.max(maxY, b.top + b.height);
    }
  };
  walk(els);
  if (!Number.isFinite(minX)) return null;
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 组的 `transform` → CSS。变换串与 `transformCss` **同一份实现**（`transformList`），
 * **只有支点换算不同** —— 所以绝不能各写一遍。
 *
 * ⚠️ 组容器是**铺满画布**的（`100% × 100%`）⇒ CSS `transform-origin` 的百分比是
 *    相对**画布**的，而 `transform.origin` 是相对**内容框**的 0–1 ⇒ 必须换算一次。
 *    （普通节点的容器就是它自己那个框，两边本来同源，所以不需要这一步。）
 */
export function groupTransformCss(node: GroupNode, C: Canvas): string {
  const t = node.transform;
  if (!t) return '';
  const tr = transformList(t);
  if (!tr.length) return '';
  // 支点：内容框里的 0–1 ⇒ 换算到"占画布多少 %"（组容器铺满画布，百分比是对画布的）
  const cb = groupContentBox(node, C);
  const ox = cb.left + (t.origin?.x ?? 0.5) * cb.width;
  const oy = cb.top + (t.origin?.y ?? 0.5) * cb.height;
  return joinCss([
    `transform:${tr.join(' ')}`,
    `transform-origin:${((ox / C.width) * 100).toFixed(4)}% ${((oy / C.height) * 100).toFixed(4)}%`,
  ]);
}

/**
 * **组** —— 把多个元素**当一整个**做效果：整体旋转 / 整体淡出 / 整体滤镜 /
 * 整体裁剪蒙版 / 整体混合。这是组存在的**唯一理由**。
 *
 * ## ⚠️ 它和「规则 3」是冲突的 —— 规则要重述
 *
 * 规则 3 原话（`src/document/README.md`）：
 * 「**节点不得依赖父容器来实现自身效果** …… 每个节点必须能被单独截出来而不变样。」
 *
 * 而组**就是**一个"依赖父容器"的机制。三者只能这样共存：
 *
 * | 谁 | 要求 |
 * |---|---|
 * | **顶层节点** | 必须能单独截出来不变样（规则 3 原话） |
 * | **组** | 是**唯一例外** —— 它的定义就是"整体做效果" |
 * | **可截层单位** | = **每个顶层节点**（组整体算一层，组内元素不再单独成层） |
 *
 * ⇒ 所以组容器**铺满画布**（不吃鼠标、只做效果），子元素照常渲染、照常带自己的 `data-layer`。
 */
function emitGroup(node: GroupNode, ctx: EmitCtx): string {
  // ⚠️ 组上的 `scale` 会把里面的**文字**一起压扁 —— 与"文字不许用 scale"同一条规则。
  //    但这里**只报不丢**：丢了会连组里的 shape / image 一起改样，代价比留着更大。
  //    （真正的解法是让模型别这么写 —— 这条报告就是给它的反馈。）
  if (node.transform?.scale && hasTextInside(node)) {
    ctx.no(
      node.id,
      'transform.scale',
      '这个组里有文字，组上的 scale 会把文字一起压扁 —— 文字的大小归 fontSizePx、形状归字体文件；请把 scale 限在 shape / image 上',
    );
  }
  const style = css([
    'position:absolute',
    'left:0',
    'top:0',
    'width:100%',
    'height:100%',
    groupTransformCss(node, ctx.C),
    ...(visualCss(node, ctx.opts.assets, (f, r) => ctx.no(node.id, f, r)).filter(Boolean) as string[]),
  ]);
  const kids = node.elements.map((c) => emitElement(c, ctx)).join('\n');
  return `<div class="vg" data-layer="${escAttr(node.id)}" data-layer-type="group" style="${style}">${kids}</div>`;
}

/** 组里（含嵌套）有没有文字节点 —— `emitGroup` 判"组上的 scale 会不会压到字"用 */
function hasTextInside(node: GroupNode): boolean {
  return node.elements.some((c) => (c.type === 'group' ? hasTextInside(c) : c.type === 'text'));
}

// ══════════════════════════════════════════════════════════════════════
// 图片
// ══════════════════════════════════════════════════════════════════════

/**
 * **图片** → 一个 `<img>`。
 *
 * - `fit` 决定裁剪方式（`cover` 默认 / `contain` / `fill`）
 * - `position` 决定 `object-position`（0–1，**相对图片自己**）
 * - `render: 'pixelated'` 走 `image-rendering`
 *
 * ⚠️ 染色（`fill`）这一版没做：要 `mask-image` + `background-color`。
 */
function emitImage(
  node: ImageNode,
  opts: EmitOptions,
  no: (f: string, r: string) => void,
): string {
  if (node.fill) {
    no('fill', '图片染色（单色图变任意色）要 mask-image + background-color，这一版没做');
  }

  const src = opts.assets?.[node.asset];
  if (!src) no('asset', `素材 '${node.asset}' 没在 assets 里 —— 渲染出来会是断图`);

  const pos = node.position ?? { x: 0.5, y: 0.5 };
  const img = css([
    'display:block',
    'width:100%',
    'height:100%',
    `object-fit:${node.fit ?? 'cover'}`,
    `object-position:${(pos.x * 100).toFixed(1)}% ${(pos.y * 100).toFixed(1)}%`,
    `image-rendering:${node.render === 'pixelated' ? 'pixelated' : 'auto'}`,
  ]);

  return `<img src="${escAttr(src ?? '')}" style="${img}">`;
}

// ══════════════════════════════════════════════════════════════════════
// 矢量图形
// ══════════════════════════════════════════════════════════════════════

/** 点坐标压到 4 位小数（避免 `0.30000000000000004` 这种噪音） */
const r4 = (n: number) => +n.toFixed(4);

/**
 * **描边 → CSS**（走 div 那条：盒子 / 图片）。
 *
 * ⚠️ 词汇里 `stroke` 是"同一句话，三种落地"：
 *    shape 走 SVG 图元属性（见 `emitShape`）· 文字走 `-webkit-text-stroke`（见 `emitText`）·
 *    **盒子和图片走这里**（`outline` / `border-image`）。
 */
function strokeCss(
  stroke: Stroke | undefined,
  assets: Record<string, string> | undefined,
  no: (f: string, r: string) => void,
): string {
  if (!stroke) return '';
  if (Array.isArray(stroke.width)) no('stroke.width', '这一版只做统一线宽（四边不同要 border，会挤动盒模型）');
  if (stroke.cap) no('stroke.cap', '端点样式只对开放路径有意义 —— 属矢量');
  if (stroke.join) no('stroke.join', '拐角样式只对折线有意义 —— 属矢量');
  if (stroke.over) no('stroke.over', '盒模型的描边永远在上面（outline），没有"画在下面"这个选项');
  const w = Array.isArray(stroke.width) ? stroke.width[0] : stroke.width ?? 1;
  if (stroke.paint && /url\(/i.test(stroke.paint)) {
    if (stroke.dash) no('stroke.dash', '图片描边（border-image）不支持虚线');
    // ⚠️ `border-image` 的 slice 取 3 倍线宽 —— 词汇里没有"切片参数"这个概念
    const slice = Math.max(1, Math.round(w * 3));
    // ⚠️ `stroke.paint` 里的 `url(名字)` 也要过映射 —— 不过就是相对页面 base 的 404
    const paint = mapAssetUrls(stroke.paint, 'stroke.paint', assets, no);
    return joinCss([`border:${w}px solid transparent`, `border-image:${paint} ${slice} / ${w}px`]);
  }
  const paint = stroke.paint && !/url\(/i.test(stroke.paint) ? stroke.paint : 'currentColor';
  return joinCss([
    `outline:${w}px ${stroke.dash ? 'dashed' : 'solid'} ${paint}`,
    `outline-offset:${stroke.inset ? -w : 0}px`,
  ]);
}

/**
 * **形状** → 一个内嵌 `<svg>`（2026-10-14 统一；原先 `rect` / `ellipse` 走 CSS）。
 *
 * ## 四种几何的坐标口径**不同**，这是刻意的
 *
 * | `kind` | 产物 | 为什么 |
 * |---|---|---|
 * | `rect` | `<rect x=0 y=0 width height rx>` | 图元自带绝对宽高 ⇒ 圆角与描边不变形 |
 * | `ellipse` | `<ellipse cx cy rx ry>` | 内切于本节点的框 |
 * | `polygon` | `<polygon points>`（**像素**） | 同上：像素口径描边才不会随框变形 |
 * | `path` | `<path d>`（**0–1**）+ `transform="scale(W,H)"` | 见下 |
 *
 * ⚠️ `path` 是唯一的例外：`d` 里的数字**不解析**，直接交给 SVG 缩放
 * （解析 `d` 要区分坐标 / 控制点 / 半径，还要处理相对命令与隐式重复 —— 最容易出错）。
 * 描边配 `non-scaling-stroke` 保持线宽。
 *
 * ⚠️ **多份填充 = 同一形状画多份图元**（数组 `[0]` 最底、最后一个最上），
 *    而不是"只留最上 / 全丢"。**描边与滤镜只挂最上层**，否则会叠加变粗变暗。
 *
 * ⚠️ 圆角 / 填充 / 描边 / 阴影**都在 svg 这边**；外层容器只管
 *    位置尺寸 · `transform` · `opacity` · `blend` · `clip` · `mask` · `backdrop`。
 */
function emitShape(
  node: ShapeNode,
  no: (f: string, r: string) => void,
  note: (f: string, r: string) => void,
  defs: string[],
  assets?: Record<string, string>,
): string {
  const b = boxOf(node.rect);

  /** 一个 fill 值 → SVG 能吃的 `fill`（纯色直传；渐变/图案落 `<defs>` 再引用） */
  const takeFill = (f: string): string => {
    if (isPlainColor(f)) return f;
    if (/linear-gradient/i.test(f)) {
      const id = `grad-${node.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
      const def = cssGradientToSvgDef(f, id);
      if (def) {
        defs.push(def);
        return `url(#${id})`;
      }
      no('fill', `这一版解析不了这个渐变：${f}`);
      return 'none';
    }
    if (/^url\(/i.test(f)) {
      const m2 = /url\((['"]?)([^)'"]+)\1\)/i.exec(f);
      const name = (m2?.[2] ?? '').trim();
      const href = assets?.[name];
      if (!href) {
        no('fill', `图案素材 '${name}' 没在 assets 里`);
        return 'none';
      }
      const pid = `pat-${node.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
      defs.push(
        `<pattern id="${pid}" patternUnits="objectBoundingBox" width="1" height="1">` +
          `<image href="${escAttr(href)}" width="1" height="1" preserveAspectRatio="none"/>` +
          `</pattern>`,
      );
      note('fill', '图案的平铺 / 尺寸 / 位置参数词汇还没放进来，当前按"拉伸铺满"处理');
      return `url(#${pid})`;
    }
    no('fill', 'conic / 现代色彩空间渐变这一版没做（SVG 无原生对应）');
    return 'none';
  };
  const fills: string[] = [];
  const f = node.fill;
  if (typeof f === 'string') {
    fills.push(takeFill(f));
  } else if (Array.isArray(f)) {
    for (const one of f) if (typeof one === 'string') fills.push(takeFill(one));
  }
  if (!fills.length) fills.push('none');

  // ── 阴影：统一走 SVG filter（内阴影要 feMorphology + feComposite，外投影走 drop-shadow）──
  const shadows: string[] = [];
  const shShort = Math.min(b.width, b.height);
  (node.shadow ?? []).forEach((sh, shIdx) => {
    const dx = Math.round((sh.offset?.x ?? 0) * shShort);
    const dy = Math.round((sh.offset?.y ?? 0) * shShort);
    const blur = Math.round((sh.blur ?? 0) * shShort);
    const spread = Math.round((sh.spread ?? 0) * shShort);
    const color = sh.color ?? 'rgba(0,0,0,.35)';
    if (sh.inset) {
      const spreadPx = Math.max(0, spread);
      const srcAlpha =
        spreadPx > 0
          ? `<feMorphology in="SourceAlpha" operator="erode" radius="${spreadPx}" result="sa"/>`
          : '';
      const src = spreadPx > 0 ? 'sa' : 'SourceAlpha';
      const fid = `insetsh-${node.id.replace(/[^A-Za-z0-9_-]/g, '_')}-${shIdx}`;
      defs.push(
        `<filter id="${fid}" x="-30%" y="-30%" width="160%" height="160%">` +
          srcAlpha +
          `<feOffset in="${src}" dx="${dx}" dy="${dy}" result="o"/>` +
          `<feGaussianBlur in="o" stdDeviation="${Math.max(0.1, blur / 2)}" result="bl"/>` +
          `<feComposite in="${src}" in2="bl" operator="out" result="h"/>` +
          `<feFlood flood-color="${escAttr(color)}" result="c"/>` +
          `<feComposite in="c" in2="h" operator="in" result="sh"/>` +
          `<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="sh"/></feMerge>` +
          `</filter>`,
      );
      shadows.push(`url(#${fid})`);
      return;
    }
    // ⚠️ `filter` 的 drop-shadow **没有 spread 参数**（那是 box-shadow 的）——
    //    上一版把 spread 硬塞进去，整条 filter 非法被浏览器丢弃 ⇒ 阴影完全消失（实测踩过）
    if (spread) no('shadow.spread', 'filter 的 drop-shadow 没有 spread 参数（已忽略）');
    if (sh.follow !== 'outline' && node.kind !== 'rect' && node.kind !== 'ellipse') {
      note('shadow.follow', "统一渲染路线下 shape 的投影沿**真实轮廓**（drop-shadow）；'box'（外接矩形）对折线形这一版以轮廓近似");
    }
    shadows.push(`drop-shadow(${dx}px ${dy}px ${blur}px ${color})`);
  });
  const filterAttr =
    node.filter || shadows.length
      ? ` filter="${escAttr(`${node.filter ?? ''} ${shadows.join(' ')}`.trim())}"`
      : '';

  // ── 描边：统一走 SVG 的 `stroke` 属性 ──
  const strokeAttrs: string[] = [];
  const st = node.stroke;
  if (st) {
    if (Array.isArray(st.width)) no('stroke.width', '统一线宽（"四边不同"只有盒子的 border 才有，SVG 图元是统一描边）');
    if (st.paint && /url\(/i.test(st.paint)) no('stroke.paint', '图片描边这一版没做');
    if (st.inset) note('stroke.inset', 'SVG 的描边骑在轮廓上，没有"向内描"');
    strokeAttrs.push(
      st.paint && !/url\(/i.test(st.paint) ? `stroke="${escAttr(st.paint)}"` : '',
      `stroke-width="${st.width ?? 1}"`,
      st.dash ? `stroke-dasharray="${st.dash[0]} ${st.dash[1]}"` : '',
      st.cap ? `stroke-linecap="${st.cap}"` : '',
      st.join ? `stroke-linejoin="${st.join}"` : '',
      st.over ? 'paint-order="stroke fill"' : '',
    );
  }

  // ── 几何：rect / ellipse / polygon 用**像素坐标**（rx 与描边才不变形）；
  //    `path` 的 `d` 是 0–1 坐标 ⇒ 保留 `transform="scale(W,H)"`（不解析 `d`，同沿路径排字），
  //    描边配 `non-scaling-stroke`。──
  let geom: string;
  const extra: string[] = [];
  if (node.kind === 'rect') {
    if (node.radius !== undefined) {
      const short = Math.min(b.width, b.height);
      const rv = typeof node.radius === 'number' ? node.radius : node.radius[0];
      const r = Math.min(Math.round(rv * short), Math.round(Math.min(b.width, b.height) / 2));
      if (r > 0) extra.push(`rx="${r}"`);
    }
    // ⚠️ 图元坐标**相对容器**（svg 放在容器的 0,0）—— 用画布绝对值会偏移两次（实测错位）
    geom = `<rect x="0" y="0" width="${b.width}" height="${b.height}"${extra.length ? ' ' + extra.join(' ') : ''}/>`;
  } else if (node.kind === 'ellipse') {
    if (node.radius !== undefined) {
      note('radius', '椭圆的形状由 `ellipse` 决定，`radius` 在这里没意义');
    }
    geom = `<ellipse cx="${r4(b.width / 2)}" cy="${r4(b.height / 2)}" rx="${r4(b.width / 2)}" ry="${r4(b.height / 2)}"/>`;
  } else if (node.kind === 'polygon') {
    if (node.radius !== undefined) note('radius', '`polygon` 的轮廓来自它自己的数据，`radius` 在这里没意义');
    if (node.points.length < 3) no('points', `多边形至少要 3 个点（现在 ${node.points.length} 个）`);
    const pts = node.points.map(([x, y]) => `${r4(x * b.width)},${r4(y * b.height)}`).join(' ');
    geom = `<polygon points="${pts}"/>`;
  } else {
    if (node.radius !== undefined) note('radius', '`path` 的轮廓来自它自己的数据，`radius` 在这里没意义');
    if (!node.d) no('d', '路径没给数据');
    geom = `<path d="${escAttr(node.d)}" transform="scale(${b.width},${b.height})" style="vector-effect:non-scaling-stroke"/>`;
  }

  // ⚠️ 每层一份图元（数组 [0] 先画 = 最底）；**描边与滤镜只挂最上层**（每层都挂会叠加变粗/变暗）
  const layerXmls = fills.map((fl, i) => {
        const isTop = i === fills.length - 1;
        const attrs = [
          ...(isTop ? strokeAttrs.filter(Boolean) : []),
          `fill="${escAttr(fl)}"`,
          isTop ? filterAttr : '',
        ]
          .filter(Boolean)
          .join(' ');
        return geom.replace('/>', ` ${attrs}/>`);
      });

  return `<svg viewBox="0 0 ${b.width} ${b.height}" width="${b.width}" height="${b.height}" style="position:absolute;left:0;top:0;overflow:visible">${layerXmls.join('')}</svg>`;
}

// ══════════════════════════════════════════════════════════════════════
// 主入口
// ══════════════════════════════════════════════════════════════════════

/**
 * 渲染一个节点需要的**环境**：画布、选项，以及往哪几张表里记账。
 *
 * 抽出来是为了**递归** —— 组里还能装节点（也能再套组），
 * 递归就得有个东西替每一层记 `unsupported` / `notes` / 额外 CSS。
 */
interface EmitCtx {
  C: Canvas;
  opts: EmitOptions;
  /** 内联 style 写不出来的 CSS（首字下沉的 `::first-letter`）—— 收着，最后并进 `<style>` */
  extraCss: string[];
  /** SVG `<defs>`（渐变定义）—— shape 统一走 SVG 之后，渐变从 CSS 搬到了这里 */
  defs: string[];
  no(id: string, field: string, reason: string): void;
  note(id: string, field: string, reason: string): void;
}

/**
 * **图层** —— 又叠加的一张画布。**画布的孩子一律是图层**（哪怕里面只有一个元素）。
 *
 * ⚠️ **图层永远和画布一样大**（`Layer` 没有 `rect`）⇒ 容器恒为
 *    `left:0;top:0;width:100%;height:100%`，**元素坐标永远是画布坐标**，不需要任何换算。
 *
 * ⚠️ **图层没有 `transform`**（用户 2026-10-16 定）—— 一个和画布一样大的面"旋转/缩放"
 *    等于转整张画布，没意义（PS 也没有这个属性）。所以这里**不产出 transform**。
 *
 * ⚠️ **图层没有 `background` / `clip`**：
 *    底色归画布（`Canvas.background`），图层是一张透明的面；
 *    按形状裁由 `mask` 表达（硬边 = 一张黑白形状的蒙版）⇒ 不留两套做同一件事。
 *
 * ⇒ 图层容器上只会出现 `LayerEffects` 那几样：`opacity` / `blend` / `backdrop` / `filter` / `mask`。
 */
function emitLayer(layer: Layer, ctx: EmitCtx): string {
  // ⚠️ **隐藏的图层不产出任何 DOM**（用户 2026-10-16）——不是 `display:none`，是根本不存在：
  //    这样"分层截图 / 命中测试"天然看不到它，不用到处加判断。
  if (layer.visible === false) return '';
  // ⚠️ `locked` **渲染完全忽略** —— 它只给编辑器用，不是视觉字段（所以也不进 `unsupported`）。
  const id = layer.id;
  const no = (field: string, reason: string) => ctx.no(id, field, reason);

  const style = css([
    'position:absolute',
    'left:0',
    'top:0',
    'width:100%',
    'height:100%',
    ...(visualCss(layer, ctx.opts.assets, no).filter(Boolean) as string[]),
  ]);
  const kids = layer.elements.map((c) => emitElement(c, ctx)).join('\n');
  return `<div class="vg" data-layer="${escAttr(id)}" data-layer-type="layer" style="${style}">${kids}</div>`;
}

/**
 * **渲染任意一个元素**（含嵌套）—— 组要靠它递归。
 *
 * `svg` / `group` 两类节点原先**整类没做**（一进来就报 unsupported、产物是一句注释）；
 * 现在都走这里：`svg` → 一个 `<img>`；`group` → 铺满画布的容器 + 递归子元素。
 */
function emitElement(node: ElementNode, ctx: EmitCtx): string {
  const id = node.id;
  const no = (field: string, reason: string) => ctx.no(id, field, reason);
  const note = (field: string, reason: string) => ctx.note(id, field, reason);

  // 组：本身不画东西，只有容器 + 子元素
  if (node.type === 'group') return emitGroup(node, ctx);

  const b = boxOf(node.rect);
  const isText = node.type === 'text';
  // ⚠️ **文字不许被 `transform` 缩放** —— 大小归 `fontSizePx`、形状归字体文件。
  //    丢掉它（产物里不再压扁）+ 报出来（进模型的反馈回路）。见 `effectiveTransform`。
  const nodeTransform = effectiveTransform(node);
  if (isText && node.transform?.scale) {
    no(
      'transform.scale',
      '文字不能用 scale —— 大小归 fontSizePx（要放大请把 rect 与 fontSizePx 一起乘），形状归字体文件',
    );
  }
  // ⚠️ **坏值体检**：`undefined` / `NaN` / 字符串 拼进 CSS 是**非法值** ⇒ 浏览器丢掉的是
  //    **整条** `transform`（`scale(undefined,2)` 会把同一行好好的 `rotate` 一起带走 —— 实测）。
  //    `transformList` 已经**不拼**这些项了，这里只负责**报出来**（绝不静默）。
  for (const f of badTransformFields(nodeTransform)) {
    no(
      f,
      '值不是有穷数（undefined / NaN / 字符串）—— 这一项**没写进** CSS；写进去会让整条 transform 被浏览器丢掉（连 rotate 一起）',
    );
  }
  // ⭐ shape 统一走内嵌 `<svg>` —— 它的 fill / stroke / 阴影 / 圆角都在 svg 里，
  //    **不走**下面那套 div 的 background / border。
  const isShape = node.type === 'shape';
  let visual = visualCss(node, ctx.opts.assets, no).filter(Boolean) as string[];
  if (isShape) visual = visual.filter((x) => !x.startsWith('filter:')); // shape 的 filter 在 svg 属性里

  const fill = !isText && !isShape && typeof node.fill === 'string' ? `background:${node.fill}` : '';
  const fillArr =
    !isText && !isShape && Array.isArray(node.fill)
      ? joinCss([`background-image:${[...node.fill].reverse().join(',')}`, 'background-color:transparent'])
      : '';
  if (!isText && !isShape && Array.isArray(node.fill) && node.fill.some((v) => !isPlainColor(v))) {
    note('fill', '多层填充按数组倒序铺（词汇里"后面的压在前面的上面"）；图案的平铺 / 尺寸 / 位置仍用 CSS 默认值');
  }

  const fit = ctx.opts.fits?.[id] ?? 1; // 装填系数（外部实测后传进来，见 EmitOptions.fits）
  const t = node as TextNode;
  const inner = isText
    ? t.path || t.curve
      ? // ⚠️ **另一条渲染路径**（SVG `<textPath>`）—— 与下面的 DOM 排版不是一套东西
        emitPathText(t, fit, note)
      : emitText(t, fit, no, note, ctx.extraCss)
    : isShape
      ? emitShape(node, no, note, ctx.defs, ctx.opts.assets)
      : node.type === 'svg'
        ? emitSvg(node, ctx, no)
        : emitImage(node as ImageNode, ctx.opts, no);

  // ⚠️ shape 的阴影在 svg 里做（见 `emitShape`），这里不重复给
  const shadowDecl = shadowCss(isShape ? undefined : node.shadow, b, no, node.filter);
  if (shadowDecl.startsWith('filter:')) visual = visual.filter((x) => !x.startsWith('filter:'));
  const style = css([
    'position:absolute',
    boxCss(b),
    radiusCss(isShape ? undefined : node.radius, b),
    fill,
    fillArr,
    transformCss(nodeTransform),
    ...visual,
    shadowDecl,
    node.type === 'image' ? strokeCss(node.stroke, ctx.opts.assets, no) : '',
  ]);

  return `<div class="vl" data-layer="${escAttr(id)}" data-layer-type="${escAttr(node.type)}" style="${style}">${inner}</div>`;
}

/**
 * **主入口**：一份文档 → 自包含 HTML（+ 两张问题表）。
 *
 * ## 产物结构的三个锚点（编辑器与测量都靠它们）
 *
 * | 锚点 | 打在哪 | 谁用 |
 * |---|---|---|
 * | `data-layer="<id>"` | 每个节点的容器 | 命中测试 · 覆盖层定位 · 分层截图 |
 * | `data-layer-type` | 同上 | 编辑器区分节点类别 |
 * | `data-fit="<id>"` | 文字**内层** `.vt` | 文字自适应测量 · 就地编辑挂 `contentEditable` |
 * | `data-run="<i>"` | 每个片段 `<span>` | 选区 ↔ `runs[i]` 的翻译 |
 *
 * ⚠️ **子文档里 `<script>` 数恒为 0** —— 这是可机器断言的不变量
 * （iframe 用 `sandbox="allow-same-origin"`，**故意不给** `allow-scripts`）。
 */
// ══════════════════════════════════════════════════════════════════════
// 【单发射】—— 给宿主的"双写"用（插入 iframe 而不重渲整页）
// ══════════════════════════════════════════════════════════════════════

/**
 * **单发射**：把一个元素 / 一个图层渲染成一段**自包含**的 HTML。
 *
 * ## 为什么必须"自包含"
 *
 * `emitElement` / `emitLayer` 把 clip-path / mask 要用的 `<defs>`、以及个别 `@font-face`
 * 之类的东西塞进 `ctx.defs` / `ctx.extraCss`（**整份文档共用的侧信道**）。
 * 单独发一块出来时，目标文档里**没有那份 defs** ⇒ clip / mask 会**静默失效**
 * （不报错、就是没效果 —— 最难查的那一类）。
 *
 * ⇒ 这里把这段产出需要的东西**一并内联**返回：
 *   - `defs` → 一段 `width:0;height:0` 的隐藏 `<svg>`
 *   - `extraCss` → 一段 `<style>`
 * 放在元素前面一起返回，宿主整段 `insertAdjacentHTML` 进去就是对的。
 *
 * ## 为什么需要它（而不是让宿主自己拼 HTML）
 *
 * 宿主"双写"时如果**手写**节点，和 `emitDocument` 的输出必然逐渐漂开
 * （差一个 `transform-origin`、一个 `data-fit`，出图就和画布不一样）。
 * 用这个函数发出来的那一块，和整份渲染**是同一段代码产的** ⇒ 不可能漂。
 *
 * ⚠️ 单发射只对 **clip/mask 的 defs 与 extraCss** 自包含；它**不**负责
 *    父子关系（插到哪个容器、第几个位置）—— 那是调用方的事。
 */
function singleCtx(canvas: DesignDocument['canvas'], opts: EmitOptions, unsupported: EmitIssue[], notes: EmitIssue[]): EmitCtx {
  return {
    C: canvas,
    opts,
    extraCss: [],
    defs: [],
    no: (id, field, reason) => unsupported.push({ id, field, reason }),
    note: (id, field, reason) => notes.push({ id, field, reason }),
  };
}

/** 把 ctx 收集到的 defs / extraCss 拼到产物前面，让它自包含 */
function selfContained(body: string, ctx: EmitCtx): string {
  const style = ctx.extraCss.length ? `<style>${ctx.extraCss.join('\n')}</style>` : '';
  const defs = ctx.defs.length
    ? `<svg width="0" height="0" style="position:absolute;left:-9999px" aria-hidden="true">${ctx.defs.join('')}</svg>`
    : '';
  return `${style}${defs}${body}`;
}

export interface EmitSingleResult {
  /** 自包含的一段 HTML（含它自己需要的 defs / style） */
  html: string;
  unsupported: EmitIssue[];
  notes: EmitIssue[];
}

/** 单发射一个**元素**（见上面 `singleCtx` 的说明） */
export function emitElementHtml(
  node: ElementNode,
  canvas: DesignDocument['canvas'],
  opts: EmitOptions = {},
): EmitSingleResult {
  const unsupported: EmitIssue[] = [];
  const notes: EmitIssue[] = [];
  const ctx = singleCtx(canvas, opts, unsupported, notes);
  const body = emitElement(node, ctx);
  return { html: selfContained(body, ctx), unsupported, notes };
}

/** 单发射一个**图层**（整块容器 + 它的元素；图层容器还没插进文档时用这个） */
export function emitLayerHtml(
  layer: Layer,
  canvas: DesignDocument['canvas'],
  opts: EmitOptions = {},
): EmitSingleResult {
  const unsupported: EmitIssue[] = [];
  const notes: EmitIssue[] = [];
  const ctx = singleCtx(canvas, opts, unsupported, notes);
  const body = emitLayer(layer, ctx);
  return { html: selfContained(body, ctx), unsupported, notes };
}

export function emitDocument(doc: DesignDocument, opts: EmitOptions = {}): EmitResult {
  const unsupported: EmitIssue[] = [];
  const notes: EmitIssue[] = [];
  const extraCss: string[] = [];
  const defs: string[] = [];
  const C = doc.canvas;
  const ctx: EmitCtx = {
    C,
    opts,
    extraCss,
    defs,
    no: (id, field, reason) => unsupported.push({ id, field, reason }),
    note: (id, field, reason) => notes.push({ id, field, reason }),
  };

  const layers = doc.layers.map((l) => emitLayer(l, ctx));

  // ⭐ 画布底色支持多层（数组最后一个在最上，与节点 fill 同一口径）
  // ⚠️ **省略 = 白底**，而且要**真的写出 `#FFFFFF`** —— 不能拼成字面量 `background:undefined`
  //    （那是非法值 ⇒ 浏览器丢掉这条 ⇒ 白底就变成"碰巧的"：靠的是截图合成，不是 CSS）。
  const canvasBg = Array.isArray(C.background)
    ? joinCss([`background-image:${[...C.background].reverse().join(',')}`, 'background-color:transparent'])
    : `background:${C.background ?? '#FFFFFF'}`;

  // ⚠️⚠️ **模板字符串里的每一个字符都会成为交付产物的一部分** ——
  //    注释**一个字都不许写进去**（写进去就跟着 HTML 发到 Amazon 那边了）。
  //    要解释产物结构，注释写在这条 `const html = ...` **上面**，像下面这样：
  //
  // 产物骨架（顺序即文档结构）：
  //   `<style>`  全局重置 + 三条基础规则 + `${extraCss}`（首字下沉这类内联 style 写不出的）
  //              + `${faceCss}`（@font-face，由调用方以值注入）
  //   `<div class="vc">`  画布：固定宽高 + 底色，`overflow:hidden` 当画框
  //   `<svg width=0 height=0><defs>`  渐变 / 图案 / 内阴影的 filter —— **只在有 `<defs>` 时输出**
  //   `${layers}`  每个顶层节点一个容器（`data-layer` 是编辑器的命中锚点）
  //
  // ⚠️ `.vg{pointer-events:none}` + 子元素 `auto` 的原因：组容器**铺满画布**（组没有 `rect`），
  //    如果它吃鼠标，点击会**一律命中它**，画布上什么都选不中
  //    （实测踩过 —— 一下午的"顶点手柄拿不到位置"就是这个）。
  //    父 none + 子 auto ⇒ 事件穿透到组内子元素，正是想要的。
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<style>
html,body{margin:0;padding:0;background:transparent}
*,*::before,*::after{box-sizing:border-box}
body{font-family:Georgia,"Times New Roman",serif}
.vc{position:relative;overflow:hidden}
.vt{position:absolute}
.vg{pointer-events:none}
.vg .vl{pointer-events:auto}
.vg .vg .vl{pointer-events:auto}
${extraCss.join('\n')}
${opts.faceCss ?? ''}
</style>
</head>
<body>
<div class="vc" style="width:${C.width}px;height:${C.height}px;${canvasBg}">
${defs.length ? `<svg width="0" height="0" style="position:absolute"><defs>${defs.join('')}</defs></svg>` : ''}
${layers.join('\n')}
</div>
</body></html>`;

  return { html, unsupported, notes };
}
