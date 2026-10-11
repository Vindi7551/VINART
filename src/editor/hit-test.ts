/**
 * 命中测试 —— **两段式**（D3）。
 *
 * 为什么不自己算 rect 多边形：子文档的 `elementFromPoint` **自动**考虑
 * `transform`（rotate / skewX）、遮挡关系、形状（arch / triangle 的圆角与斜边），
 * 与用户"看到什么就点到什么"天生一致。自己算一遍必然和渲染器分叉。
 *
 * 为什么必须**两段**：覆盖层搬到父文档之后，指针事件的目标可能是：
 *
 * 1. **装饰件**（手柄 / 旋转柄）—— 父侧覆盖层自己的子元素，`pointer-events:auto`。
 *    必须**优先**判它，否则 `se` 柄会被"它底下那一层"截胡。
 * 2. **其余一切** —— 覆盖层是 `pointer-events:none` 的，事件会穿透到
 *    wrapper，于是**没有任何真实目标**告诉我们点到了哪个图层。
 *    ⇒ 把指针换算成画布 local 坐标，**去问子文档**。
 *
 * ⚠️ 第二段拿到的是 `IMG` / 内层 `DIV` 之类，**永远不是**带 `data-layer` 的容器，
 * 所以必须 `closest('[data-layer]')` 收口。
 *
 * 附带修掉的老问题：旧实现里覆盖层长在**子文档**里，于是"点选中框边线"
 * 命中一块没有 `data-layer` 的裸 `DIV` ⇒ 归零 ⇒ **取消选中**。
 * 覆盖层移到父文档后，子文档里根本没有覆盖层，这一整类问题消失。
 */

import type { Hit, LayerDom, LocalPoint } from './types';

const DECO_SELECTOR = '[data-ve-handle],[data-ve-rot]';

function isHandleDir(v: string | null): v is 'nw' | 'ne' | 'sw' | 'se' {
  return v === 'nw' || v === 'ne' || v === 'sw' || v === 'se';
}

/**
 * 第 1 段：装饰件。只看**指针事件的目标元素**，不查任何文档。
 *
 * `target` 传 `event.target`。`closest` 保证落在手柄内部元素上也算命中。
 */
export function hitDecoration(target: EventTarget | null): Hit {
  const el = target as Element | null;
  if (!el || typeof el.closest !== 'function') return { kind: 'empty' };
  const deco = el.closest(DECO_SELECTOR);
  if (!deco) return { kind: 'empty' };
  if (deco.getAttribute('data-ve-rot') != null) return { kind: 'rotate' };
  const dir = deco.getAttribute('data-ve-handle');
  return isHandleDir(dir) ? { kind: 'handle', dir } : { kind: 'empty' };
}

/**
 * 第 2 段：内容层。把画布 local 坐标交给**子文档**去判。
 *
 * 返回图层 id；点到空白（没有 `data-layer` 祖先）返回 `null`。
 */
export function hitLayer(root: LayerDom, p: LocalPoint): string | null {
  const el = root.elementFromPoint(p.x, p.y);
  if (!el || typeof el.closest !== 'function') return null;
  const layer = el.closest('[data-layer]');
  const id = layer ? layer.getAttribute('data-layer') : null;
  return id || null;
}

/**
 * 两段式合并。`local` 必须是**画布 local 坐标**（用 `geometry.screenToLocal` 算）。
 */
export function hitTest(root: LayerDom, target: EventTarget | null, local: LocalPoint): Hit {
  const deco = hitDecoration(target);
  if (deco.kind !== 'empty') return deco;
  const id = hitLayer(root, local);
  return id ? { kind: 'layer', id } : { kind: 'empty' };
}
