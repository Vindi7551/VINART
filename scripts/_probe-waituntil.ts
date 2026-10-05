/**
 * 验证：我们的渲染器用 `waitUntil: 'networkidle'` 是不是白等？
 *
 * 起因：查 node-html-to-image 时发现它的文档明确写着
 * 「puppeteer no longer supports networkidle0/networkidle2 for setContent」，
 * 并把默认值改成了 `load`。
 *
 * 我们的 HTML 是**自包含**的：图片全是 data URL，字体是系统字体，**没有任何外部请求**。
 * 如果真是这样，`networkidle` 就是在等一个永远不会发生的网络静默，纯属白等。
 *
 * 本脚本对同一份 HTML 分别用 load / domcontentloaded / networkidle 各渲 5 次取中位数。
 */

import { resolve } from 'node:path';

const HTML_PATH = resolve('test_product/layout/banner-topleft/final.linked.html');
const N = 5;

async function main() {
  const fs = await import('node:fs');
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
  }

  // 统计 HTML 里有多少外部请求（非 data: 的 src/href）
  const external = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('data:') && !u.startsWith('#'));
  console.log(`\nHTML 中的外部资源引用：${external.length} 个`);
  if (external.length) external.slice(0, 5).forEach((u) => console.log(`  - ${u.slice(0, 80)}`));

  console.log(`\n每种 waitUntil 各渲 ${N} 次：\n`);
  for (const waitUntil of ['load', 'domcontentloaded', 'networkidle'] as const) {
    const times: number[] = [];
    for (let i = 0; i < N; i++) {
      const ctx = await browser.newContext({ viewport: { width: 2000, height: 2000 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.setContent(html, { waitUntil });
      await page.evaluate(() => document.fonts?.ready);
      await page.screenshot({ type: 'png' });
      times.push(Date.now() - t0);
      await ctx.close();
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(N / 2)];
    console.log(`  ${waitUntil.padEnd(18)} 中位 ${String(median).padStart(5)}ms   全部 [${times.join(', ')}]`);
  }

  await browser.close();
  console.log();
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
