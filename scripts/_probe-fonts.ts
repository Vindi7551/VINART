/**
 * 字体对比表 —— 把候选板衬线体并排渲染出来，用于选型。
 *
 * 为什么必须看图：板衬线的差别（衬线形状、对比度、x-height、字重上限）是**视觉问题**，
 * 文字描述传达不了。而且我们是在图片上排版，必须看它在大字号下的实际观感。
 *
 * 对比项：
 *   - 商品主标题（德语，含变音符号）：Akazienholz mit Charakter
 *   - 通栏横幅（全大写）：SCHNEIDEN UND SERVIEREN
 *   - 字重阶梯：看该家族到底有几档可用
 *   基线：**Bookman Old Style**（我们目前实际在用的，因为 Rockwell 不存在）
 *
 * 字体文件来自 `.tmp-run/fonts/`（`scripts/_fetch-fonts.py` 下载的 latin 子集）。
 *
 * 运行：npm run step scripts/_probe-fonts.ts
 */

import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const FONT_DIR = resolve('.tmp-run/fonts');
const OUT = resolve('test_product/font-probe');

/** 家族 → { 显示名, 可用字重, 备注 } */
const FAMILIES: { name: string; fileBase: string; weights: number[]; note: string }[] = [
  { name: '__baseline__Bookman Old Style', fileBase: '', weights: [], note: '基线：当前实际在用（系统字体，非自带）' },
  { name: 'Bitter', fileBase: 'Bitter', weights: [400, 700, 900], note: '9 档字重 · OFL · 编辑感，新闻媒体气质' },
  { name: 'Roboto Slab', fileBase: 'RobotoSlab', weights: [400, 700, 900], note: '9 档字重 · Apache 2.0 · Material Design 关联强' },
  { name: 'Zilla Slab', fileBase: 'ZillaSlab', weights: [400, 600, 700], note: '5 档字重 · OFL · Mozilla 品牌 · 尖角衬线' },
  { name: 'Noto Serif', fileBase: 'NotoSerif', weights: [400, 700, 900], note: '⚠️ 不是板衬线（过渡衬线），列出作对照' },
  { name: 'Arvo', fileBase: 'Arvo', weights: [400, 700], note: '仅 2 档 · OFL · 几何板衬线，来源称"最接近 Rockwell"' },
  { name: 'Rokkitt', fileBase: 'Rokkitt', weights: [400, 700, 900], note: '9 档字重 · OFL · 几何板衬线，品牌包袱最轻' },
  { name: 'Alfa Slab One', fileBase: 'AlfaSlabOne', weights: [400], note: '仅 1 档但极重 · OFL · 海报式展示用' },
];

const HEADLINE = 'Akazienholz mit Charakter';
const CAPS = 'SCHNEIDEN UND SERVIEREN';
const LADDER = 'Akazienholz 40 Größe';
const UMLAUT = 'Ärger Öl Übermaß · 30,5 × 22 × 1,5 cm';

function fontFaceDecls(): { css: string } {
  const parts: string[] = [];
  for (const f of FAMILIES) {
    if (!f.fileBase) continue;
    for (const w of f.weights) {
      const p = resolve(FONT_DIR, `${f.fileBase}-${w}.woff2`);
      if (!existsSync(p)) continue;
      const b64 = readFileSync(p).toString('base64');
      parts.push(`@font-face{font-family:'${f.name}';font-style:normal;font-weight:${w};
        src:url(data:font/woff2;base64,${b64}) format('woff2');}`);
    }
  }
  return { css: parts.join('\n') };
}

async function main() {
  console.log('\n字体对比表');

  if (!existsSync(FONT_DIR)) {
    console.error(`\n✗ 找不到字体目录：${FONT_DIR}`);
    console.error('  先跑：python scripts/_fetch-fonts.py');
    process.exit(1);
  }
  const have = readdirSync(FONT_DIR).filter((f) => f.endsWith('.woff2'));
  console.log(`  字体文件 ${have.length} 个`);

  const { css: faceCss } = fontFaceDecls();

  const blocks = FAMILIES.map((f) => {
    const stack = f.fileBase
      ? `'${f.name}', serif`
      : `'Bookman Old Style', 'Bookman', Georgia, serif`;

    const ladder = f.weights.length
      ? f.weights
          .map(
            (w) =>
              `<div class="lad" style="font-family:${stack};font-weight:${w}">
                 <span class="wnum">${w}</span>${LADDER}</div>`,
          )
          .join('')
      : `<div class="lad" style="font-family:${stack};font-weight:400">
           <span class="wnum">400</span>${LADDER}</div>
         <div class="lad" style="font-family:${stack};font-weight:700">
           <span class="wnum">700</span>${LADDER}</div>`;

    const heavy = f.weights.length ? Math.max(...f.weights) : 700;

    return `<section>
      <div class="fname">${f.name.replace('__baseline__', '')}　<span class="note">${f.note}</span></div>
      <div class="head" style="font-family:${stack};font-weight:${heavy}">${HEADLINE}</div>
      <div class="caps" style="font-family:${stack};font-weight:${heavy}">${CAPS}</div>
      <div class="uml"  style="font-family:${stack};font-weight:${Math.min(heavy, 700)}">${UMLAUT}</div>
      ${ladder}
    </section>`;
  }).join('\n');

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><style>
  ${faceCss}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#17120C;color:#F2E8DA;font-family:Arial,sans-serif;
       width:1800px;padding:48px 56px}
  section{border-bottom:1px solid #3A2E22;padding-bottom:34px;margin-bottom:34px}
  section:last-child{border-bottom:none}
  .fname{font-size:30px;font-weight:700;color:#E8A24A;margin-bottom:16px}
  .note{font-size:20px;font-weight:400;color:#9A8674}
  .head{font-size:96px;line-height:1.08;color:#F7F0E6;letter-spacing:-.01em;white-space:nowrap}
  .caps{font-size:72px;line-height:1.1;color:#D9A05B;margin-top:12px;white-space:nowrap}
  .uml{font-size:44px;line-height:1.2;color:#C9BCA9;margin-top:10px}
  .lad{font-size:40px;line-height:1.35;color:#B7A894;margin-top:6px;white-space:nowrap}
  .wnum{display:inline-block;width:76px;font-family:Arial,sans-serif;font-size:22px;
        font-weight:700;color:#6E5A46;vertical-align:middle}
</style></head><body>
${blocks}
</body></html>`;

  mkdirSync(OUT, { recursive: true });
  const { createBlinkRenderer } = await import('../src/render/blink-renderer');
  const r = createBlinkRenderer();
  try {
    const out = await r.render({ html }, OUT, {
      width: 1800, height: 4520, deviceScaleFactor: 1, format: "png", filename: "font-compare",
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
