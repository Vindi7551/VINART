/**
 * ═══════════════════════════════════════════════════════════════════════
 * 渲染共享层 —— 草图渲染器与成品渲染器共用的地基
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 两套渲染器（`sketch.ts` / `render.ts`）都需要「几何换算 · 容器包装 ·
 * 形状 · 变换」，放在任何一侧都会造成反向依赖，所以提到最底层。
 *
 * ⚠️ 本文件**不得 import 任何渲染器**（否则成环）。它只依赖契约。
 */

import type { Canvas, Node } from './design-sketch';
import type { LayerAppearance } from './design-appearance';

/**
 * 渲染器实际拿到的东西：**契约节点 + 外观合并后的结果**。
 *
 * 契约里没有颜色 / 描边（它们在 `design-appearance.json`），
 * 但渲染时两者已经按 id 合并了——所以这里的类型是「节点 & 外观」。
 */
export type Painted = Node & Partial<LayerAppearance>;

// ══════════════════════════════════════════════════════════════════════
// 基础换算
// ══════════════════════════════════════════════════════════════════════

/** 把 0–1 比例换算成 px */
export const px = (v: number, base: number) => Math.round(v * base);

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ══════════════════════════════════════════════════════════════════════
// 盒子
// ══════════════════════════════════════════════════════════════════════

/** 一个节点容器的几何（px） */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL = (C: Canvas): Box => ({ x: 0, y: 0, w: C.width, h: C.height });

/**
 * 节点的盒子（px）。
 *
 * ★ **只有一种算法** —— 因为契约里**每个节点都有 `rect`，且都相对画布**。
 *
 * 旧契约有 18 个分支（盒子类用 `x/y/w/h`、圆类用 `cx/cy/d`、
 * `subtext` 还要按字号估高度…），现在全部塌缩成这一行。
 * **这是「三类节点 + 统一 rect」最直接的回报。**
 */
export function layerBox(l: Node, C: Canvas): Box {
  return {
    x: px(l.rect.x, C.width),
    y: px(l.rect.y, C.height),
    w: px(l.rect.w, C.width),
    h: px(l.rect.h, C.height),
  };
}

// ══════════════════════════════════════════════════════════════════════
// 形状 → CSS
// ══════════════════════════════════════════════════════════════════════

/**
 * 形状 → CSS 片段（圆角或裁切）。返回空串 = 普通矩形。
 *
 * ⚠️ **草图与成品共用这一套** —— 所以草图上"看起来是个拱门"，
 * 成品就真的是个拱门，不会两处各写一遍而走样。
 *
 * 只用两种 CSS 手段：`border-radius`（能跟随盒模型）与 `clip-path`（任意轮廓）。
 * 优先 `border-radius`——它参与盒模型，描边、圆角、裁切都更自然。
 */
export function shapeCss(l: Node, box: Box): string {
  const short = Math.min(box.w, box.h);
  const parts: string[] = [];

  // 形状专属的轮廓（rect 的圆角统一在下面处理）
  if (l.type === 'shape') {
    switch (l.shape) {
      case 'ellipse':
        parts.push('border-radius:50%');
        break;

      case 'arch': {
        // 拱门 = 顶部半圆 + 下方矩形。
        // 水平半径取 50%（= 半宽）；垂直半径要把「半宽」换算成占框高的百分比
        // —— 这样弧线正好是半圆，而不是被拉扁的椭圆。
        const vPct = box.h === 0 ? 50 : Math.min(100, ((box.w / 2) / box.h) * 100);
        const v = `${vPct.toFixed(2)}%`;
        parts.push(`border-radius:50% 50% 0 0 / ${v} ${v} 0 0`);
        break;
      }

      case 'triangle':
        // 尖朝上。要朝别的方向用 transform.rotate —— 形状本身只有一种。
        parts.push('clip-path:polygon(50% 0%,100% 100%,0% 100%)');
        break;

      case 'rect':
        break;
    }
  }

  // 圆角（radius：相对短边的比例 0–0.5，0.5 即胶囊）。
  // **任何节点**都可以带：ShapeNode 是自有字段，image/text 来自外观合并
  // （appearance 按 id 配，见 LayerAppearance.radius）。
  //
  // ⚠️ 必须同时给 `overflow:hidden` —— `border-radius` 只裁容器自身的
  // 背景与边框，**不裁子元素**；照片是容器里的 `<img>` 子元素，
  // 不裁的话方角会从圆角框角上露出来（实测 goose-PT08）。
  // 容器是节点自己的壳（拆层时与子节点一体），在这里裁剪不违反
  // 「节点不得依赖父容器」——依赖的是自己的 wrap，不是祖先。
  const radius = (l as Painted).radius;
  if (radius) {
    parts.push(`border-radius:${Math.round(radius * short)}px`, 'overflow:hidden');
  }

  return parts.join(';');
}

// ══════════════════════════════════════════════════════════════════════
// 变换 → CSS
// ══════════════════════════════════════════════════════════════════════

/**
 * `transform` → CSS 片段。空串 = 不变换。
 *
 * ## ⚠️ 两处容易错的地方
 *
 * **1. `skewX` 的单位不一样。** 契约里它是「顶边相对底边，水平偏移
 * **若干倍框宽**」的比例；而 CSS 的 `skewX()` 收的是**角度**。
 * 换算：`tan(θ) = 比例 × 框宽 / 框高`。
 * 所以同一个 `skewX: 0.15`，在一个扁框和一个高框上视觉斜度不同 —— 这是
 * **契约有意的**（"顶边错开框宽的 15%"是个视觉意图，不是固定角度）。
 *
 * **2. 顺序必须是「先斜切、后旋转」**，与 CSS 的 `rotate() skewX()` 一致。
 * 校验器里算"变换后溢出画布"用的也是这个顺序 —— 两处必须一样。
 */
export function transformCss(l: Node, box: Box): string {
  const t = l.transform;
  if (!t) return '';

  const tr: string[] = [];
  if (t.rotate) tr.push(`rotate(${t.rotate}deg)`);
  if (t.skewX) {
    const slant = box.h === 0 ? 0 : (t.skewX * box.w) / box.h; // 每单位 y 的 x 偏移
    const deg = (Math.atan(slant) * 180) / Math.PI;
    // 直接写 `skewX(θ)` —— 浏览器执行的正是矩阵 (1,0,tanθ,1,0,0)，
    // 与上面 `slant` 的定义逐字对应。
    tr.push(`skewX(${deg.toFixed(4)}deg)`);
  }
  if (!tr.length) return '';

  const parts = [`transform:${tr.join(' ')}`];
  if (t.origin) {
    const ox = (t.origin.x * 100).toFixed(3);
    const oy = (t.origin.y * 100).toFixed(3);
    parts.push(`transform-origin:${ox}% ${oy}%`);
  }
  return parts.join(';');
}

// ══════════════════════════════════════════════════════════════════════
// 外观（描边）→ CSS
// ══════════════════════════════════════════════════════════════════════

/**
 * 描边 → CSS。**颜色与线宽来自外观文件**，这里只负责画出来。
 *
 * 用 `outline` 而不是 `border`：不占盒模型空间，且跟随 `border-radius`。
 * `outline-offset` 取负值 = 向内描。
 *
 * ⚠️ `outline` **不跟随 `clip-path`** —— 三角形/斜切这类轮廓想要描边，
 * 得叠一层或另想办法（当前契约里形状的描边属于"以后再说"）。
 */
function strokeCss(l: Painted): string {
  if (!l.stroke) return '';
  return `outline:${l.stroke.width}px solid ${l.stroke.color};outline-offset:-${l.stroke.width}px`;
}

// ══════════════════════════════════════════════════════════════════════
// 容器包装
// ══════════════════════════════════════════════════════════════════════

/**
 * 把节点内容包进**唯一的容器**，并打上识别属性。
 *
 * 这是「规则：每个节点落成一个带 `data-layer` 的容器」的落点——拆层工具靠它
 * 知道"哪些是节点"，才能"隐藏其它、只留目标"。
 *
 * 容器内可以再嵌套，**但不再带 `data-layer`**。
 *
 * ⚠️ 容器必须用**节点自己的盒子**，不能用整幅画布：
 * 各节点的渲染函数内部一律用**相对节点盒子**的坐标。
 * 若容器设成整幅画布，内部坐标就少偏移了一个 `box.x/box.y`，
 * 节点会跑到错误位置（实测踩过：草图里底部通栏横幅的灰条跑到了画面顶部）。
 */
export function wrap(l: Painted, box: Box, inner: string, background?: string): string {
  const attrs = [
    `class="dl"`,
    `data-layer="${escapeAttr(l.id)}"`,
    `data-layer-type="${l.type}"`,
    `data-layer-source="${l.type === 'image' ? 'img' : 'html'}"`,
  ];
  if (l.name) attrs.push(`data-layer-name="${escapeAttr(l.name)}"`);

  const style = [
    `left:${box.x}px`,
    `top:${box.y}px`,
    `width:${box.w}px`,
    `height:${box.h}px`,
  ];
  // ⚠️ 形状块的**填充加在容器自己身上**，不是往里铺一个 div ——
  // 因为 `border-radius` 只裁容器自身的背景与边框，**不裁剪子元素**。
  // （实测：往里铺 div 时，`ellipse` / `arch` 在草图上仍是方框。）
  const extra = [
    background ? `background:${background}` : '',
    shapeCss(l, box),
    transformCss(l, box),
    strokeCss(l),
  ].filter(Boolean);
  if (extra.length) style.push(extra.join(';'));

  return `<div ${attrs.join(' ')} style="${style.join(';')}">${inner}</div>`;
}

// ══════════════════════════════════════════════════════════════════════
// 素材键
// ══════════════════════════════════════════════════════════════════════

/**
 * 素材文件名 → 占位符键（如 `scene-prep.png` → `SCENE_PREP_PNG`）。
 *
 * ⚠️ 必须在**生成占位符**和**收集 assets 映射**两处用同一个函数。
 * 早先两边各写各的（一边 emit `{{scene.png}}`、一边收集 `SCENE_PNG`），
 * 占位符永远替换不上，渲染出来是断图的空壳。
 */
export function assetKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}
