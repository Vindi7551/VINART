/**
 * 浏览器侧入口（只给 `_probe-editor-textbox.ts` 用）：把真编辑器挂起来。
 *
 * 为什么要有这一层：`createVocabEditor` 是**纯 TS 模块**，没有构建产物；
 * 探针用 esbuild 把它 bundle 成 IIFE，再 `addScriptTag` 进 Chromium。
 */
import { createVocabEditor, type VocabEditorHandle } from '../src/editor/vocab-editor';
import { emitDocument } from '../src/render/vocabulary/emit';
import type { DesignDocument } from '../src/document/vocabulary';

const doc: DesignDocument = {
  canvas: { width: 600, height: 600, background: '#ffffff' },
  layers: [
    {
      id: 'L',
      elements: [
        {
          id: 'tx-h',
          type: 'text',
          frame: { x: 40, y: 40, w: 300 },
          runs: [{ text: '横排文字 horizontal' }],
          fontSizePx: 28,
          fill: '#222',
        },
        {
          id: 'tx-v',
          type: 'text',
          frame: { x: 40, y: 200, w: 168 },
          runs: [{ text: '竖排文字 vertical' }],
          fontSizePx: 28,
          writingMode: 'vertical',
          fill: '#222',
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
    '<div id="wrap" style="position:relative;width:600px;height:600px">' +
    `<iframe id="f" sandbox="allow-same-origin" style="border:0;width:600px;height:600px" srcdoc="${escAttr(html)}"></iframe>` +
    '</div>';
  const frame = document.getElementById('f') as HTMLIFrameElement;
  frame.addEventListener(
    'load',
    () => {
      const root = frame.contentDocument;
      if (!root) throw new Error('iframe contentDocument 拿不到');
      window.__ed = createVocabEditor(document, document.getElementById('wrap')!, root, { doc });
    },
    { once: true },
  );
};
