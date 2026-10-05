/**
 * 探针：网格密度对比。
 *
 * 同一份草图分别用 5 / 10 / 20 / 40 格渲染，肉眼对比「精度 ↔ 干扰」的平衡点。
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderDesign } from '../src/workflow/design-sketch/render';
import { loadPalette, loadTypography } from '../src/workflow/design-sketch/runtime';
import type { DesignSketch } from '../src/workflow/design-sketch/design-sketch';

const OUT = resolve('test_product/layout/_GRID');
mkdirSync(OUT, { recursive: true });

const spec = JSON.parse(
  readFileSync('test_product/layout/PT09/design-sketch.json', 'utf8'),
) as DesignSketch;
const palette = loadPalette('warm-copper');
const typ = loadTypography('slab-rokkitt');
const { createBlinkRenderer } = await import('../src/render/blink-renderer');

const densities: [string, number | false][] = [
  ['00-no-grid', false],
  ['05-格数', 0.2],
  ['10-格数', 0.1],
  ['20-格数', 0.05],
  ['40-格数', 0.025],
];

const r = createBlinkRenderer();
try {
  for (const [label, grid] of densities) {
    const { html } = renderDesign(spec, {
      mode: 'sketch',
      palette,
      typography: { ...typ, faceCss: '' },
      grid,
    });
    const p = resolve(OUT, `${label}.html`);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(p, html, 'utf8');
    const out = await r.render({ html: p, isFilePath: true }, OUT, {
      width: spec.canvas.width,
      height: spec.canvas.height,
      deviceScaleFactor: 1,
      format: 'png',
      filename: label,
    });
    const cols = grid === false ? '—' : Math.round(1 / (grid as number));
    console.log(`  ✓ ${label.padEnd(12)} 每格 ${cols === '—' ? '—' : (100 / (cols as number)).toFixed(1) + '%'}  →  ${out.imagePath}`);
  }
} finally {
  await r.dispose();
}
