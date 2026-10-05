/**
 * 诊断：文字自适应为什么测出来不一样？
 *
 * 自适应系数的算法是 `avail / need`（容器可用宽 / 文字实际需要宽）。
 * 现在 need 只比 avail 大 4% 左右 —— **分母很敏感**，
 * 任何亚像素级的宽度差异都会被放大成可见的系数变化。
 *
 * 这个脚本把四个量的原始值全打出来，看清到底是谁变了：
 *   clientWidth / scrollWidth / getBoundingClientRect().width / 实际文字宽度
 */

import { resolve } from 'node:path';

const HTML = resolve('test_product/layout/split-diagonal/final.linked.html');
const TARGETS = ['headline', 'tab-vorbereiten', 'tab-anrichten', 'banner-3'];

async function main() {
  console.log('\n文字自适应 —— 原始测量值\n' + '─'.repeat(78));

  const { chromium } = await import('playwright');
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
  }

  const page = await browser.newPage();
  await page.setViewportSize({ width: 2000, height: 2000 });
  await page.goto(`file:///${HTML.replace(/\\/g, '/')}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready);

  const rows = await page.evaluate((ids: string[]) => {
    return ids.map((id) => {
      const wrap = document.querySelector(`[data-fit="${id}"]`) as HTMLElement | null;
      const inner = wrap?.querySelector('.btfit') as HTMLElement | null;
      if (!wrap || !inner) return { id, missing: true };

      // 直接量文字本身（用一个脱离文档的 span，排除容器影响）
      const cs = getComputedStyle(inner);
      const probe = document.createElement('span');
      probe.style.cssText =
        `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font};` +
        `letter-spacing:${cs.letterSpacing};`;
      probe.textContent = inner.textContent ?? '';
      document.body.appendChild(probe);
      const textW = probe.getBoundingClientRect().width;
      probe.remove();

      return {
        id,
        missing: false,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily.split(',')[0],
        letterSpacing: cs.letterSpacing,
        padding: cs.paddingLeft + ' / ' + cs.paddingRight,
        innerClientW: inner.clientWidth,
        innerScrollW: inner.scrollWidth,
        innerRectW: Math.round(inner.getBoundingClientRect().width * 100) / 100,
        wrapRectW: Math.round(wrap.getBoundingClientRect().width * 100) / 100,
        textW: Math.round(textW * 100) / 100,
        ratio: inner.scrollWidth > inner.clientWidth ? inner.clientWidth / inner.scrollWidth : 1,
      };
    });
  }, TARGETS);

  for (const r of rows) {
    if (r.missing) {
      console.log(`  ${r.id}: 未找到元素`);
      continue;
    }
    const ratio = (r.ratio as number).toFixed(4);
    console.log(`\n  ${r.id}`);
    console.log(`      字号 ${r.fontSize}   字体 ${r.fontFamily}   字距 ${r.letterSpacing}`);
    console.log(`      内层 padding ${r.padding}`);
    console.log(`      容器宽 ${r.wrapRectW}  内层 rect ${r.innerRectW}  client ${r.innerClientW}`);
    console.log(`      scrollWidth ${r.innerScrollW}   纯文字宽 ${r.textW}`);
    console.log(
      `      scroll - client = ${(r.innerScrollW as number) - (r.innerClientW as number)}  ` +
        `→ 系数 ${ratio}`,
    );
  }

  await page.close();
  await browser.close();
  console.log();
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
