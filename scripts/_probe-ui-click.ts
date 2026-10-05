/**
 * UI 探针 — 验证「点产物缩略图 → 大图进预览区」的交互链
 *
 * 运行：npm run step scripts/_probe-ui-click.ts
 * 通过标准：截图里预览区出现大图（.preview-image），且 console 无 4xx/5xx。
 */

import { chromium } from 'playwright';
import { resolve } from 'node:path';

const out = resolve('.tmp-run/ui-click.png');

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const bad: string[] = [];
page.on('response', (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
});

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });

// 点第一张产物卡
const card = page.locator('.artifact-card').first();
const cardName = await card.locator('.artifact-name').textContent();
await card.click();

// 等预览区的大图真正加载完
await page.waitForSelector('img.preview-image', { timeout: 10000 });
await page.waitForFunction(
  () => {
    const img = document.querySelector('img.preview-image');
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  },
  { timeout: 15000 },
);

await page.screenshot({ path: out });
await browser.close();

console.log(`点击卡片: ${cardName?.trim()}`);
console.log(bad.length ? `✗ 异常响应:\n${bad.join('\n')}` : '✓ 无 4xx/5xx 响应');
console.log(`已保存 ${out}`);
