/**
 * UI 探针 — 端到端验证「点步骤按钮 → SSE 日志流 → 步骤跑完」
 *
 * 会真实调用一次 step-01（DeepSeek 视觉识别，约 1k tokens）。
 * 通过标准：log 气泡出现「✓ 完成」，console 无新增 4xx/5xx。
 *
 * 运行：npm run step scripts/_probe-ui-run.ts
 */

import { chromium } from 'playwright';
import { resolve } from 'node:path';

const out = resolve('.tmp-run/ui-run.png');

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const bad: string[] = [];
page.on('response', (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
});

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });

// 点第一个步骤按钮
const btn = page.locator('.step-btn').first();
const label = await btn.locator('.step-btn-label').textContent();
await btn.click();
console.log(`点击步骤: ${label?.trim()}`);

// 等 log 气泡出现并跑完（step-01 一次视觉识别约 10-60s）
await page.waitForFunction(
  () => document.body.innerText.includes('✓ 完成') || document.body.innerText.includes('✗'),
  { timeout: 120000 },
);

await page.screenshot({ path: out });
await browser.close();

console.log(bad.length ? `✗ 异常响应:\n${bad.join('\n')}` : '✓ 无 4xx/5xx 响应');
console.log(`已保存 ${out}`);
