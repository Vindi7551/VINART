/**
 * 覆盖层 —— **画在父文档**里，挂在 `.canvas-wrapper` 内部。
 *
 * 挂进 wrapper 是关键：wrapper 上有 `transform: scale(zoom)`，所以覆盖层的
 * **坐标系天然就是画布 local px** —— 定位手柄时不需要任何 zoom 换算，
 * 也不可能和内容对不上。
 *
 * 视觉**逐条对齐旧实现**（原先注入进子文档的那份），因为 M1 的验收口径是
 * "现有编辑功能一模一样"，橙色虚线框 + 白底方手柄 + 顶部圆形旋转柄
 * 一个像素都不该变。`data-ve-handle` / `data-ve-rot` 两个属性名也保持不变：
 * 它们是父侧命中测试（`hit-test.ts` 第 1 段）的锚点。
 *
 * 为什么必须搬出子文档：PS 化要做**逐层截图**，覆盖层留在子文档里，
 * 每一层截图都会多出一块橙色虚线框和白手柄。
 */

import { HANDLE_DIRS, type HandleDir, type HostDom, type LocalBox } from './types';

/** 与旧实现同一个强调色 */
export const ACCENT = '#ff5722';

export interface Overlay {
  /** 选中框本体（手柄是它的子元素） */
  readonly root: HTMLElement;
  readonly rotateEl: HTMLElement;
  handleEl(dir: HandleDir): HTMLElement;
  /**
   * 按画布 local px 摆好。
   *
   * @param transformCss 元素**同一串** CSS transform（含 `transform-origin`）。
   *   空 / 省略 = 不变换。
   *
   *   ⚠️ 曾经这里收的是 `rotate: number`，于是**只画得出旋转**：
   *   元素带 `skewX` / `scale` 时框还是正矩形（圈不住），
   *   带 `transform.origin` 时框绕中心转而元素绕别处转（岔开）。
   *   现在直接吃 `emit.ts` 的 `transformCss()` 产物 —— 与渲染产物**逐字同一串**，
   *   结构上不可能再分叉。
   */
  show(box: LocalBox, transformCss?: string | null): void;
  hide(): void;
  visible(): boolean;
  dispose(): void;
}

/**
 * @param inset 四角手柄相对盒子**往外**偏多少（**负数**，指的是**手柄那条边**）。
 *
 * 默认 `-7`（与老编辑器一模一样）。新链传 **`-20`**：
 * 多边形的顶点**常常正好落在盒子的角上**（三角形的三个顶点就是外接矩形的角），
 * 角柄在 -7px 时会和顶点手柄**叠在一起**，而顶点层 z-index 更高 ⇒ **缩放柄点不到**
 * （实测：拖 se 柄实际在拖顶点，宽高纹丝不动）。推到 -16px 两套手柄就分开了。
 */
export function createOverlay(host: HostDom, parent: HTMLElement, inset = -7): Overlay {
  const root = host.createElement('div');
  root.setAttribute('data-ve-overlay', '1');
  // ⚠️ `box-sizing:border-box` 不能少：覆盖层画在**父文档**里，而父文档没有子文档那条
  //    `*{box-sizing:border-box}`。少了它，这 1px 虚线边框会把盒子**撑大 2px** ——
  //    于是覆盖层的中点比元素的中点偏 (1,1)，一旦有 `transform` 就**肉眼可见地错开**。
  root.style.cssText =
    'position:absolute;display:none;z-index:2147483645;pointer-events:none;box-sizing:border-box;' +
    'border:1px dashed ' + ACCENT;

  const handles = new Map<HandleDir, HTMLElement>();
  for (const dir of HANDLE_DIRS) {
    const el = host.createElement('div');
    el.setAttribute('data-ve-handle', dir);
    // ⚠️ `box-sizing:border-box` 不能少：覆盖层现在画在**父文档**里，而父文档
    //    没有子文档那条 `*{box-sizing:border-box}` ⇒ 不写的话 12px 会被边框撑成 16px
    //    （老实现在子文档里，一直是 12px —— 这是搬出来之后的一个既有回归）。
    el.style.cssText =
      'position:absolute;width:12px;height:12px;background:#fff;border:2px solid ' + ACCENT + ';' +
      'pointer-events:auto;cursor:' +
      (dir === 'nw' || dir === 'se' ? 'nwse-resize' : 'nesw-resize') +
      ';border-radius:2px;box-sizing:border-box';
    // 第 1 个字母定上下边、第 2 个定左右边（`se` → bottom + right）
    el.style.setProperty(dir.charAt(0) === 'n' ? 'top' : 'bottom', `${inset}px`);
    el.style.setProperty(dir.charAt(1) === 'w' ? 'left' : 'right', `${inset}px`);
    root.appendChild(el);
    handles.set(dir, el);
  }

  const line = host.createElement('div');
  line.style.cssText =
    'position:absolute;top:-26px;left:50%;width:0;height:26px;border-left:1px solid ' + ACCENT;
  root.appendChild(line);

  const rotateEl = host.createElement('div');
  rotateEl.setAttribute('data-ve-rot', '1');
  rotateEl.style.cssText =
    'position:absolute;top:-40px;left:50%;margin-left:-7px;width:14px;height:14px;' +
    'background:#fff;border:2px solid ' + ACCENT + ';border-radius:50%;pointer-events:auto;cursor:grab;box-sizing:border-box';
  root.appendChild(rotateEl);

  parent.appendChild(root);

  return {
    root,
    rotateEl,
    handleEl(dir) {
      const el = handles.get(dir);
      if (!el) throw new Error(`overlay: 没有 ${dir} 手柄`);
      return el;
    },
    show(box, transformCss) {
      root.style.display = 'block';
      root.style.left = `${box.left}px`;
      root.style.top = `${box.top}px`;
      root.style.width = `${box.width}px`;
      root.style.height = `${box.height}px`;
      // ⚠️ `transformCss()` 产出的是一整条 `transform:...;transform-origin:...;`
      //    所以这里**先清空再设**，避免上一次的 origin 残留。
      root.style.transform = 'none';
      root.style.transformOrigin = 'center';
      if (transformCss) {
        const m = /transform\s*:\s*([^;]+)/.exec(transformCss);
        if (m) root.style.transform = m[1].trim();
        const o = /transform-origin\s*:\s*([^;]+)/.exec(transformCss);
        if (o) root.style.transformOrigin = o[1].trim();
      }
    },
    hide() {
      root.style.display = 'none';
    },
    visible() {
      return root.style.display !== 'none';
    },
    dispose() {
      root.remove();
    },
  };
}
