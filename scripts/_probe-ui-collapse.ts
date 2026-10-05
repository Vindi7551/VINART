/**
 * UI 探针 — 验证步骤面板折叠/展开
 *
 * 运行：npm run step scripts/_probe-ui-collapse.ts
 * 产出：.tmp-run/ui-collapsed.png(折叠态)+ .tmp-run/ui-expanded.png(展开态)
 */

import { chromium } from 'playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });

const header = page.locator('.step-panel-header');

// 折叠
await header.click();
await page.waitForTimeout(200);
const collapsedCards = await page.locator('.step-item').count();
await page.screenshot({ path: resolve('.tmp-run/ui-collapsed.png') });

// 展开
await header.click();
await page.waitForTimeout(200);
const expandedCards = await page.locator('.step-item').count();
await page.screenshot({ path: resolve('.tmp-run/ui-expanded.png') });

await browser.close();

console.log(`折叠态卡片数: ${collapsedCards}(应为 0)`);
console.log(`展开态卡片数: ${expandedCards}(应为 7)`);
console.log(
  collapsedCards === 0 && expandedCards === 7
    ? '✓ 折叠/展开正常'
    : '✗ 折叠行为不符合预期',
);
