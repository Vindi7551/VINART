/**
 * 演示：DOM 顺序到底怎么来的
 *
 * 用一份三层的最小 spec，渲染出来：
 *   ① 打印生成的 HTML 片段 —— 看三个容器的**出现顺序**是否就是数组顺序
 *   ② 顺带渲染成 PNG —— 看叠放结果是否符合"数组后面的在上"
 *
 * 三个方块刻意大幅重叠，颜色按数组顺序 红→绿→蓝。
 * 如果规则成立：交界处应该是**蓝**压绿、绿压红。
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('test_product/dom-order-probe');

/**
 * 三条，数组顺序：红 → 绿 → 蓝。
 * 用**实心色块**画三条错位重叠的横条——叠放关系一眼可辨。
 */
const spec = {
  name: 'dom-order',
  title: 'DOM 顺序演示',
  canvas: { width: 900, height: 260 },
  layers: [
    { id: 'layer-red', type: 'shape' as const, shape: 'rect' as const,
      rect: { x: 0.06, y: 0.25, w: 0.40, h: 0.50 }, fill: '#C8323C' },
    { id: 'layer-green', type: 'shape' as const, shape: 'rect' as const,
      rect: { x: 0.22, y: 0.25, w: 0.40, h: 0.50 }, fill: '#32B450' },
    { id: 'layer-blue', type: 'shape' as const, shape: 'rect' as const,
      rect: { x: 0.38, y: 0.25, w: 0.40, h: 0.50 }, fill: '#3C6EE6' },
  ],
};

async function main() {
  console.log('\n' + '═'.repeat(72));
  console.log('DOM 顺序是怎么确定的');
  console.log('═'.repeat(72));

  const { renderDesign } = await import('../src/render/declarative/render');

  console.log('\n[1] 输入：spec.layers 数组\n');
  spec.layers.forEach((l, i) => console.log(`     layers[${i}] = ${l.id}`));

  const { html } = renderDesign(spec);

  console.log('\n[2] 输出：生成的 HTML 里三个容器的出现顺序\n');
  const body = html.slice(html.indexOf('<div class="canvas">'));
  for (const line of body.split('\n')) {
    if (line.includes('data-layer=')) {
      const id = /data-layer="([^"]+)"/.exec(line)?.[1];
      const idx = line.indexOf('data-layer=');
      console.log(`     ${line.slice(0, idx).trim().padEnd(12)} ${id}`);
    }
  }

  console.log('\n[3] 对照\n');
  console.log('     数组顺序 : ' + spec.layers.map((l) => l.id).join(' → '));
  const inHtml = [...html.matchAll(/data-layer="([^"]+)"/g)].map((m) => m[1]);
  console.log('     DOM 顺序 : ' + inHtml.join(' → '));
  console.log(
    '     判定     : ' +
      (JSON.stringify(spec.layers.map((l) => l.id)) === JSON.stringify(inHtml)
        ? '✓ 完全一致 —— DOM 顺序就是数组顺序'
        : '✗ 不一致！'),
  );

  // 渲染出来看叠放结果
  mkdirSync(OUT, { recursive: true });
  // ⚠️ 不能切开 HTML 只取 body —— 那样会把 <head> 里的 CSS 全丢掉，
  // 图层就退化成普通文档流里的块，垂直堆叠（实测踩过：900×260 的画布渲出 780 高）。
  // 正确做法是在原 HTML 上就地注入附加样式。
  const full = html.replace(
    '</head>',
    '<style>.dl{outline:2px solid rgba(255,255,255,.28)}</style></head>',
  );

  const { createBlinkRenderer } = await import('../src/render/rasterize/blink-renderer');
  const r = createBlinkRenderer();
  try {
    const out = await r.render({ html: full }, OUT, {
      width: 900, height: 260, deviceScaleFactor: 1, format: 'png', filename: 'dom-order',
    });
    const buf = readFileSync(out.imagePath);
    console.log(`\n[4] 渲染结果 → ${out.imagePath}`);
    console.log(`     ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ${(buf.length / 1024).toFixed(0)} KB`);
    console.log('\n     三条彩条错位重叠，从左到右依次露出 —— 露出的顺序就是叠放顺序。');
  } finally {
    await r.dispose();
  }
  console.log();
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
