/**
 * **顶点手柄覆盖层** —— 多边形的「点」在屏幕上长什么样。画在**父文档**里。
 *
 * ## 和 `overlay.ts` 的关系
 *
 * 两个覆盖层**并存不合并**：
 * - `overlay.ts` 画的是**包围盒**那套（四角缩放柄 + 顶部旋转柄）——每个节点都有；
 * - 本文件画的是**顶点**那套（每个顶点一个柄 + 每条边一个插入点）——**只有多边形有**。
 *
 * 视觉上刻意区分开：包围盒的手柄是**方块**，顶点手柄是**圆点**。
 * 一眼就知道自己在动"整个框"还是"这个形状本身"。
 *
 * ## 为什么手柄定位不需要 zoom
 *
 * 与 `overlay.ts` 同理：本层挂进带 `transform: scale(zoom)` 的 wrapper，
 * 于是它的坐标系**天然就是画布 local px**，一个换算都不用做。
 *
 * ## ⚠️ 旋转怎么办
 *
 * 不自己算。**整个 root 打上 `rotate(deg)`**，让浏览器去转里面的手柄。
 * 这样手柄在屏幕上的位置和「被转过的多边形」必然一致 ——
 * 反过来讲，命中手柄时拿到的是**手柄元素本身**（DOM 事件目标），
 * 也就**不需要**把指针坐标逆旋转回去，只有「拖了多少」才需要逆旋转（那活儿在 `points.ts`）。
 */

import { ACCENT } from './overlay';
import { pointsToLocal } from './points';
import type { HostDom, LocalBox, LocalPoint } from './types';
import type { Point01 } from './points';

/** 顶点手柄直径（local px，含边框） */
export const VERTEX_SIZE = 11;

/** 边中点「插入点」直径 */
export const EDGE_SIZE = 9;

/** 顶点手柄的抓取半径（local px）—— 比视觉尺寸大一圈，好点 */
export const VERTEX_TOL = 10;

/**
 * **「光标离这条边多近，就算点在边上」**（local px）。
 *
 * 加顶点**不是**让你瞄准那个小圆点 —— 整条边都能点，位置由光标**投影**到边上决定。
 * 这个数是"边两侧各留多宽的感应带"。
 */
export const EDGE_TOL = 10;

/** 太短的边不摆插入标记、也不给加顶点（挤在一起点不中，加了也没意义） */
export const MIN_EDGE_PX = 26;

/** 同一条边上「插入点」离两端的最小距离，避免和顶点手柄打架 */
const EDGE_INSET = 0.16;

export interface PointOverlay {
  readonly root: HTMLElement;
  /** `points` 为 null = 当前选中的不是多边形，整层藏起来 */
  /**
   * 按画布 local px 摆好顶点与边中点。
   *
   * @param transformCss 元素**同一串** CSS transform（含 `transform-origin`），空 = 不变换。
   *   ⚠️ 曾经只收 `rotate: number` ⇒ 带 `skewX` / `scale` 的元素上，圆点和形状错开。
   */
  show(box: LocalBox, transformCss: string | null | undefined, points: readonly Point01[] | null): void;
  hide(): void;
  visible(): boolean;
  /** 正在拖的那个顶点高亮（`-1` = 无） */
  setActive(index: number): void;
  /**
   * **插入点跟着光标走** —— 光标压在哪条边上，那条边的小圆点就滑到光标那儿，
   * 告诉你"点下去就会在这儿长出一个顶点"。
   *
   * `edge` 为 null = 光标不在任何边上，小圆点回到边中点（只作提示）。
   */
  setHover(edge: number | null, at: LocalPoint | null): void;
  dispose(): void;
}

export function createPointOverlay(host: HostDom, parent: HTMLElement): PointOverlay {
  const root = host.createElement('div');
  root.setAttribute('data-ve-point-overlay', '1');
  root.style.cssText =
    'position:absolute;display:none;z-index:2147483646;pointer-events:none;overflow:visible';
  parent.appendChild(root);

  /** 当前这批手柄的顶点下标 / 边下标 —— 用来判断要不要重建 */
  let vertexEls: HTMLElement[] = [];
  let edgeEls: HTMLElement[] = [];
  let active = -1;

  /** 最近一次 `show` 的盒子与点集 —— `setHover` 要按它们把光标位置换算回来 */
  let curBox: LocalBox | null = null;
  let curPoints: readonly Point01[] | null = null;
  /** 光标压在哪条边上、以及投影点在哪（**画布 local px**） */
  let hoverEdge: number | null = null;
  let hoverAt: LocalPoint | null = null;

  function clear() {
    for (const el of vertexEls) el.remove();
    for (const el of edgeEls) el.remove();
    vertexEls = [];
    edgeEls = [];
  }

  function makeVertex(i: number): HTMLElement {
    const el = host.createElement('div');
    el.setAttribute('data-ve-vtx', String(i));
    el.style.cssText =
      `position:absolute;width:${VERTEX_SIZE}px;height:${VERTEX_SIZE}px;` +
      'margin-left:-' + Math.round(VERTEX_SIZE / 2) + 'px;margin-top:-' + Math.round(VERTEX_SIZE / 2) + 'px;' +
      `background:#fff;border:2px solid ${ACCENT};border-radius:50%;` +
      'pointer-events:auto;cursor:move;box-sizing:border-box';
    return el;
  }

  /**
   * 「加顶点」的小圆点。
   *
   * ⚠️ **`pointer-events:none` 是必须的**，而且不是小细节：
   * 它会**跟着光标滑到顶点手柄上面**，如果它能接收事件，按下去的 `target` 就是它
   * ⇒ 顶点手柄收不到 `pointerdown` ⇒ **顶点拖不动了**（实测拖出来位移恒为 0）。
   *
   * 反正加顶点是**按坐标**判定的（`point-editor.ts` 的 `edgeUnder`），
   * 这个小圆点**只是个提示**，本来就不该碰事件。
   */
  function makeEdge(i: number): HTMLElement {
    const el = host.createElement('div');
    el.setAttribute('data-ve-edge', String(i));
    el.style.cssText =
      `position:absolute;width:${EDGE_SIZE}px;height:${EDGE_SIZE}px;` +
      'margin-left:-' + Math.round(EDGE_SIZE / 2) + 'px;margin-top:-' + Math.round(EDGE_SIZE / 2) + 'px;' +
      `background:${ACCENT};opacity:.55;border-radius:50%;` +
      'pointer-events:none;box-sizing:border-box';
    return el;
  }

  function paintActive() {
    for (let i = 0; i < vertexEls.length; i++) {
      const on = i === active;
      vertexEls[i].style.background = on ? ACCENT : '#fff';
      vertexEls[i].style.transform = on ? 'scale(1.25)' : 'none';
    }
  }

  /**
   * 摆「加顶点」的小圆点。
   *
   * 光标**没压在边上**时：小圆点在**边中点偏一点**的位置，半透明，纯提示。
   * 光标**压在某条边上**时：那条边的小圆点**滑到光标那儿**并变实心 ——
   * "点下去，顶点就长在你指的地方"。
   */
  function paintEdges() {
    if (!curBox || !curPoints) return;
    const box = curBox;
    const local = pointsToLocal(curPoints, box);

    for (let i = 0; i < local.length; i++) {
      const el = edgeEls[i];
      if (!el) continue;
      const a = local[i];
      const b = local[(i + 1) % local.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // 太短的边：既摆不下提示，也不该让人往上加点
      if (len < MIN_EDGE_PX) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';

      const follow = hoverEdge === i && hoverAt != null;
      if (follow) {
        el.style.left = `${hoverAt!.x - box.left}px`;
        el.style.top = `${hoverAt!.y - box.top}px`;
        el.style.opacity = '1';
        el.style.transform = 'scale(1.2)';
      } else {
        // 稍微避开两个端点，不然提示会和顶点手柄叠在一起
        const t = Math.min(0.5, EDGE_INSET);
        el.style.left = `${a.x - box.left + (b.x - a.x) * t}px`;
        el.style.top = `${a.y - box.top + (b.y - a.y) * t}px`;
        el.style.opacity = '.55';
        el.style.transform = 'none';
      }
    }
  }

  return {
    root,

    show(box, transformCss, points) {
      if (!points || points.length < 3) {
        root.style.display = 'none';
        clear();
        curBox = null;
        curPoints = null;
        hoverEdge = null;
        hoverAt = null;
        return;
      }

      // 点数变了 ⇒ 重建（手柄数量跟着点集走，这是本层和 overlay.ts 最大的不同）
      if (vertexEls.length !== points.length) {
        clear();
        for (let i = 0; i < points.length; i++) {
          const v = makeVertex(i);
          vertexEls.push(v);
          root.appendChild(v);
        }
        // ⚠️ **"边中点的加点提示圆点"不再挂到 DOM 上**（2026-10-17 用户要求：
        //    那些橙色小圆点在画面上太吵，像一堆投影点）。
        //
        // ⚠️ **加顶点 / 删顶点的能力一点没动**：
        //    - 加点靠**坐标判定**（`point-editor.ts` 的 `edgeUnder` + `setHover`
        //      记下的 `hoverEdge`/`hoverAt`），**不依赖**这些圆点的 DOM ✓
        //      （代码原来就写着："这个小圆点只是个提示，本来就不该碰事件"）
        //    - 删点靠右键顶点 / 双击（`makeVertex` 那条路）✓
        //    ⇒ 这里仍然建元素（`makeEdge` / `EDGE_SIZE` 保持在用，免得变死代码），
        //      但**不 append** ⇒ 不在画面上出现 ✓ `paintEdges` 给它们设样式也无害 ✓
        for (let i = 0; i < points.length; i++) {
          edgeEls.push(makeEdge(i));
        }
        paintActive();
      }

      root.style.display = 'block';
      root.style.left = `${box.left}px`;
      root.style.top = `${box.top}px`;
      root.style.width = `${box.width}px`;
      root.style.height = `${box.height}px`;
      // ⚠️ 顶点圆点必须跟着元素**同一串变换**走：顶点是"盒内 0–1"换算出来的
      //    （纯函数、不含变换），少了 `skewX` / `scale` 圆点就会和形状错开。
      root.style.transform = 'none';
      root.style.transformOrigin = 'center';
      if (transformCss) {
        const m = /transform\s*:\s*([^;]+)/.exec(transformCss);
        if (m) root.style.transform = m[1].trim();
        const o = /transform-origin\s*:\s*([^;]+)/.exec(transformCss);
        if (o) root.style.transformOrigin = o[1].trim();
      }

      curBox = box;
      curPoints = points;

      const local = pointsToLocal(points, box);
      for (let i = 0; i < local.length; i++) {
        vertexEls[i].style.left = `${local[i].x - box.left}px`;
        vertexEls[i].style.top = `${local[i].y - box.top}px`;
      }

      paintEdges();
    },

    setHover(edge, at) {
      if (hoverEdge === edge && hoverAt === at) return;
      hoverEdge = edge;
      hoverAt = at;
      paintEdges();
    },

    hide() {
      root.style.display = 'none';
      hoverEdge = null;
      hoverAt = null;
    },

    visible() {
      return root.style.display !== 'none';
    },

    setActive(index) {
      if (active === index) return;
      active = index;
      paintActive();
    },

    dispose() {
      clear();
      root.remove();
    },
  };
}
