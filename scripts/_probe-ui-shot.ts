/**
 * UI 探针 — 用项目自带的 playwright 给 dev server 截图
 *
 * 用途：改完壳之后肉眼验收。比 chrome --headless --screenshot 可靠：
 * 会等 networkidle（vite 首访要转换一堆模块，固定延时不可靠）。
 *
 * 运行：
 *   npm run step scripts/_probe-ui-shot.ts
 *   npm run step scripts/_probe-ui-shot.ts -- http://localhost:5173 out.png
 */

import { chromium } from 'playwright';
import { resolve } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173';
const out = resolve(process.argv[3] ?? '.tmp-run/ui-shot.png');

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 把控制台错误打出来——白屏时能直接看到根因
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console.error]', msg.text());
});
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(500); // 等最后一帧
await page.screenshot({ path: out });
await browser.close();

console.log(`已保存 ${out}`);
