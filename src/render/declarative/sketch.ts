/**
 * ═══════════════════════════════════════════════════════════════════════
 * 草图渲染器 —— DesignSketch → 版式草图的 HTML
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 它回答的问题与成品渲染完全不同：
 *
 * | | 成品（`render.ts`） | 草图（本文件） |
 * |---|---|---|
 * | 画什么 | 照片 + 文字 + 颜色 | **只有图位框、灰条、形状块** |
 * | 用不用素材 | 用（`{{占位符}}`） | **不用**（所以素材没生成也能出图）|
 * | 用途 | 交付 | 给人审版式 / 喂生图模型当构图控制 |
 *
 * ## ★ 草图的视觉语言（唯一权威）
 *
 * | 符号 | 含义 | 谁用它 |
 * |---|---|---|
 * | **虚线框** `.sbox` | **这里要放一张图** | `image` |
 * | **灰条** `.sbar` | 这里是一行文字（**高度跟字号**）| `text` |
 * | **实心块** `.sfill` | 这里有一块已经定下来的面 | `shape` |
 * | **辅助网格** | 参照系，**不是设计元素** | —— |
 *
 * ⚠️ 上表是**规则**，不是描述。尤其是——**虚线只给"要放图"的节点**。
 * 别因为"没有别的符号可用"就借它，那会把「这里要放照片」稀释成
 * 「这里有一块东西」（旧契约就是这么走样的：18 种类型里有 7 种错用了虚线）。
 *
 * ## 形状与变换不用在这里管
 *
 * 它们由 `wrap()` 统一加在**容器**上（见 `shared.ts` 的 `shapeCss` /
 * `transformCss`）——所以草图和成品的形状与角度**天然一致**。
 *
 * ## 为什么草图上不放真实文案、只放灰条
 *
 * 实测：草图上写真实文字，生成模型会把那些字画进成品，而且必然出错字。
 */

import type { Canvas, Node } from '../../document/design-sketch';
import { escapeHtml, layerBox, wrap } from './shared';

/** 节点没有 `name` 时，草图上显示什么 */
const DEFAULT_LABEL: Record<Node['type'], string> = {
  image: '图位',
  text: '文字',
  shape: '形状',
};

// ══════════════════════════════════════════════════════════════════════
// 单个节点 → 草图标记
// ══════════════════════════════════════════════════════════════════════

function renderNodeSketch(l: Node, C: Canvas): string {
  const box = layerBox(l, C);
  const W = C.width;

  /**
   * 区域标签。
   *
   * ⚠️ 两条都踩过坑：
   * 1. **坐标是绝对的**（相对画布），`label()` 内部再减盒子原点 → 容器内相对定位
   * 2. **撞到画布顶部就改放到盒子内部**——否则标签会被画布上边缘裁掉一半
   *    （旧实现写死 `y - 34`，凡是贴着顶边的节点，标签都只剩半截）
   */
  const label = (): string => {
    const text = escapeHtml(l.name ?? DEFAULT_LABEL[l.type]);
    const wantY = box.y - 34;
    const y = wantY >= 0 ? wantY : box.y + 4;
    // 标签相对**容器**定位——容器左上角就是盒子原点，所以横向固定 0；
    // 纵向用「绝对 y − 盒子原点」得到容器内的偏移。
    return `<div class="slbl" style="left:0;top:${y - box.y}px">${text}</div>`;
  };

  switch (l.type) {
    // ── 图：虚线框（"这里要放一张图"）──
    case 'image':
      return (
        `<div class="sbox" style="left:0;top:0;width:${box.w}px;height:${box.h}px"></div>` +
        label()
      );

    // ── 文字：灰条（高度跟字号，宽度 = 块宽的 90%）──
    case 'text': {
      const lines = Array.isArray(l.text) ? l.text : [l.text];
      // 灰条**高度跟字号走**——否则草图上所有文字条一样粗，看不出层级。
      // 长度只是"这块占多宽"，**不代表字号**（VLM 验收时反复误读这点）。
      const fs = (l.fontScale ?? 0.03) * W;
      const barH = Math.max(8, Math.round(fs * 0.72));
      const step = lines.length > 1 ? box.h / lines.length : 0;
      // ⚠️ 灰条**必须居中于盒子**，不能左对齐。
      // 左对齐 + 90% 宽会让视觉中心偏左 `5% × 块宽`，于是：
      // ① VLM 报"文字没居中"（假问题）
      // ② **模型会去迎合它，把本来正确的版式改歪** ——
      //    实测：parfum-noir 那次，文字被从中心 0.50 挪到 0.53，成图比主体偏右 3%。
      const barW = Math.round(box.w * 0.9);
      const barX = Math.round((box.w - barW) / 2);
      const bars = lines
        .map(
          (_, i) =>
            `<div class="sbar" style="left:${barX}px;top:${Math.round(step * i)}px;` +
            `width:${barW}px;height:${barH}px"></div>`,
        )
        .join('');
      return bars + label();
    }

    // ── 形状：实心块（填充色由 wrap 加在容器上，形状才裁得准）──
    case 'shape':
      return label();
  }
}

/** 形状块在草图上用什么颜色（成品用外观里的 fill） */
const SKETCH_FILL = 'rgba(145,153,161,.26)';

// ══════════════════════════════════════════════════════════════════════
// 辅助网格
// ══════════════════════════════════════════════════════════════════════

/** 网格默认密度：12 列 × 12 行（能被 2 / 3 / 4 / 6 整除，等分方便）*/
export const GRID_STEP = 1 / 12;

/**
 * 草图**辅助网格**：12 等分 + 中心十字线。
 *
 * 它不是设计元素，是**参照系**——所以：
 * - 放在最底层（body 的第一个子元素），内容压在上面
 * - 用极淡的线，不抢内容的戏
 * - **不带 `data-layer`**，拆层工具不会把它当成节点
 *
 * 最大的用处是**给 VLM 验收一个读数依据**：没有它，
 * "标题中心偏了 55px""三行间距不均"这类判断只能靠目测。
 *
 * ⚠️ 它是**参照，不是约束**——节点可以贴格，也可以故意偏离来制造张力。
 * 校验器**不会**因为"没对齐网格"报错。
 */
function sketchGrid(size: number): string {
  const pct = `${(size * 100).toFixed(4)}%`;
  // 间距写成内联，这样密度可配（CSS 里只能写死一个值）
  const lines = (dir: 'right' | 'bottom') =>
    `repeating-linear-gradient(to ${dir}, rgba(60,70,80,.13) 0 1px, transparent 1px, transparent ${pct})`;
  return [
    `<div class="sgrid" style="background-image:${lines('right')},${lines('bottom')}"></div>`,
    '<div class="sgrid-axis" style="left:50%;top:0;width:1px;height:100%"></div>',
    '<div class="sgrid-axis" style="left:0;top:50%;width:100%;height:1px"></div>',
  ].join('\n');
}

// ══════════════════════════════════════════════════════════════════════
// 对外的唯一入口
// ══════════════════════════════════════════════════════════════════════

/**
 * 渲染整张草图的 body（含辅助网格）。
 *
 * `grid`：`true`（默认）= 12 等分；`false` = 不画；
 * **数字** = 自定义密度，表示**每格占画布的比例**（如 `0.05` = 20 格）。
 */
export function renderSketchBody(
  layers: Node[],
  C: Canvas,
  grid: boolean | number = true,
): string {
  const gridHtml = grid === false ? '' : sketchGrid(typeof grid === 'number' ? grid : GRID_STEP);
  return (
    gridHtml +
    layers
      .map((l) =>
        wrap(l, layerBox(l, C), renderNodeSketch(l, C), l.type === 'shape' ? SKETCH_FILL : undefined),
      )
      .join('\n')
  );
}

/**
 * 草图专用 CSS。
 *
 * ⚠️ 这张表就是上面「视觉语言」那节的实现。改符号语义时**两处一起改**。
 */
export const SKETCH_CSS = `
  /* 图位：**虚线**专留给"这里要放一张图"。
     实心块（形状）另有 .sfill——早先两者都画虚线框，
     读图时分不清"这里要放照片"还是"这里是个块"。 */
  .sbox{position:absolute;border:3px dashed #9199A1}
  /* 文字占位条：**高度 = 字号**（由内联 style 决定） */
  .sbar{position:absolute;background:#C4C9CE;border-radius:4px}
  /* 形状块的填充色**加在容器上**（不是这里）——见 shared.wrap 的 background 参数。
     因为 border-radius 只裁容器自己的背景，不裁子元素。 */
  /* 辅助网格（只在草图里）。间距由内联 style 给（密度可配），这里只管布局。 */
  .sgrid{position:absolute;inset:0;pointer-events:none}
  .sgrid-axis{position:absolute;background:rgba(60,70,80,.30);pointer-events:none}
  /* 区域标签 */
  .slbl{position:absolute;font-family:Arial,sans-serif;font-size:26px;font-weight:700;
        color:#5F6368;background:rgba(255,255,255,.9);padding:4px 11px;letter-spacing:.05em;white-space:nowrap}
  `;
