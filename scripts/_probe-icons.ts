/**
 * 图标迭代工具 —— 把徽章图标放大渲染成对比图，零成本试形状。
 *
 * 起因：刀形图标盲改两次都不成功（一次像刷子，一次像叶子）。
 * 在 94px 的徽章里猜形状是没效率的——放大到 240px 直接看，改到对为止，
 * 完全不消耗生图调用。
 *
 * 运行：npm run step scripts/_probe-icons.ts
 * 产出：test_product/g03/icons.png
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('test_product/g03');
const COPPER = '#D9A05B';

// ── 刀形变体 ──

/** A：当前用的（旋转 -135°） */
const knifeA = `<svg viewBox="0 0 64 64" width="100%" height="100%">
  <g transform="rotate(-135 32 32)" fill="${COPPER}">
    <rect x="10" y="27" width="14" height="12" rx="6"/>
    <rect x="23" y="26" width="3" height="14" rx="1"/>
    <path d="M26 25 L42 25 Q52 26 54 32 Q42 39 26 39 Z"/>
  </g>
</svg>`;

/** B：不旋转，水平摆放——小尺寸下最容易被认出 */
const knifeB = `<svg viewBox="0 0 64 64" width="100%" height="100%">
  <g fill="${COPPER}">
    <rect x="8" y="27" width="15" height="11" rx="3"/>
    <rect x="23" y="26" width="3" height="13" rx="1"/>
    <path d="M26 25 L46 25 Q58 27 60 33 Q46 40 26 40 Z"/>
  </g>
  <rect x="11" y="30" width="9" height="5" rx="2" fill="#150D06"/>
</svg>`;

/** C：旋转 -45°，刀尖朝右上 */
const knifeC = `<svg viewBox="0 0 64 64" width="100%" height="100%">
  <g transform="rotate(-45 32 32)" fill="${COPPER}">
    <rect x="10" y="27" width="14" height="11" rx="3"/>
    <rect x="24" y="26" width="3" height="13" rx="1"/>
    <path d="M27 25 L45 25 Q56 27 58 33 Q45 40 27 40 Z"/>
  </g>
</svg>`;

/** D：更粗壮——刀身加高到 18，握柄与刀身之间留暗缝 */
const knifeD = `<svg viewBox="0 0 64 64" width="100%" height="100%">
  <g transform="rotate(-135 32 32)">
    <rect x="6" y="25" width="17" height="15" rx="4" fill="${COPPER}"/>
    <rect x="9" y="29" width="11" height="7" rx="2" fill="#150D06"/>
    <rect x="23" y="24" width="3" height="17" rx="1" fill="${COPPER}"/>
    <path d="M26 22 L44 22 Q56 24 59 32 Q44 43 26 43 Z" fill="${COPPER}"/>
  </g>
</svg>`;

/** E：极简——只有刀身轮廓 + 短握柄，负空间区分 */
const knifeE = `<svg viewBox="0 0 64 64" width="100%" height="100%">
  <g transform="rotate(-135 32 32)">
    <path d="M4 26 L14 26 L14 38 L4 38 Z" fill="${COPPER}"/>
    <path d="M17 23 L44 23 Q57 26 60 32 Q44 41 17 41 Z" fill="${COPPER}"/>
  </g>
</svg>`;

// ── 木纹变体 ──

const grainA = `<svg viewBox="0 0 64 64" width="100%" height="100%">
  <defs><clipPath id="gA"><circle cx="32" cy="32" r="28"/></clipPath></defs>
  <g clip-path="url(#gA)" fill="none" stroke="${COPPER}" stroke-width="3.5" stroke-linecap="round">
    <path d="M-4 13 C10 3 24 23 38 13 C52 3 62 19 70 11"/>
    <path d="M-4 25 C10 15 24 35 38 25 C52 15 62 31 70 23"/>
    <path d="M-4 37 C10 27 24 47 38 37 C52 27 62 43 70 35"/>
    <path d="M-4 49 C10 39 24 59 38 49 C52 39 62 55 70 47"/>
  </g>
</svg>`;

const grainB = `<svg viewBox="0 0 64 64" width="100%" height="100%">
  <defs><clipPath id="gB"><circle cx="32" cy="32" r="28"/></clipPath></defs>
  <g clip-path="url(#gB)" fill="none" stroke="${COPPER}" stroke-width="4" stroke-linecap="round">
    <path d="M-4 16 C12 6 26 26 40 16 C54 6 64 22 72 14"/>
    <path d="M-4 32 C12 22 26 42 40 32 C54 22 64 38 72 30"/>
    <path d="M-4 48 C12 38 26 58 40 48 C54 38 64 54 72 46"/>
  </g>
</svg>`;

// ── 页面 ──

function cell(label: string, svg: string): string {
  return `<div class="cell">
    <div class="badge">${svg}</div>
    <div class="cap">${label}</div>
  </div>`;
}

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#15100A;font-family:Arial,sans-serif;padding:40px}
  .row{display:flex;gap:40px;flex-wrap:wrap;margin-bottom:48px}
  .cell{text-align:center;width:280px}
  .badge{width:240px;height:240px;border:8px solid #B8722F;border-radius:50%;
         padding:46px;margin:0 auto 18px}
  .cap{color:#F2E8DA;font-size:22px;font-weight:700}
  h2{color:#B8722F;font-size:26px;margin-bottom:24px;letter-spacing:.08em}
</style></head><body>
  <h2>MESSER — Varianten</h2>
  <div class="row">
    ${cell('A · 旋转 -135°（当前）', knifeA)}
    ${cell('B · 水平不旋转', knifeB)}
    ${cell('C · 旋转 -45°', knifeC)}
    ${cell('D · 加粗 + 暗缝', knifeD)}
    ${cell('E · 极简 + 负空间', knifeE)}
  </div>
  <h2>MASERUNG — Varianten</h2>
  <div class="row">
    ${cell('A · 4 道（当前）', grainA)}
    ${cell('B · 3 道更疏', grainB)}
  </div>
</body></html>`;

async function main() {
  console.log('\n图标迭代渲染');
  mkdirSync(OUT, { recursive: true });
  const { createBlinkRenderer } = await import('../src/render/rasterize/blink-renderer');
  const r = createBlinkRenderer();
  try {
    const out = await r.render({ html }, OUT, {
      width: 1600, height: 1240, deviceScaleFactor: 1, format: 'png', filename: 'icons',
    });
    const { readFileSync } = await import('node:fs');
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
