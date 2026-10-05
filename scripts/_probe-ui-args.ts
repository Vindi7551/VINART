/**
 * UI 探针 — 验证「参数框 → 透传 spawn → 步骤跑完」全链路
 *
 * 用 step-layout 的 sketch 阶段做验收:零 API 成本、秒级完成、exit code 可断言。
 * 参数即终端等价物:test_product/layout/shirt-PT01/design-sketch.json sketch --no-library
 *
 * 运行：npm run step scripts/_probe-ui-args.ts
 */

import { chromium } from 'playwright';
import { resolve } from 'node:path';

const out = resolve('.tmp-run/ui-args.png');
const ARGS = 'test_product/layout/shirt-PT01/design-sketch.json sketch --no-library';

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const bad: string[] = [];
page.on('response', (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
});

await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });

// 找到「07 · 出图」卡片,填参数,点跑
const card = page.locator('.step-item').filter({ hasText: '出图' });
await card.locator('.step-args').fill(ARGS);
await card.locator('.step-btn').click();
console.log(`已点击「出图」并填入参数: ${ARGS}`);

await page.waitForFunction(
  () => document.body.innerText.includes('✓ 完成') || document.body.innerText.includes('✗ 失败'),
  { timeout: 60000 },
);

await page.screenshot({ path: out });
await browser.close();

console.log(bad.length ? `✗ 异常响应:\n${bad.join('\n')}` : '✓ 无 4xx/5xx 响应');
console.log(`已保存 ${out}`);
