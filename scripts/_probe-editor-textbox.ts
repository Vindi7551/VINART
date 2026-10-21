/**
 * 探针：**真编辑器里的选中框** = 文字的实测框（不是一条线）。
 *
 * 用户截图里的症状：竖排文字的选中框是**一条横线**、文字一半在框外。
 * 根因：文字的 `.vt` 还是 `position:absolute` ⇒ 外层 `height:auto` 塌成 0。
 *
 * 这条探针走的是**真链路**：`emitDocument` → 真 iframe → `createVocabEditor`
 * → `select('tx-v')` → 量覆盖层（`[data-ve-overlay]`）的屏幕矩形。
 *
 * 断言：
 *   ① 选中框 top/left = `frame.y` / `frame.x`
 *   ② 选中框高度 = 文字本体（`[data-fit]`）的高度，且 > 0
 *   ③ 选中框宽度 = `frame.w`
 *
 * 运行：
 *   node --experimental-transform-types --import ./scripts/_ts-resolve.mjs scripts/_probe-editor-textbox.ts
 */
import { chromium } from 'playwright';
import { buildSync } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('.tmp-run/probe-editor-textbox.js');
mkdirSync(resolve('.tmp-run'), { recursive: true });
buildSync({
  entryPoints: [resolve('scripts/_probe-editor-textbox.entry.ts')],
  bundle: true,
  format: 'iife',
  outfile: OUT,
  logLevel: 'silent',
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.setContent('<!DOCTYPE html><html><body style="margin:0"></body></html>');
await page.addScriptTag({ path: OUT });
await page.evaluate(() => window.__boot?.());
await page.waitForFunction(() => !!window.__ed, null, { timeout: 10_000 });

const got = await page.evaluate(() => {
  const ed = window.__ed!;
  ed.select('tx-v');
  const ov = document.querySelector('[data-ve-overlay]') as HTMLElement;
  const dom = (document.getElementById('f') as HTMLIFrameElement).contentDocument!;
  const box = (el: Element) => {
    const b = el.getBoundingClientRect();
    return {
      left: +b.left.toFixed(2),
      top: +b.top.toFixed(2),
      width: +b.width.toFixed(2),
      height: +b.height.toFixed(2),
    };
  };
  return {
    overlay: box(ov),
    layer: box(dom.querySelector('[data-layer="tx-v"]')!),
    text: box(dom.querySelector('[data-fit="tx-v"]')!),
  };
});

await page.screenshot({ path: '.tmp-probe-editor-textbox.png' });
await browser.close();

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg);
};
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

ok(near(got.overlay.left, 40), `选中框 left=${got.overlay.left}，应为 frame.x=40`);
ok(near(got.overlay.top, 200), `选中框 top=${got.overlay.top}，应为 frame.y=200`);
ok(near(got.overlay.width, 168), `选中框宽=${got.overlay.width}，应为 frame.w=168`);
ok(got.overlay.height > 0, `选中框高=${got.overlay.height}（塌成一条线了）`);
ok(
  near(got.overlay.height, got.text.height),
  `选中框高=${got.overlay.height} ≠ 文字高=${got.text.height}`,
);
ok(near(got.text.top, 200), `文字 top=${got.text.top}，应为 frame.y=200`);
ok(near(got.layer.height, got.text.height), `外层高=${got.layer.height} ≠ 文字高=${got.text.height}`);

console.log(JSON.stringify(got, null, 2));
if (fails.length) {
  console.error(`\n✗ ${fails.length} 条断言失败：`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('\n✓ 选中框 = 文字实测框（顶边对齐 frame.y，不是一条线）');
