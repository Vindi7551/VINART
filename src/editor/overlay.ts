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
  /** 按画布 local px 摆好；`rotate` 为 null = 不转 */
  show(box: LocalBox, rotate: number | null): void;
  hide(): void;
  visible(): boolean;
  dispose(): void;
}

export function createOverlay(host: HostDom, parent: HTMLElement): Overlay {
  const root = host.createElement('div');
  root.setAttribute('data-ve-overlay', '1');
  root.style.cssText =
    'position:absolute;display:none;z-index:2147483645;pointer-events:none;border:1px dashed ' + ACCENT;

  const handles = new Map<HandleDir, HTMLElement>();
  for (const dir of HANDLE_DIRS) {
    const el = host.createElement('div');
    el.setAttribute('data-ve-handle', dir);
    el.style.cssText =
      'position:absolute;width:12px;height:12px;background:#fff;border:2px solid ' + ACCENT + ';' +
      'pointer-events:auto;cursor:' +
      (dir === 'nw' || dir === 'se' ? 'nwse-resize' : 'nesw-resize') +
      ';border-radius:2px';
    // 第 1 个字母定上下边、第 2 个定左右边（`se` → bottom + right）
    el.style.setProperty(dir.charAt(0) === 'n' ? 'top' : 'bottom', '-7px');
    el.style.setProperty(dir.charAt(1) === 'w' ? 'left' : 'right', '-7px');
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
    'background:#fff;border:2px solid ' + ACCENT + ';border-radius:50%;pointer-events:auto;cursor:grab';
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
    show(box, rotate) {
      root.style.display = 'block';
      root.style.left = `${box.left}px`;
      root.style.top = `${box.top}px`;
      root.style.width = `${box.width}px`;
      root.style.height = `${box.height}px`;
      root.style.transform = rotate == null ? 'none' : `rotate(${rotate}deg)`;
      root.style.transformOrigin = 'center';
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
