/**
 * UI 崩溃复现探针:打开 5173 → 点产物 → 点 iframe 内元素 → 抓 pageerror/console
 */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 300));
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForSelector('.artifact-card', { timeout: 5000 });
  console.log('── 画廊加载 OK');

  // 点 shirt-PT01 产物卡(它的 title 有 accent:Move/All/Day 三词)
  const card = page.locator('.artifact-card', { hasText: 'shirt-PT01' }).first();
  await card.click();
  await page.waitForTimeout(2500);
  console.log('── 已点产物卡');

  // 进入 iframe(版式编辑模式应加载 srcdoc)
  const frame = page.frames().find((f) => f !== page.mainFrame() && (f.url() === 'about:srcdoc' || f.url() === ''));
  if (!frame) {
    console.log('✗ 未找到 srcdoc iframe——可能仍在 PNG 预览分支');
    const html = await page.content();
    console.log('页面含 preview-image:', html.includes('preview-image'), '| 含 iframe:', html.includes('<iframe'));
    await page.screenshot({ path: '.tmp-run/debug-no-iframe.png' });
    await browser.close();
    return;
  }
  console.log('── srcdoc iframe 已加载');

  // 点击画布里的图层(先照片后标题,触发双色路径)
  await frame.click('[data-layer="hero"]', { timeout: 3000 });
  await page.waitForTimeout(800);
  console.log('── 已点 hero 图层');

  // 再点文字图层(触发面板渲染 + 双色路径)
  await frame.click('[data-layer="title"]', { timeout: 3000 }).catch((e) => console.log('点 title 失败:', e.message.slice(0, 100)));
  await page.waitForTimeout(800);
  console.log('── 已点 title 图层');

  // 点染色 span(Move All Day 的蓝)
  const span = frame.locator('[data-ve-word]').first();
  if (await span.count()) {
    await span.click({ timeout: 2000 }).catch((e) => console.log('点 span 失败:', e.message.slice(0, 100)));
    await page.waitForTimeout(800);
    console.log('── 已点染色 span');
  } else {
    console.log('无 [data-ve-word] span');
  }

  // ── 协议验证:模拟宿主下发 ve:patch(信封修复后面板滑条走的就是这条路)──
  const shapeId = await frame.evaluate(
    () => document.querySelector('[data-layer-type="shape"]')?.getAttribute('data-layer') ?? '',
  );
  console.log('── 测试 shape:', shapeId);

  await frame.evaluate((id) => {
    window.postMessage(
      { source: 'vinart', type: 've:patch', id, patch: { opacity: 0.4 } },
      '*',
    );
  }, shapeId);
  await page.waitForTimeout(400);
  const op = await frame.evaluate(
    (id) => document.querySelector(`[data-layer="${id}"]`)?.getAttribute("style"),
    shapeId,
  );
  console.log('── 图层透明度实时应用:', op, op === '0.4' ? '✓' : '✗ 应为 0.4');

  await frame.evaluate((id) => {
    window.postMessage(
      { source: 'vinart', type: 've:patch', id, patch: { fill: '#FF0000' } },
      '*',
    );
  }, shapeId);
  await page.waitForTimeout(400);
  const bg = await frame.evaluate(
    (id) => document.querySelector(`[data-layer="${id}"]`)?.getAttribute("style"),
    shapeId,
  );
  console.log('── fill 实时应用:', bg, bg?.includes('255, 0, 0') || bg === '#FF0000' || bg === 'rgb(255, 0, 0)' ? '✓' : '');

  await page.screenshot({ path: '.tmp-run/debug-final.png' });
  console.log('── 截图 .tmp-run/debug-final.png');
  await browser.close();
}

main().catch((e) => {
  console.error('探针失败:', e.message);
  process.exit(1);
});
