/**
 * 浏览器侧入口（只给 `_probe-editor-ime.ts` 用）：两段文字 + 真编辑器。
 *
 * - `p`：单段长文，`wrap:'normal'`，量"打字换行后选中框更不更新"；
 * - `q`：两段 runs（不同颜色），模拟中文输入法组合态（段中 / 跨段 / 取消）。
 */
import { createVocabEditor, type VocabEditorHandle } from '../src/editor/vocab-editor';
import { emitDocument, emitElementHtml } from '../src/render/vocabulary/emit';
import { findElement, type DesignDocument } from '../src/document/vocabulary';

const doc: DesignDocument = {
  canvas: { width: 600, height: 500, background: '#ffffff' },
  layers: [
    {
      id: 'L',
      elements: [
        {
          id: 'p',
          type: 'text',
          frame: { x: 30, y: 30, w: 220 },
          wrap: 'normal',
          fontSizePx: 20,
          lineHeight: 1.4,
          fill: '#222222',
          runs: [{ text: '开头' }],
        },
        {
          id: 'q',
          type: 'text',
          frame: { x: 30, y: 300, w: 300 },
          wrap: 'normal',
          fontSizePx: 24,
          lineHeight: 1.4,
          runs: [
            { text: 'Hello ', fill: '#222222' },
            { text: 'world', fill: '#cc0000' },
          ],
        },
      ],
    },
  ],
};

declare global {
  interface Window {
    __ed?: VocabEditorHandle;
    __boot?: () => void;
  }
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

window.__boot = () => {
  const { html } = emitDocument(doc);
  document.body.innerHTML =
    '<div id="wrap" style="position:relative;width:600px;height:500px">' +
    `<iframe id="f" sandbox="allow-same-origin" style="border:0;width:600px;height:500px" srcdoc="${escAttr(html)}"></iframe>` +
    '</div>';
  const frame = document.getElementById('f') as HTMLIFrameElement;
  frame.addEventListener(
    'load',
    () => {
      const root = frame.contentDocument;
      if (!root) throw new Error('iframe contentDocument 拿不到');
      window.__ed = createVocabEditor(document, document.getElementById('wrap')!, root, {
        doc,
        // 仿真宿主：面板改字段后把该节点重发进 iframe（双写）
        onChange: (id, next) => {
          if (!id) return;
          const realm = frame.contentDocument;
          const dom = realm?.querySelector(`[data-layer="${id.replace(/["\\]/g, '\\$&')}"]`);
          const el = findElement(next, id);
          if (!realm || !dom || !el) return;
          dom.insertAdjacentHTML('beforebegin', emitElementHtml(el, next.canvas).html);
          dom.remove();
          window.__ed?.refreshDom();
        },
      });
    },
    { once: true },
  );
};
