/**
 * ═══════════════════════════════════════════════════════════════════════
 * 成品渲染器 —— DesignSketch → 成品 HTML
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 输入一份 `DesignSketch`（已与外观合并），输出一份自包含的 HTML
 * （图用 `{{KEY}}` 占位，由 `emit-html.ts` 替换成 data URL 或相对路径）。
 *
 * 草图那条路在 `./sketch`——两套渲染**共用** `./shared` 的几何、
 * 形状与变换，所以同一份 spec 的草图和成品的区域位置天然一致。
 *
 * ## 三个刻意的实现决定
 *
 * **1. 不用 z-index。**
 * 所有节点都是 `.canvas` 的绝对定位直接子节点，**DOM 顺序即叠放顺序**。
 * 这既省掉了一堆 z-index 维护，也让"顺序是数据不是副作用"这条规则自然成立。
 *
 * **2. 每个节点落成一个带 `data-layer` 的容器。**
 * 容器内部结构自由。这是「DOM → 分层 canvas」的前提。
 *
 * **3. 节点不得依赖父容器实现效果。**
 * 不能靠父级的 `background` / `opacity` / `filter` 来让某节点显得对。
 * 每个节点必须能被单独截出来而不变样——拆层时要中性化所有祖先背景。
 */

import type { Canvas, DesignSketch, ImageNode, Node, Rect, TextNode } from './design-sketch';
import { DEFAULT_TYPOGRAPHY, PALETTE, type Palette, type Typography } from './render-style';
import { assetKey, escapeAttr, escapeHtml, layerBox, wrap, type Painted } from './shared';
import { renderSketchBody, SKETCH_CSS } from './sketch';

// ══════════════════════════════════════════════════════════════════════
// 排版（可注入）
// ══════════════════════════════════════════════════════════════════════

/**
 * 文字适配系数表：`{ '<节点 id>': 缩放比例 }`。
 *
 * 为什么需要：字号写死时，文字装不下会**换行**，把版式撑破。
 * 纯 CSS 没有"自动缩到装得下"的能力，所以由驱动脚本先量一遍再回填。
 */
export type FitMap = Record<string, number>;

export interface RenderOptions {
  mode?: 'final' | 'sketch';
  fits?: FitMap;
  palette?: Palette;
  typography?: Typography;
  /**
   * 草图辅助网格的密度。
   * - `true`（默认）= 12 等分（见 `sketch.ts` 的 `GRID_STEP`）
   * - `false` = 不画
   * - **数字** = 每格占画布的比例（如 `0.05` = 20 格）
   */
  grid?: boolean | number;
}

interface Print {
  pal: Palette;
  typ: Typography;
  fits: FitMap;
}

/**
 * 解析颜色：外观里的 `color` 可能是**调色板角色名**、**直接色值**，
 * 或历史遗留的 `"custom"` + `customColor` 两字段写法。三种都认。
 */
function resolveColor(app: Painted, pal: Palette, fallback: string): string {
  const c = app.color;
  if (!c) return fallback;
  if (c === 'custom') return app.customColor ?? fallback;
  // rgba()/rgb() 直接色值原样放行——此前它们不以 # 开头、查角色表也查不到，
  // 会被吞成 fallback，写透明度降级的次级文字颜色根本落不了地
  if (c.startsWith('#') || c.startsWith('rgb')) return c;
  const role = (pal as unknown as Record<string, string>)[c];
  return role ?? fallback;
}

// ══════════════════════════════════════════════════════════════════════
// 压图文字的可读性兜底
// ══════════════════════════════════════════════════════════════════════
//
// 实测教训（goose-PT06/PT07）：compile 不写颜色（颜色属外观文件），没有
// 外观时文字全部走 palette.ink（近黑），直接压在深色场景照片上就"消失"。
// 外观文件是设计决策（正道），但总有漏配的版式——渲染器按「文字是否
// 直接叠在照片上且中间没有不透明底板」自动加一层反相半透明底衬。
// 显式设计永远优先：appearance 给 shape 配了 fill，底板就不透明，
// 这条兜底自动让位——「显式优先、兜底兜漏」。

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 找出所有「直接压在照片上」的文字节点 id。
 * 从文字节点沿 DOM 顺序**往回**找第一个与它矩形相交的节点：
 * 是 image → 压图；是不透明底板 shape（有 fill）→ 有板，安全；否则继续往回。
 */
function overlayTextIds(spec: DesignSketch): Set<string> {
  const out = new Set<string>();
  const L = spec.layers;
  for (let i = 0; i < L.length; i++) {
    const t = L[i];
    if (t.type !== 'text') continue;
    for (let j = i - 1; j >= 0; j--) {
      const b = L[j];
      if (!rectsOverlap(t.rect, b.rect)) continue;
      if (b.type === 'image') {
        out.add(t.id);
        break;
      }
      if (b.type === 'shape') {
        const f = (b as Painted).fill;
        if (f && f !== 'transparent') break; // 有不透明底板
      }
    }
  }
  return out;
}

/** 简化相对亮度（0=黑 1=白）；非 hex 色值按深色处理 */
function colorLuminance(hex: string): number {
  const m = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return 0;
  const ch = (i: number) => parseInt(m.slice(i, i + 2), 16) / 255;
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

/** 按文字色亮度配反相底衬：深字 → 白衬，浅字 → 深衬 */
function plateFor(color: string): string {
  return colorLuminance(color) >= 0.55
    ? 'rgba(20,15,10,.78)'
    : 'rgba(255,252,246,.9)';
}

/**
 * 单行文字 → HTML：先做**句中强调**分段（外观 accent 指定的词染强调色），
 * 再逐段 HTML 转义。分段在转义**前**做——在纯文本上按原词匹配，
 * 转义后的串里 `&` 已变成 `&amp;`，含特殊字符的词会匹配失败。
 */
function renderLine(t: string, acc: Painted['accent'], pal: Palette): string {
  const words = acc?.words?.filter(Boolean) ?? [];
  if (!words.length) return escapeHtml(t);
  const safe = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const color = resolveColor({ color: acc!.color } as Painted, pal, acc!.color ?? '');
  const re = new RegExp(`(${safe.join('|')})`, 'g');
  return t
    .split(re)
    .map((seg, i) =>
      i % 2 === 1 ? `<span style="color:${color}">${escapeHtml(seg)}</span>` : escapeHtml(seg),
    )
    .join('');
}

/**
 * 把图层颜色字段里的**调色板角色名**统一解析成色值。
 *
 * ⚠️ 必须在渲染前做：`shape` 的 fill、`stroke.color` 等此前是**原样内插**进 CSS 的，
 * 角色名（如 `cream` / `copper`）不是合法 CSS 色，浏览器静默丢弃 →
 * 横幅变透明、描边消失（实测 goose-PT06 底部横幅消失、PT02 白框意外可见）。
 * `text` 的主色早就走 `resolveColor`，这里把其余字段拉齐到同一行为。
 * 渐变等非角色名值查不到表 → 原样放行，不受影响。
 */
function resolveLayerColors(layers: Node[], pal: Palette): Node[] {
  const table = pal as unknown as Record<string, string>;
  const res = (v: string): string =>
    v && !v.startsWith('#') && v !== 'custom' && v !== 'transparent' && table[v] ? table[v] : v;
  const COLOR_KEYS = ['fill', 'color', 'customColor', 'textColor', 'iconColor', 'background'] as const;
  const STROKE_KEYS = ['stroke', 'ring', 'edgeLine', 'edgeHighlight'] as const;
  return layers.map((l) => {
    const src = l as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const k of COLOR_KEYS) {
      const v = src[k];
      if (typeof v === 'string') patch[k] = res(v);
    }
    for (const k of STROKE_KEYS) {
      const s = src[k] as { color?: string } | undefined;
      if (s && typeof s.color === 'string') patch[k] = { ...s, color: res(s.color) };
    }
    return Object.keys(patch).length ? ({ ...l, ...patch } as Node) : l;
  });
}

// ══════════════════════════════════════════════════════════════════════
// 三类节点的渲染
// ══════════════════════════════════════════════════════════════════════

/** 图 —— 一张照片 / 场景 / 商品图 */
function renderImage(l: ImageNode): string {
  const fit = l.fit ?? 'cover';
  return (
    `<img src="{{${assetKey(l.asset)}}}" alt="" ` +
    `style="width:100%;height:100%;object-fit:${fit};display:block">`
  );
}

/**
 * 文字 —— 所有文字（主标题 / 副标题 / 标注 / 脚注）都用它，
 * 层级靠 `fontScale` + `weight` + 颜色拉开。
 *
 * ⚠️ **一律不换行**（`nowrap`）——装不下时靠 `fits` 系数缩字号。
 * 折行会撑破版式，比字号小一点糟得多。
 */
function renderText(l: TextNode, C: Canvas, p: Print, overlay: boolean): string {
  const app = l as Painted;
  const lines = Array.isArray(l.text) ? l.text : [l.text];
  const fit = p.fits[l.id] ?? 1;
  const fs = Math.max(6, Math.round((l.fontScale ?? 0.03) * C.width * fit));
  const align = l.align ?? 'left';
  const weight = l.weight ?? p.typ.bodyWeight;
  const color = resolveColor(app, p.pal, p.pal.ink);
  // 字体族：外观按节点覆盖（标签/注记换族拉层级）；默认全用标题字体。
  // ⚠️ 内插进 style="..." 属性——family 栈含双引号（如 "Times New Roman"），
  // 不转义会把属性提前截断，后面整段声明（含 font-size）静默失效，
  // 文字回落浏览器默认 16px（实测 PT04 标题缩成小字）。
  const family = escapeAttr(app.fontFamily ?? p.typ.headingFamily);
  const html = lines.map((t) => renderLine(t, app.accent, p.pal)).join('<br>');

  // 压图兜底：底衬加在 data-fit 外层（宽度=设计区宽的横条）。
  // ⚠️ 不能包进 .btfit——测量逻辑量的是它的 scrollWidth/clientWidth，
  // 改成 inline-block 后 avail 恒等于 need，fits 缩放会静默失效。
  const plate = overlay
    ? `background:${plateFor(color)};border-radius:0.4em;padding:0.25em 0.55em;`
    : '';

  // 外层 data-fit 供文字自适应测量（final 阶段量 `[data-fit=id]` 内
  // `.btfit` 的 scrollWidth/clientWidth）；内层 .btfit 是 nowrap 的文字本体——
  // 宁可缩字号也不折行。
  //
  // 垂直居中：compile 常把文字 rect 定成与底板（铭牌/标签条/横幅）完全重合，
  // 意图是「文字充满底板」；顶对齐会让底部留空、视觉偏上（实测 PT02 铭牌）。
  // 所以文字一律在自身 rect 内垂直居中——绝对定位 + translateY(-50%) 是纯
  // 视觉位移，不参与布局计算（对齐、间距仍按 rect 算）；left/right:0 + 
  // text-align 保留水平对齐语义；.btfit 宽度=容器宽，fits 测量逻辑不变。
  return (
    `<div data-fit="${l.id}" style="${plate}position:relative;width:100%;height:100%">` +
    `<div class="sub btfit" style="position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);white-space:nowrap;text-align:${align};` +
    `color:${color};font-family:${family};font-size:${fs}px;font-weight:${weight};line-height:1.15">${html}</div>` +
    `</div>`
  );
}

function renderNodeFinal(
  l: Node,
  C: Canvas,
  p: Print,
  overlay: Set<string>,
): string {
  const box = layerBox(l, C);
  let inner = '';
  /** 形状块的填充色（加在容器上——`border-radius` 不裁子元素，见 `shared.wrap`）*/
  let background: string | undefined;

  switch (l.type) {
    case 'image':
      // 照片圆角由 wrap 容器负责（shapeCss：border-radius + overflow:hidden，
      // radius 来自外观合并）——与 shape 的圆角走同一条 CSS 管线
      inner = renderImage(l);
      break;
    case 'text':
      inner = renderText(l, C, p, overlay.has(l.id));
      break;
    case 'shape':
      // 形状**没有内容**——它就是一块色。轮廓与填充都由容器负责。
      background = (l as Painted).fill ?? 'transparent';
      break;
  }
  return wrap(l as Painted, box, inner, background);
}

// ══════════════════════════════════════════════════════════════════════
// 工具
// ══════════════════════════════════════════════════════════════════════

/** 需要实测文字宽度的节点 id（供驱动脚本做适配测量）*/
export function fitTargets(spec: DesignSketch): string[] {
  return spec.layers.filter((n) => n.type === 'text').map((n) => n.id);
}

/** 校验：id 必须唯一（拆层与适配都靠它） */
export function validateSpec(spec: DesignSketch): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const n of spec.layers) {
    if (!n.id) errs.push(`节点缺少 id：${n.type}`);
    else if (seen.has(n.id)) errs.push(`节点 id 重复：${n.id}（id 必须唯一）`);
    seen.add(n.id);
  }
  return errs;
}

// ══════════════════════════════════════════════════════════════════════
// 主入口
// ══════════════════════════════════════════════════════════════════════

export function renderDesign(
  spec: DesignSketch,
  opts: RenderOptions = {},
): { html: string; assets: Record<string, string> } {
  const mode = opts.mode ?? 'final';
  const pal = opts.palette ?? PALETTE;
  const typ = opts.typography ?? DEFAULT_TYPOGRAPHY;
  const fits = opts.fits ?? {};
  const C = spec.canvas;

  const errs = validateSpec(spec);
  if (errs.length) throw new Error('DesignSketch 校验失败：\n  ' + errs.join('\n  '));

  const p: Print = { pal, typ, fits };

  // ── DOM 顺序的唯一来源 ──
  // 顺序**只**由这里决定：按 `spec.layers` 数组顺序逐个渲染，再顺序拼接。
  // 数组下标 0 → 拼在最前 → DOM 里排最前 → 画在最下面。
  // 没有排序、没有按 y 坐标、没有 z-index。
  //
  // ⚠️ 必须保持**同步顺序 map**。若将来改成 `Promise.all` 并行渲染再拼，
  // 完成顺序不保证 → DOM 顺序会随机错乱，且只在并发时偶现。下面的顺序守卫会报错。
  const finalLayers = mode === 'final' ? resolveLayerColors(spec.layers, pal) : spec.layers;
  const sketchCss = mode === 'sketch' ? SKETCH_CSS : '';
  // 压图分析只在成品模式做——草图本来就是灰阶示意
  const overlay = mode === 'final' ? overlayTextIds({ ...spec, layers: finalLayers }) : new Set<string>();
  const body =
    mode === 'sketch'
      ? renderSketchBody(spec.layers, C, opts.grid ?? true)
      : finalLayers.map((l) => renderNodeFinal(l, C, p, overlay)).join('\n');

  // 收集素材占位符 → 文件名（供 emit-html 替换）。
  //
  // ⚠️ **只在成品模式收集**。草图模式不引用任何图片（只画图位框），
  // 若也收集就会去读还不存在的素材而报 ENOENT ——
  // 那等于"必须先有素材才能出版式草图"，把顺序搞反了。
  const assets: Record<string, string> = {};
  if (mode === 'final') {
    for (const l of spec.layers) {
      if (l.type === 'image') assets[assetKey(l.asset)] = l.asset;
    }
  }

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><style>
  ${typ.faceCss}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${C.width}px;height:${C.height}px}
  body{font-family:${typ.headingFamily}}
  /* 画布本身不设背景色——拆层时要把它中性化，这样每层能独立截出。
     背景由 shape 节点负责。 */
  .canvas{position:relative;width:${C.width}px;height:${C.height}px;overflow:hidden}

  /* 节点容器：绝对定位、不带 z-index —— DOM 顺序即叠放顺序。
     ★ isolation:isolate 是必需的，不是装饰：
     实测（scripts/_probe-zindex.ts）——若容器不创建层叠上下文，
     **容器内部的 z-index 会逃出来跟兄弟节点比较**，静默地跑到别的节点上面。
     加上它之后，内部 z-index 只在层内生效，层与层之间始终按 DOM 顺序。 */
  .dl{position:absolute;isolation:isolate}

  /* 文字 */
  .sub{font-family:${typ.headingFamily};
       letter-spacing:${typ.headingLetterSpacing};text-shadow:0 2px 9px rgba(0,0,0,.62)}
  ${sketchCss}
</style></head><body><div class="canvas">
${body}
</div></body></html>`;

  // ── 顺序守卫 ──
  // 确认 DOM 里 `data-layer` 的出现顺序与数组顺序一致。
  // 同步 map 下必然一致，但这条守卫能挡住未来某次改成异步后引入的
  // "顺序随机错乱"——那种 bug 只在并发下偶现，极难定位。
  if (mode === 'final') {
    const domOrder = [...html.matchAll(/data-layer="([^"]+)"/g)].map((m) => m[1]);
    const specOrder = spec.layers.map((l) => l.id);
    const same =
      domOrder.length === specOrder.length && domOrder.every((id, i) => id === specOrder[i]);
    if (!same) {
      throw new Error(
        '叠放顺序校验失败：DOM 里的节点顺序与 spec.layers 数组顺序不一致。\n' +
          '  数组: ' + specOrder.join(' -> ') + '\n' +
          '  DOM : ' + domOrder.join(' -> '),
      );
    }
  }

  return { html, assets };
}
