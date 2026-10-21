/**
 * 探针：字体库 manifest / @font-face CSS / 使用字体推断。
 *
 * 跑法：
 *   node --experimental-transform-types --import ./scripts/_ts-resolve.mjs scripts/_probe-fonts.mjs
 */
import { existsSync } from 'node:fs';
import {
  buildFontCss,
  fontFileByDir,
  listFontFamilies,
  nearestWeight,
  usedFontChecks,
  usedFontFamilies,
} from '../src/fonts/registry.ts';
import { fieldsFor, setFontFamilyOptions } from '../src/editor/inspector.ts';

function ok(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

const fams = listFontFamilies();
const serif = fams.find((f) => f.family === 'Noto Serif SC');
const sans = fams.find((f) => f.family === 'Noto Sans SC');
ok(Boolean(serif), '字体库含 Noto Serif SC');
ok(Boolean(sans), '字体库含 Noto Sans SC');
ok(serif.weights.includes(400) && serif.weights.includes(700), 'Noto Serif SC 有 400/700');
ok(sans.weights.includes(400) && sans.weights.includes(700), 'Noto Sans SC 有 400/700');

const css = buildFontCss({ baseUrl: '/api/fonts' });
ok(css.includes('@font-face'), '@font-face 已生成');
ok(css.includes('/api/fonts/NotoSerifSC/400.woff2'), 'Serif 400 URL 正确');
ok(css.includes('/api/fonts/NotoSansSC/700.woff2'), 'Sans 700 URL 正确');

const p = fontFileByDir('NotoSerifSC', '400.woff2');
ok(Boolean(p) && existsSync(p), 'fontFileByDir 找到真实文件');

const doc = {
  canvas: { width: 1080, height: 1350 },
  layers: [
    {
      id: 'l1',
      elements: [
        {
          id: 't1',
          type: 'text',
          frame: { x: 0, y: 0, w: 100 },
          runs: [{ text: '野豆' }],
          fontFamily: '"Noto Serif SC", "Songti SC", serif',
          weight: 600,
        },
      ],
    },
  ],
};

const used = usedFontFamilies(doc);
ok(used.includes('Noto Serif SC'), 'usedFontFamilies 识别 Serif');
ok(!used.includes('Songti SC'), '不把系统字体当库字体');

const checks = usedFontChecks(doc);
ok(checks.some((c) => c.family === 'Noto Serif SC' && c.weight === 700), '600 → 700（最近可用字重）');
ok(nearestWeight('Noto Serif SC', 400) === 400, '400 不变');

setFontFamilyOptions(['Noto Serif SC', 'Noto Sans SC']);
const ff = fieldsFor(doc.layers[0].elements[0], doc.canvas).find((f) => f.path === 'fontFamily');
ok(ff?.kind.kind === 'enum', '编辑器「字体」变成下拉（enum）');
ok(ff?.kind.options?.includes('Noto Serif SC'), '下拉含库字体');

console.log('\n全部通过');
