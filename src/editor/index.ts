/**
 * 编辑器入口 —— 手势状态机 + 编排。
 *
 * 结构上它只做两件事：
 * 1. **把父页面的指针/键盘事件翻译成手势**（`pointerdown` → move/resize/rotate → `pointerup`）；
 * 2. **把结果分发给两边**：写 DOM 走 `target`（子文档），提交数据走 `onChange`（宿主 state）。
 *
 * 三条设计决策在这里落地（见 `docs/EDITOR-EVOLUTION.md` §5.4）：
 *
 * - **D1 · 真源是 state，DOM 只是投影**：手势起点从**内部工作副本**取，
 *   不从渲染产物读回来。旧实现读 `selected.style.left` 和
 *   `selected.offsetWidth`（后者是**四舍五入的整数**，每次缩放都把亚像素尺寸量化掉）。
 * - **D2 · 撤销以手势为粒度**：一次 `pointerdown…pointerup` = 恰好**一次** `onChange`。
 *   旧实现也是每次 mouseup 发一条，但参数面板每敲一下发一条 —— 事务边界在 M2 补。
 * - **D3 · 命中测试两段式**：`hit-test.ts`。
 *
 * `pointerup` 之后**不**等 React 回流：内部工作副本立刻更新，所以连续两次拖拽
 * 不会因为 state 还没回来而算错起点。
 */

import {
  angleAt,
  boxCenter,
  localBoxToRect,
  moveBox,
  rectToLocalBox,
  resizeBox,
  rotateDegrees,
  screenToLocal,
} from './geometry';
import { hitLayer, hitTest } from './hit-test';
import { ACCENT, createOverlay, type Overlay } from './overlay';
import { createTarget, type EditorTarget } from './target';
import type {
  EditorAppearance,
  EditorLayer,
  EditorLayerAppearance,
  EditorSpec,
  GestureSession,
  HostDom,
  LayerDom,
  LayerPatch,
  LocalBox,
  Viewport,
} from './types';

const OUTLINE = `2px solid ${ACCENT}`;

export interface EditorOptions {
  spec: EditorSpec;
  appearance?: EditorAppearance;
  /** 图上点选 / 取消选中 → 宿主切换面板 */
  onSelect?(id: string | null): void;
  /** 手势落定 → 宿主合并进持久数据（一次手势**只有一条**） */
  onChange?(id: string, patch: LayerPatch): void;
  /** 点到染色词 → 宿主让面板单行颜色跟随 */
  onWord?(id: string, word: string): void;
  /** 就地改字进出 → 宿主需要临时把指针放回 iframe（好让鼠标能点光标） */
  onEditingChange?(editing: boolean): void;
}

export interface EditorHandle {
  /** 换根（iframe 重载后新文档）—— 覆盖层不动，只重挂 target */
  attachRoot(root: LayerDom): void;
  /** 宿主 state 变了（换版式 / 面板提交）→ 刷新工作副本并同步覆盖层 */
  updateLayout(spec: EditorSpec, appearance?: EditorAppearance): void;
  select(id: string | null): void;
  setHidden(ids: ReadonlySet<string>): void;
  /** 参数面板改属性：写数据 + 写 DOM（与旧 `applyPatch` 同语义） */
  patch(id: string, patch: LayerPatch): void;
  readonly selectedId: string | null;
  readonly editing: boolean;
  dispose(): void;
}

/** 补齐 `layers` 字段 —— `EditorAppearance` 有索引签名，直接展开会被 TS 判成重复键 */
function normalizeAppearance(a?: EditorAppearance): EditorAppearance {
  return { ...(a ?? {}), layers: { ...(a?.layers ?? {}) } };
}

export function createEditor(
  host: HostDom,
  wrap: HTMLElement,
  root: LayerDom,
  opts: EditorOptions,
): EditorHandle {  // ── 内部状态 ────────────────────────────────────────────────────────
  let target: EditorTarget = createTarget(root);
  let canvas = { ...opts.spec.canvas };
  let layers: EditorLayer[] = [];
  let appearance: EditorAppearance = normalizeAppearance(opts.appearance);
  const hidden = new Set<string>();

  let selectedId: string | null = null;
  let session: GestureSession | null = null;
  let editing: string | null = null;

  /** 手势期间的实时值（`pointerup` 提交的就是它） */
  let gestureBox: LocalBox | null = null;
  let gestureRotate: number | null = null;

  /**
   * "这次按下之后起过手势 / 指针动过" —— 用来**吃掉拖拽末尾的那次 click**。
   *
   * 浏览器在 down/up 落在同一元素上时会补一个 `click`，而它的坐标是**松手处**。
   * 拖完之后松手的位置往往已经是另一层（旋转尤其明显：柄在层外 40px），
   * 不拦就会把选中改成那一层。
   *
   * 旧实现没这个问题，纯属巧合：覆盖层当时在子文档里，拖到 iframe 外面松手
   * 根本不会在子文档里产生 `click`。搬到父侧后必须显式处理。
   */
  let gestureRan = false;
  let pointerMoved = false;
  const CLICK_SLOP = 4;
  let downAt: { x: number; y: number } | null = null;

  /** 就地改字时挂在文字节点上的临时监听 */
  let editNode: HTMLElement | null = null;

  const overlay: Overlay = createOverlay(host, wrap);

  // ── 工作副本（D1：不读渲染产物）────────────────────────────────────
  function seed(spec: EditorSpec) {
    canvas = { ...spec.canvas };
    layers = spec.layers.map((l) => ({
      ...l,
      rect: { ...l.rect },
      transform: l.transform ? { ...l.transform } : undefined,
    }));
  }
  seed(opts.spec);

  function layerById(id: string): EditorLayer | null {
    return layers.find((l) => l.id === id) ?? null;
  }

  function appOf(id: string): EditorLayerAppearance {
    const map = (appearance.layers ??= {});
    return (map[id] ??= {});
  }

  // ── 视口 ───────────────────────────────────────────────────────────
  // wrapper 上有 scale(zoom)，其 rect 就是画布在页面上的位置；
  // `zoom = rect.width / canvas.width` —— 这是全局唯一的 zoom 来源。
  function viewport(): Viewport {
    const r = wrap.getBoundingClientRect();
    return { originX: r.left, originY: r.top, zoom: canvas.width ? r.width / canvas.width : 1 };
  }

  function localPoint(e: { clientX: number; clientY: number }) {
    return screenToLocal(e.clientX, e.clientY, viewport());
  }

  // ── 覆盖层同步 ─────────────────────────────────────────────────────
  function boxOf(id: string): LocalBox | null {
    const l = layerById(id);
    return l ? rectToLocalBox(l.rect, canvas) : null;
  }

  function rotateOf(id: string): number | null {
    const r = layerById(id)?.transform?.rotate;
    return typeof r === 'number' ? r : null;
  }

  function syncOverlay() {
    if (!selectedId) {
      overlay.hide();
      return;
    }
    const box = boxOf(selectedId);
    if (!box) {
      overlay.hide();
      return;
    }
    overlay.show(box, rotateOf(selectedId));
  }

  // ── 选中 ───────────────────────────────────────────────────────────
  function select(id: string | null, notify = true) {
    if (selectedId === id) {
      syncOverlay();
      return;
    }
    selectedId = id;
    target.outline(id, OUTLINE);
    syncOverlay();
    if (notify) opts.onSelect?.(id);
  }

  // ── 手势 ───────────────────────────────────────────────────────────
  function capture(e: PointerEvent) {
    try {
      wrap.setPointerCapture(e.pointerId);
    } catch {
      /* 指针已经没了，忽略 */
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (editing || e.button !== 0) return;
    downAt = { x: e.clientX, y: e.clientY };
    pointerMoved = false;
    gestureRan = false;
    const p = localPoint(e);
    const hit = hitTest(root, e.target, p);

    if (hit.kind === 'handle' && selectedId) {
      const start = boxOf(selectedId);
      if (!start) return;
      session = {
        kind: 'resize',
        dir: hit.dir,
        start,
        origin: p,
      };
      gestureBox = start;
      capture(e);
      return;
    }

    if (hit.kind === 'rotate' && selectedId) {
      const start = boxOf(selectedId);
      if (!start) return;
      const center = boxCenter(start);
      session = {
        kind: 'rotate',
        center,
        angle0: angleAt(center, p),
        rotate0: rotateOf(selectedId) ?? 0,
      };
      gestureBox = start;
      gestureRotate = rotateOf(selectedId);
      capture(e);
      return;
    }

    // ⚠️ 与旧实现一致：`mousedown` 只在"按在**已选中**的那层里"才起手势。
    // 按在别的层上只做选中（交给随后的 click），需要再按一次才拖得动。
    if (hit.kind === 'layer' && hit.id === selectedId) {
      const start = boxOf(hit.id);
      if (!start) return;
      session = { kind: 'move', start, origin: p };
      gestureBox = start;
      capture(e);
    }

    gestureRan = session !== null;
  }

  function onPointerMove(e: PointerEvent) {
    if (downAt && !pointerMoved) {
      if (Math.abs(e.clientX - downAt.x) > CLICK_SLOP || Math.abs(e.clientY - downAt.y) > CLICK_SLOP) {
        pointerMoved = true;
      }
    }
    if (!session || !selectedId) return;
    const p = localPoint(e);

    if (session.kind === 'rotate') {
      const deg = rotateDegrees(session, p);
      gestureRotate = deg;
      target.setTransform(selectedId, `rotate(${deg}deg)`);
      if (gestureBox) overlay.show(gestureBox, deg);
      return;
    }

    const box =
      session.kind === 'move'
        ? moveBox(session.start, session.origin, p)
        : resizeBox(session.start, session.dir, session.origin, p, { ratioLock: e.shiftKey });

    gestureBox = box;
    target.setBox(selectedId, box);
    overlay.show(box, rotateOf(selectedId));
  }

  /** 把工作副本里的那一层改成新值（免得下一次手势从旧值起算） */
  function applyLocal(id: string, patch: LayerPatch) {
    const l = layerById(id);
    if (!l) return;
    if (patch.rect) l.rect = { ...patch.rect };
    if (patch.rotate !== undefined) l.transform = { ...(l.transform ?? {}), rotate: patch.rotate };
    if (patch.text !== undefined) l.text = patch.text;
    if (patch.fontScale !== undefined) l.fontScale = patch.fontScale;
    if (patch.weight !== undefined) l.weight = patch.weight;
  }

  function endGesture(commit: boolean) {
    const id = selectedId;
    const s = session;
    session = null;
    if (!id || !s) {
      gestureBox = null;
      gestureRotate = null;
      return;
    }

    // 没真正动过 = 不是一次操作（例如在已选中层上原地单击），不发提交
    const noop =
      s.kind === 'rotate'
        ? gestureRotate === s.rotate0
        : !!gestureBox && gestureBox.left === s.start.left && gestureBox.top === s.start.top &&
          gestureBox.width === s.start.width && gestureBox.height === s.start.height;

    if (commit && !noop) {
      if (s.kind === 'rotate') {
        const deg = gestureRotate ?? s.rotate0;
        const patch: LayerPatch = { rotate: deg };
        applyLocal(id, patch);
        opts.onChange?.(id, patch);
      } else if (gestureBox) {
        const rect = localBoxToRect(gestureBox, canvas);
        const patch: LayerPatch = { rect };
        applyLocal(id, patch);
        opts.onChange?.(id, patch);
      }
    } else if (!commit) {
      // abort：把 DOM 还原成手势起点的样子
      if (s.kind === 'rotate') {
        const r0 = rotateOf(id);
        target.setTransform(id, r0 == null ? null : `rotate(${r0}deg)`);
      } else {
        target.setBox(id, s.start);
      }
    }

    gestureBox = null;
    gestureRotate = null;
    syncOverlay();
  }

  const onPointerUp = () => endGesture(true);
  const onPointerCancel = () => endGesture(false);
  /** 抑制父页面的文字选择（旧实现靠 `mousedown` 里 `preventDefault()`） */
  const onMouseDown = (e: MouseEvent) => {
    if (session) e.preventDefault();
  };

  // ── 选中 / 改字 ────────────────────────────────────────────────────
  function onClick(e: MouseEvent) {
    // 拖拽末尾补出来的那次 click：坐标在松手处，会误改选中 → 吃掉
    const skip = gestureRan || pointerMoved;
    gestureRan = false;
    pointerMoved = false;
    downAt = null;
    if (skip || editing) return;
    const p = localPoint(e);
    const id = hitLayer(root, p);
    if (id) select(id);
    const el = root.elementFromPoint(p.x, p.y);
    const word = el && typeof el.getAttribute === 'function' ? el.getAttribute('data-ve-word') : null;
    if (word && id) opts.onWord?.(id, word);
  }

  function onDblClick(e: MouseEvent) {
    if (editing) return;
    const p = localPoint(e);
    const id = hitLayer(root, p);
    if (!id) return;
    const l = layerById(id);
    // 弧形节点与图片不支持就地改字（与旧实现一致）
    if (!l || l.type !== 'text' || l.curve) return;
    select(id);
    beginEdit(id);
  }

  function onEditFocusOut() {
    // 延后一拍：`contentEditable` 内部挪焦点也会先触发 focusout
    setTimeout(() => {
      if (!editing || !editNode) return;
      if (editNode.contains(editNode.ownerDocument.activeElement)) return;
      endEdit(true);
    }, 0);
  }

  function onEditKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      endEdit(false);
    }
  }

  function beginEdit(id: string) {
    if (editing) endEdit(true);
    const node = target.textNode(id);
    if (!node) return;
    editing = id;
    editNode = node;
    node.addEventListener('focusout', onEditFocusOut);
    node.addEventListener('keydown', onEditKeyDown);
    target.setEditable(id, true);
    opts.onEditingChange?.(true);
  }

  function endEdit(save: boolean) {
    if (!editing) return;
    const id = editing;
    const node = editNode;
    const l = layerById(id);

    if (save && node) {
      const lines = (node.innerText || '').replace(/\n$/, '').split('\n');
      const text = lines.length === 1 ? lines[0] : lines;
      applyLocal(id, { text });
      target.setText(id, text);
      opts.onChange?.(id, { text });
    } else if (node) {
      target.setText(id, l?.text ?? '');
    }

    if (node) {
      node.removeEventListener('focusout', onEditFocusOut);
      node.removeEventListener('keydown', onEditKeyDown);
    }
    target.setEditable(id, false);
    editNode = null;
    editing = null;
    opts.onEditingChange?.(false);
    syncOverlay();
  }

  // ── 键盘（父侧：焦点在 canvas 上时事件落在这里）──────────────────
  // ⚠️ Escape 只清画布，**不通知宿主** —— 与旧 `deselect()` 一致
  // （那条路上宿主面板本来就不复位，见 `_probe-editor-behaviour.ts` 第 8 组）。
  const onKeyDown: EventListener = (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === 'Escape' && !editing) select(null, false);
  };

  // ── 绑定 ───────────────────────────────────────────────────────────
  wrap.addEventListener('pointerdown', onPointerDown);
  wrap.addEventListener('pointermove', onPointerMove);
  wrap.addEventListener('pointerup', onPointerUp);
  wrap.addEventListener('pointercancel', onPointerCancel);
  wrap.addEventListener('mousedown', onMouseDown);
  wrap.addEventListener('click', onClick);
  wrap.addEventListener('dblclick', onDblClick);
  host.addEventListener('keydown', onKeyDown, true);

  function applyHidden() {
    target.applyDisplay(hidden);
  }

  const handle: EditorHandle = {
    attachRoot(next) {
      target.dispose();
      target = createTarget(next);
      applyHidden();
      if (selectedId) target.outline(selectedId, OUTLINE);
      syncOverlay();
    },

    updateLayout(spec, nextAppearance) {
      seed(spec);
      if (nextAppearance) appearance = normalizeAppearance(nextAppearance);
      // 选中的层可能已经不存在了（换版式）
      if (selectedId && !layerById(selectedId)) {
        selectedId = null;
        target.outline(null, OUTLINE);
      }
      applyHidden();
      syncOverlay();
    },

    select(id) {
      select(id, false);
    },

    setHidden(ids) {
      hidden.clear();
      for (const id of ids) hidden.add(id);
      applyHidden();
      // 正在改字的层被藏了 → 先落定；选中的层被藏了 → 取消选中
      if (editing && hidden.has(editing)) endEdit(false);
      if (selectedId && hidden.has(selectedId)) select(null, false);
    },

    patch(id, patch) {
      const l = layerById(id);
      if (!l) return;
      const al = appOf(id);

      if (patch.rect) {
        l.rect = { ...patch.rect };
        target.setBox(id, rectToLocalBox(patch.rect, canvas));
      }
      if (patch.text !== undefined) {
        l.text = patch.text;
        target.setText(id, patch.text);
      }
      if (patch.fontScale !== undefined) {
        l.fontScale = patch.fontScale;
        target.setTextStyle(id, 'font-size', `${Math.round(patch.fontScale * canvas.width)}px`);
      }
      if (patch.weight !== undefined) {
        l.weight = patch.weight;
        target.setTextStyle(id, 'font-weight', `${patch.weight}`);
      }
      if (patch.color !== undefined) {
        al.color = patch.color;
        target.setTextStyle(id, 'color', patch.color);
      }
      if (patch.accents !== undefined) {
        al.accents = patch.accents;
        if (al.accent) delete al.accent; // 多组染色在重渲时生效
      }
      if (patch.accent !== undefined) al.accent = patch.accent;
      if (patch.fill !== undefined) {
        al.fill = patch.fill;
        target.setStyle(id, 'background', patch.fill);
      }
      if (patch.opacity !== undefined) {
        if (patch.opacity >= 1) delete al.opacity;
        else al.opacity = patch.opacity;
        target.setStyle(id, 'opacity', `${patch.opacity}`);
      }
      if (patch.rotate !== undefined) {
        l.transform = { ...(l.transform ?? {}), rotate: patch.rotate };
        target.setTransform(id, `rotate(${patch.rotate}deg)`);
      }

      if (selectedId === id) syncOverlay();
    },

    get selectedId() {
      return selectedId;
    },

    get editing() {
      return editing !== null;
    },

    dispose() {
      if (editing) endEdit(false);
      wrap.removeEventListener('pointerdown', onPointerDown);
      wrap.removeEventListener('pointermove', onPointerMove);
      wrap.removeEventListener('pointerup', onPointerUp);
      wrap.removeEventListener('pointercancel', onPointerCancel);
      wrap.removeEventListener('mousedown', onMouseDown);
      wrap.removeEventListener('click', onClick);
      wrap.removeEventListener('dblclick', onDblClick);
      host.removeEventListener('keydown', onKeyDown, true);
      overlay.dispose();
      target.dispose();
      session = null;
      selectedId = null;
    },
  };

  // 起始状态：把宿主的隐藏集合与选中态应用一次
  applyHidden();
  syncOverlay();

  return handle;
}
