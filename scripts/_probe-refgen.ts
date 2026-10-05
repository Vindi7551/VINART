/**
 * 探针：生成模型能不能【保真地】把商品放进场景？
 *
 * 这是决定架构的关键实验，不能靠推断。
 *
 * 要回答的问题：
 *   1. seedream 的 image 参数接受 data URL 吗？
 *   2. 给它商品照 + 场景提示词，它会把真实商品放进去，还是重画一个"像但不是"的？
 *   3. 木纹走向、雕刻文字、弧边轮廓——这些保真细节能守住吗？
 *
 * 判断标准（第 2 张图出来后再回答）：
 *   若模型能守住商品外观 → 「版式约束 + 参考图」的生成式架构可行，光影融合由模型负责
 *   若商品走形          → 必须回到「合成」路线，商品只能来自像素级抠图
 *
 * 运行：npm run step scripts/_probe-refgen.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getImageGateway } from '../src/config';

const PRODUCT = resolve('test_product/af39f425-770e-472e-a21e-6964f7864974.png');
const OUT_DIR = resolve('test_product/probe');

/** 参考图要控制在合理体积内：原图 2.6MB base64 对参考图来说太大 */
const REF_MAX = 768;

async function main() {
  console.log('\n' + '═'.repeat(66));
  console.log('探针 — 生成模型能否保真地把商品放进场景');
  console.log('═'.repeat(66));

  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
  }

  try {
    // ── 1. 把商品照压小并转成 data URL ──
    const page = await browser.newPage();
    const raw = readFileSync(PRODUCT).toString('base64');

    const ref = await page.evaluate(
      async (args: { b64: string; max: number }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${args.b64}`;
        await img.decode();

        const scale = Math.min(1, args.max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);

        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d')!;
        // 参考图铺白底，避免透明区被模型误读
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const jpeg = c.toDataURL('image/jpeg', 0.9);
        return { dataUrl: jpeg, w, h, chars: jpeg.length };
      },
      { b64: raw, max: REF_MAX },
    );
    await page.close();

    console.log(`\n[1] 参考图`);
    console.log(`    原始 : ${(raw.length / 1024 / 1024).toFixed(2)} MB (base64)`);
    console.log(`    压缩 : ${ref.w}×${ref.h}，${(ref.chars / 1024).toFixed(0)} KB (base64 jpeg)`);

    // ── 2. 场景提示词（与 PT01 设计草案一致，但明确要求把参考图中的商品放进去）──
    const prompt = [
      'Fotorealistische Produktaufnahme zum Thema 40. Geburtstag.',
      'Stelle das Produkt aus dem Referenzbild unverändert in die Szene:',
      'das Holzbrett mit der Gravur «KLASSIKER 40» auf dem schwarzen Metallständer.',
      'Szene: festlich gedeckte Geburtstagstafel im warmen Abendlicht, Torte mit Kerzen,',
      'Teller, Gläser, Blumen, unscharfe Luftballons im Hintergrund, geringe Schärfentiefe.',
      'Das Brett steht aufrecht im Ständer in der Tischmitte und ist der Blickfang.',
      '',
      'Wichtig: Das Brett muss exakt wie im Referenzbild aussehen –',
      'gleiche Holzmaserung, gleiche Gravur «KLASSIKER 40», gleiche Form, gleicher Ständer.',
      'Keine Personen, keine Schriften im Bild, keine Logos, kein Wasserzeichen.',
    ].join(' ');

    const gateway = getImageGateway();

    console.log(`\n[2] 提交：参考图(商品照) + 场景提示词`);
    console.log(`    提示词 ${prompt.length} 字符`);

    const t0 = Date.now();
    let result;
    try {
      result = await gateway.generate({
        prompt,
        referenceImages: [ref.dataUrl],
        size: '2048x2048',
        count: 1,
        format: 'png',
      });
      console.log(`    ✓ 完成 ${Date.now() - t0}ms　模型 ${result.model}`);
    } catch (e) {
      console.log(`    ✗ data URL 作为参考图失败：${(e as Error).message.split('\n')[0]}`);
      console.log('\n    → 说明 seedream 不接受 data URL 参考图，需要可公网访问的 URL 或 Files 上传。');
      console.log('      这本身就是架构结论：本地图必须先上传拿到 URL 才能做参考图。');
      return;
    }

    // ── 3. 下载 ──
    mkdirSync(OUT_DIR, { recursive: true });
    console.log(`\n[3] 下载到 ${OUT_DIR}`);
    for (let i = 0; i < result.images.length; i++) {
      const img = result.images[i];
      const out = resolve(OUT_DIR, `refgen-${i + 1}.png`);
      const res = await fetch(img.url);
      if (!res.ok) {
        console.log(`    ✗ 第 ${i + 1} 张 HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(out, buf);
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      console.log(`    ✓ ${out}  ${w}×${h}  ${(buf.length / 1024).toFixed(0)} KB`);
    }

    console.log(`\n[4] 下一步`);
    console.log(`    打开得到的 PNG，逐项核对商品保真：`);
    console.log(`      □ 木纹走向是否与参考图一致（横波纹理，不是随机木纹）`);
    console.log(`      □ 雕刻「KLASSIKER / 40 / Zustand entspricht…」是否存在且字形正确`);
    console.log(`      □ 三个汽车图标是否还在、顺序是否正确`);
    console.log(`      □ 弧边（左右内凹）轮廓是否保持`);
    console.log(`      □ 黑色螺旋支脚支架是否正确`);
    console.log();
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('\n✗ 失败:', e);
  process.exit(1);
});
