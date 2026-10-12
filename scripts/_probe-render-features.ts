/**
 * 验证新增的两个渲染能力：`selector`（截元素）与 `transparent`（透明背景）。
 *
 * 不能只看代码对——要拿到图上验证：
 *   1. selector：输出的像素尺寸是否等于该元素的实测尺寸；内容是否只有那块
 *   2. transparent：PNG 是否真的带 alpha 通道，且**确实存在全透明像素**
 *   3. 透明背景的**适用边界**：内层容器自己设了背景色时，透明是不生效的——
 *      这是刻意设计（无差别清背景会把设计毁掉），但必须用实验说清楚
 *
 * 读 PNG 头取色深/颜色类型；再用浏览器 canvas 反解像素统计 alpha 分布。
 */

import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('test_product/render-probe');

/** A：内容层**有**背景色（说明透明不会自动生效） */
const HTML_WITH_BG = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:800px;height:600px;overflow:hidden}
  .canvas{width:800px;height:600px;background:#120C07;position:relative}
  .title{position:absolute;left:40px;top:40px;color:#F2E8DA;font:700 48px Arial}
  .badgebar{position:absolute;left:0;top:480px;width:800px;height:120px;
            background:#B8722F;display:flex;align-items:center;justify-content:center}
  .badgebar span{color:#fff;font:700 40px Arial}
</style></head><body><div class="canvas">
  <div class="title">Akazienholz</div>
  <div class="badgebar"><span>Messerfreundlich</span></div>
</div></body></html>`;

/** B：内容层**没有**背景色（透明能生效的正确写法） */
const HTML_NO_BG = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:800px;height:600px;overflow:hidden;background:transparent}
  .title{position:absolute;left:40px;top:40px;color:#B8722F;font:700 64px Arial}
  .ring{position:absolute;left:40px;top:200px;width:200px;height:200px;
        border:8px solid #B8722F;border-radius:50%}
</style></head><body>
  <div class="title">Akazienholz</div>
  <div class="ring"></div>
</body></html>`;

interface PngInfo {
  w: number;
  h: number;
  bitDepth: number;
  colorType: number;
  hasAlphaChannel: boolean;
}

function readPngHeader(path: string): PngInfo {
  const b = readFileSync(path);
  const sig = b.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error('不是 PNG：' + path);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const bitDepth = b[24];
  const colorType = b[25];
  // 颜色类型：0 灰度 / 2 RGB / 3 调色板 / 4 灰度+alpha / 6 RGBA
  return { w, h, bitDepth, colorType, hasAlphaChannel: colorType === 4 || colorType === 6 };
}

async function main() {
  console.log('\n' + '═'.repeat(68));
  console.log('验证：selector（截元素）与 transparent（透明背景）');
  console.log('═'.repeat(68));
  mkdirSync(OUT, { recursive: true });

  const { createBlinkRenderer } = await import('../src/render/rasterize/blink-renderer');
  const renderer = createBlinkRenderer();

  const { chromium } = await import('playwright');
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
  }

  /** 用浏览器反解 PNG 的 alpha 分布 */
  async function alphaStats(path: string) {
    const page = await browser.newPage();
    const b64 = readFileSync(path).toString('base64');
    const r = await page.evaluate(async (d: string) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + d;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let zero = 0, full = 0, partial = 0;
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] === 0) zero++;
        else if (px[i] === 255) full++;
        else partial++;
      }
      const t = zero + full + partial;
      return { zero: zero / t, full: full / t, partial: partial / t, w: c.width, h: c.height };
    }, b64);
    await page.close();
    return r;
  }

  try {
    // ══════ ① selector ══════
    console.log('\n① selector — 只截元素');
    const full = await renderer.render({ html: HTML_WITH_BG }, OUT, {
      width: 800, height: 600, deviceScaleFactor: 1, format: 'png', filename: 'A-full',
    });
    const el = await renderer.render({ html: HTML_WITH_BG }, OUT, {
      width: 800, height: 600, deviceScaleFactor: 1, format: 'png', filename: 'A-badgebar',
      selector: '.badgebar',
    });
    const fi = readPngHeader(full.imagePath);
    const ei = readPngHeader(el.imagePath);
    console.log(`    整幅   ：返回 ${full.width}×${full.height}，PNG 实际 ${fi.w}×${fi.h}`);
    console.log(`    元素   ：返回 ${el.width}×${el.height}，PNG 实际 ${ei.w}×${ei.h}`);
    const expectH = 120; // .badgebar 的高度
    console.log(
      `    期望   ：.badgebar 为 800×${expectH} → ` +
        (ei.w === 800 && ei.h === expectH ? '✓ 尺寸正确' : '✗ 尺寸不符'),
    );

    // ══════ ② transparent（内容层有背景 → 不应透明）══════
    console.log('\n② transparent — 内容层**有**背景色时应保持不透明（刻意的设计边界）');
    const aOpaque = await renderer.render({ html: HTML_WITH_BG }, OUT, {
      width: 800, height: 600, deviceScaleFactor: 1, format: 'png', filename: 'A-transparent',
      transparent: true,
    });
    const ai = readPngHeader(aOpaque.imagePath);
    const as = await alphaStats(aOpaque.imagePath);
    console.log(`    PNG 颜色类型 ${ai.colorType}（6=RGBA）→ ${ai.hasAlphaChannel ? '有 alpha 通道' : '无 alpha 通道'}`);
    console.log(`    透明像素占比 ${(as.zero * 100).toFixed(1)}%　不透明 ${(as.full * 100).toFixed(1)}%`);
    console.log(
      `    → ${as.zero < 0.01 ? '✓ 全不透明（符合预期：.canvas 有自己的背景色）' : '⚠️ 出现了透明像素，需复核'}`,
    );

    // ══════ ③ transparent（内容层无背景 → 应透明）══════
    console.log('\n③ transparent — 内容层**无**背景色时应真的透明');
    const bTrans = await renderer.render({ html: HTML_NO_BG }, OUT, {
      width: 800, height: 600, deviceScaleFactor: 1, format: 'png', filename: 'B-transparent',
      transparent: true,
    });
    const bi = readPngHeader(bTrans.imagePath);
    const bs = await alphaStats(bTrans.imagePath);
    console.log(`    PNG 颜色类型 ${bi.colorType}（6=RGBA）→ ${bi.hasAlphaChannel ? '有 alpha 通道' : '无 alpha 通道'}`);
    console.log(`    透明像素占比 ${(bs.zero * 100).toFixed(1)}%　不透明 ${(bs.full * 100).toFixed(1)}%`);
    console.log(
      `    → ${bs.zero > 0.5 ? '✓ 大面积透明（符合预期）' : '✗ 没有透明像素，功能未生效'}`,
    );

    // 对照：同样的 HTML 不开 transparent
    const bOpaque = await renderer.render({ html: HTML_NO_BG }, OUT, {
      width: 800, height: 600, deviceScaleFactor: 1, format: 'png', filename: 'B-opaque',
    });
    const bos = await alphaStats(bOpaque.imagePath);
    console.log(`    对照（不开 transparent）：透明像素占比 ${(bos.zero * 100).toFixed(1)}%`);

    console.log(`\n产出目录：${OUT}\n`);
  } finally {
    await browser.close();
    await renderer.dispose();
  }
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
