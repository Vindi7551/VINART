/**
 * UI 探针 — 验证一键生成表单的折叠/展开
 *
 * 运行：npm run step scripts/_probe-ui-form-collapse.ts
 * 断言:折叠后表单体字段不可见、标题可见;再展开恢复;截图两个状态。
 */

import { chromium } from 'playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });

const header = page.locator('.pipeline-form-header');

// 折叠
await header.click();
await page.waitForTimeout(200);
const collapsedFields = await page.locator('.pipeline-submit').count();
await page.screenshot({ path: resolve('.tmp-run/ui-form-collapsed.png') });

// 展开
await header.click();
await page.waitForTimeout(200);
const expandedFields = await page.locator('.pipeline-submit').count();
await page.screenshot({ path: resolve('.tmp-run/ui-form-expanded.png') });

await browser.close();

console.log(`折叠态提交按钮数: ${collapsedFields}(应为 0)`);
console.log(`展开态提交按钮数: ${expandedFields}(应为 1)`);
console.log(
  collapsedFields === 0 && expandedFields === 1 ? '✓ 表单折叠/展开正常' : '✗ 行为不符合预期',
);
