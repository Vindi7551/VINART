/**
 * 验证：去掉 z-index 靠 DOM 顺序叠放，到底会不会错乱？
 *
 * 要验三件事：
 *   A. 同一父容器内、position:absolute、**都不带 z-index** 的兄弟 →
 *      绘制顺序是否严格按 DOM 顺序（后者在上）？
 *   B. 如果**其中一个**带了 z-index → 会不会插队到其它之上？（这是我担心的风险）
 *   C. 父容器加 `isolation:isolate` 后，**内部**的 z-index 是否被关进笼子、
 *      不再影响兄弟之间的比较？
 *
 * 测试图案：三个方块故意大范围重叠，颜色按 DOM 顺序为 红→绿→蓝。
 * 谁在最上面，中间重叠区就是谁的颜色。
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('test_product/zindex-probe');

const BOX = (color: string, left: number, extra = '', inner = '') => `
  <div class="box" style="left:${left}px;background:${color};${extra}">${inner}</div>`;

const PANEL = (title: string, note: string, body: string) => `
  <section>
    <h2>${title}</h2>
    <p>${note}</p>
    <div class="stage">${body}</div>
  </section>`;

async function main() {
  console.log('\n层叠顺序验证');
  mkdirSync(OUT, { recursive: true });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#1A1510;color:#F2E8DA;font-family:Arial,sans-serif;padding:36px;width:1600px}
    section{margin-bottom:40px}
    h2{font-size:30px;color:#E8A24A;margin-bottom:8px}
    p{font-size:20px;color:#B7A894;margin-bottom:16px}
    .stage{position:relative;width:900px;height:200px;background:#2A2018;border:1px solid #4A3A2A}
    /* 子方块：全部绝对定位，尺寸一样，故意大幅重叠 */
    .box{position:absolute;top:20px;width:340px;height:160px;border-radius:8px;
         display:flex;align-items:center;justify-content:center;
         font-size:34px;font-weight:700;color:rgba(255,255,255,.92)}
  </style></head><body>

  ${PANEL(
    'A · 都不带 z-index',
    '三个方块全部 position:absolute、z-index:auto。中间重叠区露出的应该是**蓝**（DOM 最后 = 画在最上）。',
    BOX('rgba(200,50,50,.82)', 40, '', '红<br>DOM 1') +
      BOX('rgba(50,180,80,.82)', 220, '', '绿<br>DOM 2') +
      BOX('rgba(60,110,230,.82)', 400, '', '蓝<br>DOM 3'),
  )}

  ${PANEL(
    'B · 第一个带 z-index:1（验证你担心的情况）',
    '红虽然 DOM 排第一，但带了 z-index:1，而另外两个是 auto → 红**插队到最上面**。',
    BOX('rgba(200,50,50,.92)', 40, 'z-index:1;', '红<br>DOM 1, z:1') +
      BOX('rgba(50,180,80,.82)', 220, '', '绿<br>DOM 2') +
      BOX('rgba(60,110,230,.82)', 400, '', '蓝<br>DOM 3'),
  )}

  ${PANEL(
    'C · 父容器 isolation:isolate，内部元素带 z-index:9',
    '绿被包进一个 isolation:isolate 的父容器里，里面有个 z-index:9 的黄色小块。' +
      '黄色应该**只压住绿、压不住蓝**——说明内部 z-index 被关进了笼子。',
    BOX('rgba(200,50,50,.82)', 40, '', '红<br>DOM 1') +
      `<div class="box" style="left:220px;background:rgba(50,180,80,.82);isolation:isolate">
         绿<br>DOM 2
         <div style="position:absolute;left:180px;top:60px;width:150px;height:90px;
              background:rgba(240,200,40,.95);border-radius:6px;z-index:9;
              display:flex;align-items:center;justify-content:center;font-size:22px">z:9</div>
       </div>` +
      BOX('rgba(60,110,230,.82)', 400, '', '蓝<br>DOM 3'),
  )}

  ${PANEL(
    'D · 对照：不加 isolation，内部 z-index:9',
    '同样的结构，但父容器**没有** isolation。黄色 z-index:9 这时会跟兄弟比较 → **压过蓝**。',
    BOX('rgba(200,50,50,.82)', 40, '', '红<br>DOM 1') +
      `<div class="box" style="left:220px;background:rgba(50,180,80,.82)">
         绿<br>DOM 2
         <div style="position:absolute;left:180px;top:60px;width:150px;height:90px;
              background:rgba(240,200,40,.95);border-radius:6px;z-index:9;
              display:flex;align-items:center;justify-content:center;font-size:22px">z:9</div>
       </div>` +
      BOX('rgba(60,110,230,.82)', 400, '', '蓝<br>DOM 3'),
  )}

  </body></html>`;

  const { createBlinkRenderer } = await import('../src/render/blink-renderer');
  const r = createBlinkRenderer();
  try {
    const out = await r.render({ html }, OUT, {
      width: 1600, height: 1420, deviceScaleFactor: 1, format: "png", filename: "zindex",
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
