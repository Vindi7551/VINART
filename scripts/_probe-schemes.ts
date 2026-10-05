/**
 * 排版方案对照页 —— 同一版式、不同排版方案，取上部横幅区并排比较。
 *
 * 为什么只取上部：排版差异集中在横幅与副文案，全图缩到能并排的尺寸后
 * 字形差异就看不出了。取上部 35% 放大并排，才能判断字形。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LAYOUT_DIR = resolve('test_product/layout/banner-topleft');
const OUT = resolve('test_product/font-probe');

/** 方案名 → 显示说明 */
const VARIANTS: [string, string][] = [
  ['legacy-system', 'Bookman Old Style（系统字体，当前兜底）'],
  ['slab-bitter', 'Bitter 900 — 编辑气质，字重最全'],
  ['slab-rokkitt', 'Rokkitt 900 — 几何板衬线，零品牌包袱'],
  ['slab-arvo', 'Arvo 700 — 最接近 Rockwell，但只有两档'],
  ['slab-roboto', 'Roboto Slab 900 — 可到极重，Material 血统'],
  ['slab-zilla', 'Zilla Slab 700 — 尖角衬线，最高只到 700'],
];

const CELL_W = 1060;
const CROP_H = 720; // 取原图上部 720px（2000 的 36%）
const SRC = 2000;

async function main() {
  console.log('\n排版方案对照页');
  mkdirSync(OUT, { recursive: true });

  const cells = VARIANTS.map(([scheme, note]) => {
    const p = resolve(LAYOUT_DIR, `final-${scheme}.png`);
    if (!existsSync(p)) {
      return `<div class="cell"><div class="miss">缺 ${scheme}</div><div class="cap">${scheme}</div></div>`;
    }
    const b64 = readFileSync(p).toString('base64');
    // 原图 2000 宽显示成 CELL_W 宽 → 缩放比；再按此把上部 CROP_H 裁出来
    const scale = CELL_W / SRC;
    const imgH = Math.round(SRC * scale);
    const cropH = Math.round(CROP_H * scale);
    return `<div class="cell">
      <div class="frame" style="width:${CELL_W}px;height:${cropH}px">
        <img src="data:image/png;base64,${b64}" style="width:${CELL_W}px;height:${imgH}px">
      </div>
      <div class="cap"><b>${scheme}</b><span>${note}</span></div>
    </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#1A1510;padding:36px;width:2260px;font-family:Arial,sans-serif}
    .row{display:flex;flex-wrap:wrap;gap:22px}
    .cell{margin-bottom:10px}
    .frame{position:relative;overflow:hidden;border:1px solid #4A3A2A}
    .frame img{position:absolute;left:0;top:0;display:block}
    .cap{margin-top:10px;color:#E8A24A;font-size:26px;font-weight:700}
    .cap span{display:block;color:#9A8674;font-size:21px;font-weight:400;margin-top:4px}
    .miss{width:1060px;height:381px;background:#2A2018;color:#8A7A66;
          display:flex;align-items:center;justify-content:center;font-size:24px}
    h1{color:#F2E8DA;font-size:34px;margin-bottom:26px}
  </style></head><body>
    <h1>同一版式 × 不同排版方案（取上部横幅区）</h1>
    <div class="row">${cells}</div>
  </body></html>`;

  const { createBlinkRenderer } = await import('../src/render/blink-renderer');
  const r = createBlinkRenderer();
  try {
    const out = await r.render({ html }, OUT, {
      width: 2260, height: 1900, deviceScaleFactor: 1, format: 'png', filename: 'scheme-compare',
    });
    const buf = readFileSync(out.imagePath);
    console.log(`  → ${out.imagePath}`);
    console.log(`    ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ${(buf.length / 1024).toFixed(0)} KB`);
  } finally {
    await r.dispose();
  }
  console.log();
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
