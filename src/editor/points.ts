/**
 * **顶点几何** —— 多边形的「点」怎么在三种坐标之间来回换。**纯函数，无 DOM。**
 *
 * ## 为什么这一层值得单独存在
 *
 * 多边形在文档里存的是 **0–1 的小数**（`polygon.points`，`[[x,y],…]`），
 * 屏幕上却是**几百像素**。中间隔着三层：
 *
 * ```
 *   0–1 点集  ──× 盒子宽高──▶  盒子内 local px  ──+ 盒子左上角──▶  画布 local px
 *                                                        │
 *                                                    rotate
 *                                                        ▼
 *                                                 屏幕上看到的位置
 * ```
 *
 * 拖一个顶点时方向反过来：鼠标动的是**屏幕像素**，要一路除回去。
 * 少除一层就会出现「鼠标拖 100 像素、顶点跑 300 像素」——**这类 bug 手调不出来，
 * 只能靠口径算准**，所以三层换算全部收在这一个文件里，别处不许手写。
 *
 * ## 这一版的边界（诚实交代）
 *
 * - **支持 `rotate`**：位移先逆旋转回「未旋转的盒子坐标」再除。
 * - **不支持 `skewX` / `skewY`**：斜切不是「绕一个点转」，逆变换要解矩阵，
 *   这一版不做 ⇒ 调用方遇到斜切**不启用**顶点编辑（见 `point-editor.ts`）。
 *
 * @see `src/render/vocabulary/emit.ts` 的 `emitShape` —— 那边把这串 0–1 点写进
 *      `<polygon points>`，用 `viewBox="0 0 1 1"` 铺满盒子。**两边的换算必须对上。**
 */

import type { LocalBox, LocalPoint } from './types';

/** 多边形的一个顶点。恒为 **0–1**（相对它自己那块盒子的宽高）。 */
export type Point01 = [number, number];

/** 比例保留 4 位小数 —— 与 `geometry.ts` 的 `r4` 同精度。 */
function r4(n: number): number {
  return +n.toFixed(4);
}

/** 兜住 0 宽 / 0 高的盒子（除零会变 `Infinity`，一路传染到渲染产物里） */
function safe(v: number): number {
  return Math.abs(v) < 1e-6 ? 1 : v;
}

// ── 第 1 层：0–1 ↔ 盒子内 local px ────────────────────────────────────

/** 一个 0–1 顶点 → 画布 local px */
export function point01ToLocal(p: Point01, box: LocalBox): LocalPoint {
  return { x: box.left + p[0] * box.width, y: box.top + p[1] * box.height };
}

/** 画布 local px → 一个 0–1 顶点（**不夹取**：顶点允许跑到盒子外面） */
export function localToPoint01(p: LocalPoint, box: LocalBox): Point01 {
  return [r4((p.x - box.left) / safe(box.width)), r4((p.y - box.top) / safe(box.height))];
}

/** 整串点集 → 画布 local px（手柄定位用） */
export function pointsToLocal(points: readonly Point01[], box: LocalBox): LocalPoint[] {
  return points.map((p) => point01ToLocal(p, box));
}

/** 整串 local px → 0–1 点集 */
export function localToPoints(local: readonly LocalPoint[], box: LocalBox): Point01[] {
  return local.map((p) => localToPoint01(p, box));
}

// ── 第 2 层：旋转 ─────────────────────────────────────────────────────

/**
 * 把一个**向量**转 `deg` 度。顺时针为正，与 CSS `rotate()` 同向
 * （屏幕 y 轴朝下，所以正角度是顺时针）。
 */
export function rotateVec(v: LocalPoint, deg: number): LocalPoint {
  if (!deg) return { x: v.x, y: v.y };
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// ── 第 3 层：三种编辑动作 ─────────────────────────────────────────────

/**
 * **拖一个顶点**。
 *
 * `delta` 是指针在**画布 local** 里的位移（由 `screenToLocal` 的差值拿来，
 * 已经除过 `zoom`）。这里要做的两件事：**逆旋转**回去，再**除以盒子宽高**。
 *
 * @param rotateDeg 节点当前的 `transform.rotate`（没有就传 0）
 */
export function dragPoint(
  points: readonly Point01[],
  index: number,
  delta: LocalPoint,
  box: LocalBox,
  rotateDeg = 0,
): Point01[] {
  if (index < 0 || index >= points.length) return points.map((p) => [p[0], p[1]] as Point01);
  const d = rotateVec(delta, -rotateDeg);
  const out = points.map((p) => [p[0], p[1]] as Point01);
  out[index] = [
    r4(out[index][0] + d.x / safe(box.width)),
    r4(out[index][1] + d.y / safe(box.height)),
  ];
  return out;
}

export interface EdgeHit {
  /** 第几条边 —— 从 `points[i]` 到 `points[(i+1)%n]` */
  edge: number;
  /** 落点在这条边上的位置，0 = 起点，1 = 终点 */
  t: number;
  /** 落点本身（画布 local px） */
  at: LocalPoint;
  /** 这条边有多长（local px）—— 短边不该摆插入标记，太挤 */
  length: number;
}

/**
 * **找离指针最近的那条边**，用于在边上插一个顶点。
 *
 * 用「投影到线段」而不是「离端点最近」：这样点边中间就是插在中间，
 * 符合"我在这儿掰一下"的直觉。
 */
export function nearestEdge(
  points: readonly Point01[],
  box: LocalBox,
  p: LocalPoint,
): EdgeHit | null {
  const n = points.length;
  if (n < 2) return null;
  const local = pointsToLocal(points, box);

  let best: EdgeHit | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const a = local[i];
    const b = local[(i + 1) % n];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    // 退化边（两点重合）：t 取 0，距离按到 a 算
    const t = len2 === 0 ? 0 : clamp01(((p.x - a.x) * vx + (p.y - a.y) * vy) / len2);
    const at = { x: a.x + vx * t, y: a.y + vy * t };
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    if (d < bestDist) {
      bestDist = d;
      best = { edge: i, t, at, length: Math.sqrt(len2) };
    }
  }
  return best;
}

/**
 * **在一条边上插一个顶点**。
 *
 * `t` 会被夹进 `[0.02, 0.98]` —— 贴着端点插等于在原地复制一个点，
 * 既看不出效果，又会让「哪两个点重合了」变成日后的麻烦。
 */
export function insertPoint(points: readonly Point01[], edge: number, t: number): Point01[] {
  const n = points.length;
  if (edge < 0 || edge >= n) return points.map((p) => [p[0], p[1]] as Point01);
  const a = points[edge];
  const b = points[(edge + 1) % n];
  const k = Math.min(0.98, Math.max(0.02, t));
  const at: Point01 = [r4(a[0] + (b[0] - a[0]) * k), r4(a[1] + (b[1] - a[1]) * k)];
  const out = points.map((p) => [p[0], p[1]] as Point01);
  out.splice(edge + 1, 0, at);
  return out;
}

/**
 * **删掉一个顶点**。
 *
 * 多边形少于 3 个点就不是面了 ⇒ **保底 3**，到 3 个就返回 `null`（调用方应当忽略）。
 * `null` 而不是「照原样返回」，是为了让调用方能区分「删不动」和「删了个寂寞」。
 */
export function removePoint(points: readonly Point01[], index: number): Point01[] | null {
  if (points.length <= 3) return null;
  if (index < 0 || index >= points.length) return null;
  const out = points.map((p) => [p[0], p[1]] as Point01);
  out.splice(index, 1);
  return out;
}

// ── 手柄命中 ─────────────────────────────────────────────────────────

/**
 * 指针落在哪个顶点手柄上。返回下标，没落在任何手柄上返回 `-1`。
 *
 * `tol` 是**画布 local px** 的抓取半径。注意它跟着 `zoom` 走：
 * 画布缩到 0.3 倍时手柄在屏幕上只有 4 像素，这时候还按 10px 判定是对的
 * （因为换算已经在 `screenToLocal` 里除过 zoom 了）。
 */
export function nearestVertex(local: readonly LocalPoint[], p: LocalPoint, tol: number): number {
  let best = -1;
  let bestDist = tol;
  for (let i = 0; i < local.length; i++) {
    const d = Math.hypot(local[i].x - p.x, local[i].y - p.y);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

// ── 小工具 ───────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 多边形的边数 —— 顺手给 UI 显示用 */
export function vertexCount(points: readonly Point01[]): number {
  return points.length;
}
