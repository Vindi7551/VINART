/**
 * 几何 —— **纯函数**，不含任何 DOM、不含任何状态。可以直接 `vitest` 单测。
 *
 * 分工（这条是 D1 的地基）：
 * - `screenToLocal` 是**唯一**除以 `zoom` 的地方；位移/缩放公式里**不再出现 zoom**。
 *   （旧实现把 `/zoom` 写进了 `applyMove`/`applyResize`，zoom=0.3 时位移快 3.33 倍。）
 * - 位图落点是 `rect`（0–1 比例）；手势期间在 local px 上算，落定时再换成比例。
 *   local px ↔ 比例 的换算只在这里做，别处不要手写 `* canvas.width`。
 */

import type { EditorRect, HandleDir, LocalBox, LocalPoint, Viewport } from './types';

/** 缩放下限（local px）。与旧实现一致：`Math.max(24, …)`。 */
export const MIN_SIZE = 24;

/** 手柄边长（local px）。12 + 2×2 边框。 */
export const HANDLE_SIZE = 12;

/** 比例保留 4 位小数 —— 与旧实现 `+(v).toFixed(4)` 同精度。 */
function r4(n: number): number {
  return +n.toFixed(4);
}

// ── 坐标换算 ──────────────────────────────────────────────────────────

/** 页面坐标 → 画布 local px。**全局唯一的 `/zoom` 出现在这里。** */
export function screenToLocal(clientX: number, clientY: number, vp: Viewport): LocalPoint {
  return { x: (clientX - vp.originX) / vp.zoom, y: (clientY - vp.originY) / vp.zoom };
}

/** 画布 local px → 页面坐标（覆盖层定位用） */
export function localToScreen(p: LocalPoint, vp: Viewport): LocalPoint {
  return { x: p.x * vp.zoom + vp.originX, y: p.y * vp.zoom + vp.originY };
}

/** 指针位移（页面像素）→ 画布 local 位移。`screenToLocal` 的差值形式。 */
export function screenDeltaToLocal(dx: number, dy: number, vp: Viewport): LocalPoint {
  return { x: dx / vp.zoom, y: dy / vp.zoom };
}

// ── 比例 ↔ local px ───────────────────────────────────────────────────

export function rectToLocalBox(rect: EditorRect, canvas: { width: number; height: number }): LocalBox {
  return {
    left: rect.x * canvas.width,
    top: rect.y * canvas.height,
    width: rect.w * canvas.width,
    height: rect.h * canvas.height,
  };
}

export function localBoxToRect(box: LocalBox, canvas: { width: number; height: number }): EditorRect {
  return {
    x: r4(box.left / canvas.width),
    y: r4(box.top / canvas.height),
    w: r4(box.width / canvas.width),
    h: r4(box.height / canvas.height),
  };
}

/** 盒子的四角点（local px）。手柄与覆盖层都用它定位。 */
export function cornerPoints(box: LocalBox): Record<HandleDir, LocalPoint> {
  const { left, top, width, height } = box;
  return {
    nw: { x: left, y: top },
    ne: { x: left + width, y: top },
    sw: { x: left, y: top + height },
    se: { x: left + width, y: top + height },
  };
}

/** 盒子的中心（local px） */
export function boxCenter(box: LocalBox): LocalPoint {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

// ── 三种手势的解算 ────────────────────────────────────────────────────

/**
 * 移动：**位移 = 指针在画布 local 里的位移**，不含任何缩放系数。
 *
 * `origin` 是按下时的指针位置，`p` 是当前指针位置；两者都必须是 local px
 * （由 `screenToLocal` 得来）。所以这里连 `viewport` 都不需要。
 */
export function moveBox(start: LocalBox, origin: LocalPoint, p: LocalPoint): LocalBox {
  return { ...start, left: start.left + (p.x - origin.x), top: start.top + (p.y - origin.y) };
}

/**
 * 缩放：**只有该方向上的边参与**——`se` 柄只吃 `Δx/Δy`，不吃"二维距离"。
 *
 * （口径坑：拿 resize 的位移去和二维距离比，会得出"拖拽坏了"的假结论。）
 *
 * 锁定比例时，以**先算出来的那条边**为准反解另一边；`w`/`n` 方向还要把
 * `left`/`top` 跟着推回去，保证对角固定。
 */
export function resizeBox(
  start: LocalBox,
  dir: HandleDir,
  origin: LocalPoint,
  p: LocalPoint,
  opts: { ratioLock?: boolean; min?: number } = {},
): LocalBox {
  const min = opts.min ?? MIN_SIZE;
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;

  let { left, top, width, height } = start;
  if (dir.includes('e')) width = Math.max(min, start.width + dx);
  if (dir.includes('s')) height = Math.max(min, start.height + dy);
  if (dir.includes('w')) {
    width = Math.max(min, start.width - dx);
    left = start.left + (start.width - width);
  }
  if (dir.includes('n')) {
    height = Math.max(min, start.height - dy);
    top = start.top + (start.height - height);
  }

  if (opts.ratioLock) {
    const ratio = start.height / start.width;
    if (dir.includes('e') || dir.includes('w')) height = Math.max(min, width * ratio);
    else width = Math.max(min, height / ratio);
    if (dir.includes('w')) left = start.left + (start.width - width);
    if (dir.includes('n')) top = start.top + (start.height - height);
  }

  return { left, top, width, height };
}

/** 从 `center` 指向 `p` 的角度（**度**，顺时针为正，与 CSS `rotate` 同向）。 */
export function angleAt(center: LocalPoint, p: LocalPoint): number {
  return (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
}

/**
 * 旋转：`当前角 − 按下角 + 起始角`，保留 1 位小数（与旧实现同精度）。
 *
 * 用**角度差**而不是两点连线，所以对指针离中心的距离不敏感 —— 也就
 * 天然不受 `zoom` 影响（zoom 只等比缩放距离，不改角度）。
 */
export function rotateDegrees(
  session: { center: LocalPoint; angle0: number; rotate0: number },
  p: LocalPoint,
): number {
  const a = angleAt(session.center, p) - session.angle0 + session.rotate0;
  return Math.round(a * 10) / 10;
}

// ── 越界判定（给探针和覆盖层显示用）────────────────────────────────────

/** 盒子是否完全落在画布内 —— 用于"手柄够不够得着"的自检 */
export function boxInsideCanvas(box: LocalBox, canvas: { width: number; height: number }): boolean {
  return box.left >= 0 && box.top >= 0 && box.left + box.width <= canvas.width && box.top + box.height <= canvas.height;
}
