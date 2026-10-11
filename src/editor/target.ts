/**
 * 目标适配器 —— **`src/editor/` 里唯一接触「子文档」的地方**。
 *
 * 它是"编辑器只能作用于子文档、不能改父页面"这条约束的**结构性**落点：
 * 编辑器其余部分（几何 / 命中 / 工具 / 覆盖层）只拿到本文件暴露的
 * 那几个方法，**拿不到别的文档**。不是靠沙箱强制的——沙箱会把编辑器
 * 逼回"注入进子文档"的老路（见 `docs/EDITOR-EVOLUTION.md` §4.4）。
 *
 * 因此：文档对象一律**从构造参数流入**，本文件（以及整个 `src/editor/`）
 * 不认识"当前页面"是谁。断言命令见 `src/editor/README.md`。
 *
 * 分工：本文件只管**读写 DOM**，不管"什么时候读、读来干什么"。
 * 手势解算在 `geometry.ts`（纯函数），命中在 `hit-test.ts`，
 * 编排在 `index.ts`。
 */

import type { LayerDom, LocalBox } from './types';

const LAYER_SEL = '[data-layer]';
const TEXT_SEL = '.btfit';

/** `Element` → `HTMLElement`（`style` / `contentEditable` 只在后者上） */
function h(el: Element | null): HTMLElement | null {
  return el ? (el as HTMLElement) : null;
}

/** 属性值里的引号转义 —— 不依赖 `CSS.escape`（那是全局对象） */
function attrValue(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}

function layerSelector(id: string): string {
  return `[data-layer="${attrValue(id)}"]`;
}

function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 文本（`string | string[]`）→ 渲染器认的 `<br>` 结构 */
export function textToHtml(text: string | string[]): string {
  const lines = Array.isArray(text) ? text : String(text).split('\n');
  return lines.map(escHtml).join('<br>');
}

export interface EditorTarget {
  /** 子文档（`iframe.contentDocument` / `ShadowRoot` / 测试假对象） */
  readonly root: LayerDom;
  /** 当前 DOM 里所有图层的 id，按文档顺序 */
  layerIds(): string[];
  layer(id: string): HTMLElement | null;
  /** 该层里承载文字的节点（`.btfit`），没有则 null */
  textNode(id: string): HTMLElement | null;
  /** 只写几何快路径（手势期间每帧调，绕过 React） */
  setBox(id: string, box: LocalBox): void;
  /** 写任意内联样式到**图层容器**（填充/透明度/几何之外的东西） */
  setStyle(id: string, prop: string, value: string): void;
  /** 写任意内联样式到**文字节点** `.btfit`（字号/字重/颜色）——
   *  ⚠️ 渲染器把这三项写在 `.btfit` 上、把填充/透明度写在容器上，
   *  所以这里必须分开，不能合并成一个 `setStyle`。 */
  setTextStyle(id: string, prop: string, value: string): void;
  /** 写文字内容（**只对 `.btfit`**，保留渲染器的行结构） */
  setText(id: string, text: string | string[]): void;
  /** 写 `transform`（旋转/斜切）。传 `null` = 清掉 */
  setTransform(id: string, css: string | null): void;
  /** 选中描边。`id = null` 只清除、不新设 */
  outline(id: string | null, css: string): void;
  /** 整集重放可视性（幂等；**不进 spec**，属编辑器视角态） */
  applyDisplay(hidden: ReadonlySet<string>): void;
  /** 进/出就地改字：`contentEditable` + 聚焦 + 全选 */
  setEditable(id: string, on: boolean): void;
  /** 卸下所有痕迹（React StrictMode 双挂载 / HMR 会重复 attach） */
  dispose(): void;
}

export function createTarget(root: LayerDom): EditorTarget {
  /** 记着自己改过什么，`dispose()` 才有得清 */
  const touched = { outline: null as HTMLElement | null, editable: null as HTMLElement | null };

  const api: EditorTarget = {
    root,

    layerIds() {
      const list = root.querySelectorAll(LAYER_SEL);
      const ids: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const id = list[i].getAttribute('data-layer');
        if (id) ids.push(id);
      }
      return ids;
    },

    layer(id) {
      return h(root.querySelector(layerSelector(id)));
    },

    textNode(id) {
      return h(root.querySelector(`${layerSelector(id)} ${TEXT_SEL}`));
    },

    setBox(id, box) {
      const el = api.layer(id);
      if (!el) return;
      el.style.left = `${box.left}px`;
      el.style.top = `${box.top}px`;
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
    },

    setStyle(id, prop, value) {
      const el = api.layer(id);
      if (el) el.style.setProperty(prop, value);
    },

    setTextStyle(id, prop, value) {
      const node = api.textNode(id);
      if (node) node.style.setProperty(prop, value);
    },

    setText(id, text) {
      const node = api.textNode(id);
      if (node) node.innerHTML = textToHtml(text);
    },

    setTransform(id, css) {
      const el = api.layer(id);
      if (el) el.style.transform = css ?? '';
    },

    outline(id, css) {
      if (touched.outline && touched.outline !== (id ? api.layer(id) : null)) {
        touched.outline.style.outline = '';
        touched.outline = null;
      }
      if (id) {
        const el = api.layer(id);
        if (el) {
          el.style.outline = css;
          touched.outline = el;
        }
      }
    },

    applyDisplay(hidden) {
      const list = root.querySelectorAll(LAYER_SEL);
      for (let i = 0; i < list.length; i++) {
        const el = h(list[i]);
        if (!el) continue;
        const id = el.getAttribute('data-layer') || '';
        el.style.display = hidden.has(id) ? 'none' : '';
      }
    },

    setEditable(id, on) {
      const on_ = touched.editable;
      if (on_ && (on_ !== api.textNode(id) || !on)) {
        on_.contentEditable = 'false';
        on_.style.outline = '';
        on_.style.cursor = '';
        touched.editable = null;
      }
      if (!on) return;
      const node = api.textNode(id);
      if (!node) return;
      node.contentEditable = 'true';
      node.style.outline = '1px dashed #1b6fd1';
      node.style.cursor = 'text';
      node.focus();
      // ⚠️ 选区必须取**该节点自己那份文档**的选区，不能用全局的
      const doc = node.ownerDocument;
      const range = doc.createRange();
      range.selectNodeContents(node);
      const sel = doc.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      touched.editable = node;
    },

    dispose() {
      if (touched.outline) touched.outline.style.outline = '';
      if (touched.editable) {
        touched.editable.contentEditable = 'false';
        touched.editable.style.outline = '';
        touched.editable.style.cursor = '';
      }
      touched.outline = null;
      touched.editable = null;
    },
  };

  return api;
}
