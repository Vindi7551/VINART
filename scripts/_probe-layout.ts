/**
 * 探针：seedream 认不认「版式草图」作为构图约束？
 *
 * 这是决定管道架构的实验。
 *   - 认 → 版式图既是给人看的检查稿，又是给模型的构图控制图，架构完整成立
 *   - 不认 → 版式图只是检查稿，构图只能靠提示词描述，控制力弱
 *
 * 做法：
 *   1. 用 HTML+CSS 渲染一张**线框草图**（wireframe）：
 *      分区虚线框 + 分区名 + 商品实物抠图 + 文字占位条。背景留白。
 *   2. 把 [商品参考图 + 线框草图] 一起交给 seedream，提示词明确要求：
 *      按草图布局生成写实画面，并且**线框标记不得出现在成品里**。
 *   3. 看输出是否守住了：商品位置、顶部留白给标题、右下特写区、底部信息条。
 *
 * 运行：npm run step scripts/_probe-layout.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getImageGateway } from '../src/config';

const PRODUCT = resolve('test_product/af39f425-770e-472e-a21e-6964f7864974.png');
const OUT_DIR = resolve('test_product/probe');
const REF_MAX = 768;
const C = 2000;

/** 与 step-05 实测修正后的版本一致 */
const LAYOUT = {
  productWidthRatio: 0.54,
  productCenterY: 0.41,
  circleDiameterRatio: 0.23,
  circleCenterX: 0.8,
  circleCenterY: 0.75,
};

async function main() {
  console.log('\n' + '═'.repeat(66));
  console.log('探针 — seedream 是否守版式草图');
  console.log('═'.repeat(66));

  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
  }

  try {
    const page = await browser.newPage();
    const rawB64 = readFileSync(PRODUCT).toString('base64');

    // ── 一次性算出：边界框、带 alpha 的商品抠图、压缩过的参考图 ──
    const probe = await page.evaluate(
      async (a: { b64: string; max: number }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${a.b64}`;
        await img.decode();

        const full = document.createElement('canvas');
        full.width = img.naturalWidth;
        full.height = img.naturalHeight;
        const fctx = full.getContext('2d')!;
        fctx.drawImage(img, 0, 0);
        const W = full.width;
        const H = full.height;
        const px = fctx.getImageData(0, 0, W, H).data;

        const TH = 225;
        let minX = W, minY = H, maxX = -1, maxY = -1;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            if (px[i] < TH || px[i + 1] < TH || px[i + 2] < TH) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;

        // 带 alpha 的抠图
        const cut = document.createElement('canvas');
        cut.width = bw;
        cut.height = bh;
        const cctx = cut.getContext('2d')!;
        cctx.drawImage(img, minX, minY, bw, bh, 0, 0, bw, bh);
        const id = cctx.getImageData(0, 0, bw, bh);
        const d = id.data;
        const OPAQUE_AT = 225;
        const CLEAR_AT = 248;
        for (let i = 0; i < d.length; i += 4) {
          const mn = Math.min(d[i], d[i + 1], d[i + 2]);
          d[i + 3] =
            mn <= OPAQUE_AT ? 255
            : mn >= CLEAR_AT ? 0
            : Math.round(255 * (1 - (mn - OPAQUE_AT) / (CLEAR_AT - OPAQUE_AT)));
        }
        cctx.putImageData(id, 0, 0);

        // 压缩参考图（白底 flatten，避免透明区被误读）
        const s = Math.min(1, a.max / Math.max(W, H));
        const rw = Math.round(W * s);
        const rh = Math.round(H * s);
        const rc = document.createElement('canvas');
        rc.width = rw;
        rc.height = rh;
        const rctx = rc.getContext('2d')!;
        rctx.fillStyle = '#fff';
        rctx.fillRect(0, 0, rw, rh);
        rctx.drawImage(img, 0, 0, rw, rh);

        return {
          bbox: { bw, bh },
          cutDataUrl: cut.toDataURL('image/png'),
          refDataUrl: rc.toDataURL('image/jpeg', 0.9),
        };
      },
      { b64: rawB64, max: REF_MAX },
    );
    await page.close();

    console.log(`\n[1] 商品主体 ${probe.bbox.bw}×${probe.bbox.bh}`);

    // ── 组装线框草图 HTML ──
    const productW = C * LAYOUT.productWidthRatio;
    const productH = (productW * probe.bbox.bh) / probe.bbox.bw;
    const productLeft = C * 0.5 - productW / 2;
    const productTop = C * LAYOUT.productCenterY - productH / 2;

    const circleD = C * LAYOUT.circleDiameterRatio;
    const circleLeft = C * LAYOUT.circleCenterX - circleD / 2;
    const circleTop = C * LAYOUT.circleCenterY - circleD / 2;

    const font = `"Helvetica Neue", Helvetica, Arial, sans-serif`;

    const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${C}px; height:${C}px; overflow:hidden; }
  body { font-family:${font}; }
  .canvas { position:relative; width:${C}px; height:${C}px; background:#F2F2F2; overflow:hidden; }

  /* 分区虚线框 —— 这些标记只是给模型看的，不许出现在成品里 */
  .zone { position:absolute; border:3px dashed #9AA0A6; }
  .zone-label {
    position:absolute; font-size:30px; font-weight:700; color:#5F6368;
    letter-spacing:.06em; background:rgba(255,255,255,.85); padding:6px 14px;
  }

  /* 文字占位条（灰条，不带任何真实文案，避免模型把文案画进成品） */
  .bar { position:absolute; background:#C8CCD0; border-radius:6px; }

  .product { position:absolute; left:${productLeft}px; top:${productTop}px;
             width:${productW}px; height:${productH}px; }
  .product img { width:100%; height:100%; display:block; }

  .circle { position:absolute; left:${circleLeft}px; top:${circleTop}px;
            width:${circleD}px; height:${circleD}px; border-radius:50%;
            border:3px dashed #9AA0A6; }
</style></head>
<body>
<div class="canvas">

  <!-- 顶部标题区：0–20% -->
  <div class="zone" style="left:${C * 0.08}px; top:${C * 0.03}px; width:${C * 0.84}px; height:${C * 0.17}px;"></div>
  <div class="zone-label" style="left:${C * 0.1}px; top:${C * 0.045}px;">TITEL + UNTERTITEL</div>
  <div class="bar" style="left:${C * 0.24}px; top:${C * 0.085}px; width:${C * 0.52}px; height:${C * 0.042}px;"></div>
  <div class="bar" style="left:${C * 0.19}px; top:${C * 0.142}px; width:${C * 0.62}px; height:${C * 0.026}px;"></div>

  <!-- 主场景区：18–84% -->
  <div class="zone" style="left:${C * 0.02}px; top:${C * 0.21}px; width:${C * 0.96}px; height:${C * 0.63}px;"></div>
  <div class="zone-label" style="left:${C * 0.04}px; top:${C * 0.225}px;">HAUPTBILD — Szene wird generiert, Produkt steht hier</div>

  <!-- 商品实物抠图，摆在线框里 -->
  <div class="product"><img src="${probe.cutDataUrl}" alt=""></div>

  <!-- 右下特写圈 -->
  <div class="circle"></div>
  <div class="zone-label" style="left:${circleLeft}px; top:${circleTop - 44}px;">DETAIL</div>

  <!-- 底部信息条：88–100% -->
  <div class="zone" style="left:0; top:${C * 0.88}px; width:${C}px; height:${C * 0.12}px;"></div>
  <div class="zone-label" style="left:${C * 0.04}px; top:${C * 0.895}px;">FUSSZEILE</div>
  <div class="bar" style="left:${C * 0.2}px; top:${C * 0.928}px; width:${C * 0.6}px; height:${C * 0.024}px;"></div>

</div>
</body></html>`;

    // ── 渲染草图 ──
    mkdirSync(OUT_DIR, { recursive: true });
    const { createBlinkRenderer } = await import('../src/render/blink-renderer');
    const renderer = createBlinkRenderer();
    let sketchPath: string;
    try {
      const out = await renderer.render({ html }, OUT_DIR, {
        width: C, height: C, deviceScaleFactor: 1, format: 'png', filename: 'layout-sketch',
      });
      sketchPath = out.imagePath;
      console.log(`[2] 版式草图 : ${sketchPath}`);
    } finally {
      await renderer.dispose();
    }

    // 草图也要转成 jpeg data URL（参考图体积要小）
    const sketchPage = await browser.newPage();
    const sketchB64 = readFileSync(sketchPath).toString('base64');
    const sketchDataUrl = await sketchPage.evaluate(async (b64: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 1024;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 1024, 1024);
      ctx.drawImage(img, 0, 0, 1024, 1024);
      return c.toDataURL('image/jpeg', 0.92);
    }, sketchB64);
    await sketchPage.close();

    console.log(`[3] 草图已压缩为参考图（${(sketchDataUrl.length / 1024).toFixed(0)} KB）`);

    // ── 生图：商品参考图 + 版式草图 ──
    const prompt = [
      'Erzeuge eine fotorealistische Produktaufnahme nach dem beigefügten Layout-Entwurf.',
      'Das Layout zeigt die Anordnung: oben freier Bereich für Titel, in der Mitte das Produkt,',
      'rechts unten ein runder Bereich für ein Detail, unten ein Streifen für eine Fußzeile.',
      '',
      'Referenzbild 1 = das Produkt. Referenzbild 2 = der Layout-Entwurf.',
      'Das Produkt auf dem schwarzen Metallständer muss exakt wie in Referenzbild 1 aussehen',
      '(dunkles Holz, wellige Maserung, Gravur «KLASSIKER 40»).',
      '',
      'Szene: festlich gedeckte Geburtstagstafel im warmen Abendlicht, Torte mit Kerzen,',
      'Teller, Gläser, Blumen, unscharfe Luftballons im Hintergrund, geringe Schärfentiefe.',
      'Das Produkt steht aufrecht in der Tischmitte und ist der Blickfang.',
      '',
      'WICHTIG: Die gestrichelten Rahmen, grauen Balken und Beschriftungen des Entwurfs sind',
      'NUR Platzhalter. Sie dürfen im fertigen Bild NICHT erscheinen.',
      'Der obere Bereich bleibt frei von Motiven. Der untere Streifen bleibt ruhig.',
      'Keine Personen, keine lesbaren Fremdtexte, keine Logos, kein Wasserzeichen.',
    ].join(' ');

    console.log(`\n[4] 提交：商品参考图 + 版式草图 + 提示词`);
    console.log(`    提示词 ${prompt.length} 字符`);

    const gateway = getImageGateway();
    const t0 = Date.now();
    const r = await gateway.generate({
      prompt,
      referenceImages: [probe.refDataUrl, sketchDataUrl],
      size: '2048x2048',
      count: 1,
      format: 'png',
    });
    console.log(`    ✓ ${Date.now() - t0}ms　${r.images.length} 张`);

    for (let i = 0; i < r.images.length; i++) {
      const res = await fetch(r.images[i].url);
      if (!res.ok) {
        console.log(`    ✗ 下载 HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const out = resolve(OUT_DIR, `layout-result-${i + 1}.png`);
      writeFileSync(out, buf);
      console.log(`    → ${out}  ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ${(buf.length / 1024).toFixed(0)} KB`);
    }

    console.log('\n' + '═'.repeat(66));
    console.log('核对：商品是否在中偏上？顶部是否留白？右下是否有细节区？底部是否平？');
    console.log('      线框标记是否被清除？');
    console.log('═'.repeat(66) + '\n');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('\n✗ 失败:', e);
  process.exit(1);
});
