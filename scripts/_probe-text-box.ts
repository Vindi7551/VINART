/**
 * 探针：文字节点的**框真的贴着字**（2026-10-17 的 `height:auto` 契约）。
 *
 * 断言的硬事实（都在真 Chromium 里量）：
 *   ① 普通文字的外层 `[data-layer]` 高度 **> 0**，且 **= 内层 `[data-fit]` 的高度**
 *      —— 内层一旦退回 `position:absolute`，外层 `height:auto` 会塌成 0 ⇒ 选中框成一条线。
 *   ② 外层 / 内层的 **top 都等于 `frame.y`**（文字从框顶开始，不再"竖着居中"在框顶上）。
 *   ③ 竖排：外层高度 **≥ 一根字高**（竖排的 inline 轴是**高度**，随字数长）。
 *
 * 反向验证：`--legacy` 会把内层还原成旧样式（absolute + top:50% + translateY），
 * 此时 ① 必须**失败** —— 否则这条探针是假绿。
 *
 * 运行：
 *   node --experimental-transform-types --import ./scripts/_ts-resolve.mjs scripts/_probe-text-box.ts
 *   node --experimental-transform-types --import ./scripts/_ts-resolve.mjs scripts/_probe-text-box.ts --legacy
 */
import { chromium } from 'playwright';
import { emitDocument } from '../src/render/vocabulary/emit.ts';
import type { DesignDocument } from '../src/document/vocabulary.ts';

const LEGACY = process.argv.includes('--legacy');

const H = { x: 40, y: 40, w: 300 };
const V = { x: 40, y: 200, w: 168 };

const doc: DesignDocument = {
  canvas: { width: 600, height: 600, background: '#ffffff' },
  layers: [
    {
      id: 'L',
      elements: [
        {
          id: 'tx-h',
          type: 'text',
          frame: H,
          runs: [{ text: '横排文字 horizontal' }],
          fontSizePx: 28,
          fill: '#222',
        },
        {
          id: 'tx-v',
          type: 'text',
          frame: V,
          runs: [{ text: '竖排文字 vertical' }],
          fontSizePx: 28,
          writingMode: 'vertical',
          fill: '#222',
        },
        {
          // 空文字：删光之后也得占一行（否则框塌成 0，节点再也点不中）
          id: 'tx-empty',
          type: 'text',
          frame: { x: 400, y: 40, w: 120 },
          runs: [{ text: '' }],
          fontSizePx: 28,
          fill: '#222',
        },
      ],
    },
  ],
};

const { html, unsupported } = emitDocument(doc);
if (unsupported.length) throw new Error(`emit 有丢字段：${JSON.stringify(unsupported)}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts?.ready);
if (LEGACY) {
  await page.addStyleTag({
    content:
      '[data-fit]{position:absolute !important;left:0 !important;right:0 !important;' +
      'top:50% !important;transform:translateY(-50%) !important;width:auto !important}',
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

const measured = await page.evaluate(() => {
  const one = (id: string) => {
    const layer = document.querySelector(`[data-layer="${id}"]`) as HTMLElement;
    const inner = document.querySelector(`[data-fit="${id}"]`) as HTMLElement;
    const lr = layer.getBoundingClientRect();
    const ir = inner.getBoundingClientRect();
    return {
      layer: { top: +lr.top.toFixed(2), left: +lr.left.toFixed(2), h: +lr.height.toFixed(2), w: +lr.width.toFixed(2) },
      inner: { top: +ir.top.toFixed(2), left: +ir.left.toFixed(2), h: +ir.height.toFixed(2), w: +ir.width.toFixed(2) },
      layerOffH: layer.offsetHeight,
      innerOffH: inner.offsetHeight,
    };
  };
  return { h: one('tx-h'), v: one('tx-v'), empty: one('tx-empty') };
});

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg);
};

// ① 外层高度 = 内层高度，且 > 0
ok(measured.h.layerOffH > 0, `[横排] 外层高度 = ${measured.h.layerOffH}（必须 > 0）`);
ok(
  Math.abs(measured.h.layerOffH - measured.h.innerOffH) <= 1,
  `[横排] 外层 ${measured.h.layerOffH} ≠ 内层 ${measured.h.innerOffH}`,
);
ok(measured.v.layerOffH > 0, `[竖排] 外层高度 = ${measured.v.layerOffH}（必须 > 0）`);
ok(
  Math.abs(measured.v.layerOffH - measured.v.innerOffH) <= 1,
  `[竖排] 外层 ${measured.v.layerOffH} ≠ 内层 ${measured.v.innerOffH}`,
);
ok(measured.empty.layerOffH > 0, `[空文字] 外层高度 = ${measured.empty.layerOffH}（必须占一行）`);
// ② 从 frame.y 开始（不再竖着居中在框顶）
ok(Math.abs(measured.h.layer.top - H.y) <= 1, `[横排] 外层 top=${measured.h.layer.top}，应为 frame.y=${H.y}`);
ok(Math.abs(measured.h.inner.top - H.y) <= 1, `[横排] 文字 top=${measured.h.inner.top}，应为 frame.y=${H.y}`);
ok(Math.abs(measured.v.layer.top - V.y) <= 1, `[竖排] 外层 top=${measured.v.layer.top}，应为 frame.y=${V.y}`);
ok(Math.abs(measured.v.inner.top - V.y) <= 1, `[竖排] 文字 top=${measured.v.inner.top}，应为 frame.y=${V.y}`);
// ③ 竖排的高度是"字的长度"，至少一根字高
ok(measured.v.layerOffH >= 28, `[竖排] 高度 ${measured.v.layerOffH} < 一个字号 28`);
ok(measured.v.layerOffH > measured.v.layer.w, `[竖排] 高度 ${measured.v.layerOffH} 应大于列宽 ${measured.v.layer.w}`);

await page.screenshot({ path: LEGACY ? '.tmp-probe-text-legacy.png' : '.tmp-probe-text.png' });
await browser.close();

console.log(JSON.stringify({ legacy: LEGACY, measured }, null, 2));
if (fails.length) {
  console.error(`\n✗ ${fails.length} 条断言失败：`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('\n✓ 探针通过：框高 = 文字高度，且从 frame.y 开始');
