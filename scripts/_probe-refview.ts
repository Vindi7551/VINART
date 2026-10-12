/**
 * 参考图放大查看器 —— 把低分辨率参考图切块放大，渲染成对照页，便于读版式与文案。
 *
 * 起因：用户给的参考图只有 230×230，直接看读不出精确的分区比例与文字。
 * 做法：整图 + 四个象限各自放大到 700px，拼成一张对照页。
 * 放大不会增加信息量，但能让读图的人（和我）看清分区边界、横幅形状与文字。
 *
 * 运行：npm run step scripts/_probe-refview.ts -- "D:/desktop/图片1.png" "D:/desktop/图片2.png"
 * 产出：test_product/refview/<文件名>-zoom.png
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

const OUT = resolve('test_product/refview');
const ZOOM = 1000;

const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!paths.length) {
  console.error('用法: npm run step scripts/_probe-refview.ts -- <图片路径> [...]');
  process.exit(1);
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

function dataUrl(p: string): string {
  const ext = extname(p).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`不支持的格式：${ext}`);
  return `data:${mime};base64,${readFileSync(p).toString('base64')}`;
}

/** 四个象限 + 整图 */
const REGIONS = [
  { name: '整图', x: 0, y: 0, w: 1, h: 1 },
  { name: '左上', x: 0, y: 0, w: 0.55, h: 0.55 },
  { name: '右上', x: 0.45, y: 0, w: 0.55, h: 0.55 },
  { name: '左下', x: 0, y: 0.45, w: 0.55, h: 0.55 },
  { name: '右下', x: 0.45, y: 0.45, w: 0.55, h: 0.55 },
  { name: '上带', x: 0, y: 0, w: 1, h: 0.32 },
  { name: '下带', x: 0, y: 0.68, w: 1, h: 0.32 },
];

function page(src: string, label: string): string {
  const cells = REGIONS.map((r) => {
    const offX = -r.x * ZOOM;
    const offY = -r.y * ZOOM;
    const size = Math.round(ZOOM / r.w);
    return `<div class="cell">
      <div class="frame" style="width:${ZOOM}px;height:${ZOOM}px">
        <img src="${src}" style="width:${size}px;height:${size}px;left:${offX}px;top:${offY}px">
      </div>
      <div class="cap">${r.name}</div>
    </div>`;
  }).join('');
  return `<section><h2>${label}</h2><div class="row">${cells}</div></section>`;
}

async function main() {
  console.log('\n参考图放大对照');
  mkdirSync(OUT, { recursive: true });
  const { createBlinkRenderer } = await import('../src/render/rasterize/blink-renderer');

  const sections = paths
    .map((p) => page(dataUrl(p), basename(p)))
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#1A1A1A;font-family:Arial,sans-serif;padding:30px;width:2260px}
    h2{color:#E8B04B;font-size:30px;margin:14px 0 20px;letter-spacing:.06em}
    section{margin-bottom:50px}
    .row{display:flex;flex-wrap:wrap;gap:14px}
    .cell{text-align:center}
    .frame{position:relative;overflow:hidden;border:2px solid #444;background:#000}
    .frame img{position:absolute;image-rendering:auto}
    .cap{color:#BBB;font-size:20px;margin-top:8px}
  </style></head><body>${sections}</body></html>`;

  const r = createBlinkRenderer();
  try {
    // 所有的参考图放进同一张对照页，方便横向比对
    const out = await r.render({ html }, OUT, {
      width: 2260, height: 4800, deviceScaleFactor: 1, format: 'png',
      filename: 'refs-zoom',
    });
    const buf = readFileSync(out.imagePath);
    console.log(`→ ${out.imagePath}`);
    console.log(`   ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ${(buf.length / 1024).toFixed(0)} KB`);
  } finally {
    await r.dispose();
  }
  console.log();
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
