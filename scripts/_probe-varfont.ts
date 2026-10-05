/**
 * 可变字体权重探针 —— 回答一个具体问题：
 *
 * 「把同一份可变字体文件（含 wght 轴）复制成 400/700/900 三份，
 *   再用 @font-face{font-weight:N} 分别声明，Chromium 渲出来的到底一不一样？」
 *
 * 三种用法并排：
 *   A. 单条 @font-face{font-weight:100 900} + font-variation-settings:'wght' N
 *   B. 单条 @font-face{font-weight:100 900} + font-weight: N
 *   C. 三条 @font-face{font-weight:N}（现状做法）各自吃同一份文件
 *
 * 运行：npm run step scripts/_probe-varfont.ts [字体文件路径]
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(process.argv[2] ?? 'designassets/fonts/families/Bitter/400.woff2');
const OUT = resolve('test_product/font-probe');

const WORDS = 'Az 8 Schärfe Größe';
const WEIGHTS = [100, 400, 700, 900];

async function main() {
  if (!existsSync(SRC)) throw new Error(`找不到字体：${SRC}`);
  const b64 = readFileSync(SRC).toString('base64');
  const url = `url(data:font/woff2;base64,${b64}) format('woff2')`;

  // C：现状做法——同一份文件挂三个不同 font-weight 描述符
  const facesC = WEIGHTS.map(
    (w) => `@font-face{font-family:'VF-as-C';font-weight:${w};src:${url}}`,
  ).join('\n');

  const rows: string[] = [];

  // A：range 描述符 + font-variation-settings 直接拧轴
  rows.push(`<div class="lbl">A · @font-face(100 900) + font-variation-settings:'wght' N</div>`);
  for (const w of WEIGHTS) {
    rows.push(
      `<div class="row" style="font-family:'VF-as-A';font-variation-settings:'wght' ${w}">
         <span class="tag">wght ${w}</span>${WORDS}</div>`,
    );
  }

  // B：range 描述符 + 普通 font-weight
  rows.push(`<div class="lbl">B · @font-face(100 900) + font-weight:N</div>`);
  for (const w of WEIGHTS) {
    rows.push(
      `<div class="row" style="font-family:'VF-as-B';font-weight:${w}">
         <span class="tag">fw ${w}</span>${WORDS}</div>`,
    );
  }

  // C：现状——三个独立描述符各自指向同一文件
  rows.push(`<div class="lbl">C · 三条 @font-face{font-weight:N} 吃同一份文件（现状）</div>`);
  for (const w of WEIGHTS) {
    rows.push(
      `<div class="row" style="font-family:'VF-as-C';font-weight:${w}">
         <span class="tag">fw ${w}</span>${WORDS}</div>`,
    );
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:'VF-as-A';font-weight:100 900;src:${url}}
  @font-face{font-family:'VF-as-B';font-weight:100 900;src:${url}}
  ${facesC}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#fff;color:#111;width:1400px;padding:32px 40px;
       font-family:Arial,sans-serif}
  .lbl{font-size:18px;font-weight:700;color:#B03A2E;margin:22px 0 8px;
       border-top:2px solid #ddd;padding-top:14px}
  .lbl:first-child{border-top:none;margin-top:0;padding-top:0}
  .row{font-size:76px;line-height:1.16;white-space:nowrap;color:#111}
  .tag{display:inline-block;width:170px;font-family:Arial,sans-serif;
       font-size:18px;font-weight:700;color:#888;vertical-align:middle}
</style></head><body>
${rows.join('\n')}
</body></html>`;

  mkdirSync(OUT, { recursive: true });
  const { createBlinkRenderer } = await import('../src/render/blink-renderer');
  const r = createBlinkRenderer();
  try {
    const out = await r.render({ html }, OUT, {
      width: 1400,
      height: 1560,
      deviceScaleFactor: 1.5,
      format: 'png',
      filename: 'varfont-probe',
    });
    const buf = readFileSync(out.imagePath);
    console.log(`\n  ✓ ${out.imagePath}`);
    console.log(`    ${(buf.length / 1024).toFixed(0)} KB\n`);
  } finally {
    await r.dispose();
  }
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
