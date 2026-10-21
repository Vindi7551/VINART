/**
 * 探针：草图 plan → DesignIntent → DesignDocument → HTML → 真 Chromium 截图。
 *
 * 断言：
 *   ① translate 没有 error；emit 没有 unsupported；
 *   ② 图层名 / z-order / 文字 frame / 字号 / 占位 asset 和 doc 一致；
 *   ③ 真 DOM 里图片是灰色占位 SVG（data URL、object-fit:contain）、文字是 54px；
 *   ④ 产出截图，人工看布局。
 *
 * 运行：
 *   node --experimental-transform-types --import ./scripts/_ts-resolve.mjs scripts/_probe-sketch-render.ts
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PLACEHOLDER_ASSET, planToIntent, type SketchPlan } from '../src/schema/plan.ts';
import { isTranslatable, translate } from '../src/workflow/translate/translate.ts';
import { emitDocument } from '../src/render/vocabulary/emit.ts';
import type { ImageNode, TextNode } from '../src/document/vocabulary.ts';

const PLAN: SketchPlan = {
  canvas: { ratio: '1:1', background: '#ffffff' },
  layers: [
    {
      name: '产品层',
      elements: [
        { type: 'image', name: '产品图', rect: { x: 0.25, y: 0.2, w: 0.5, h: 0.5 } },
      ],
    },
    {
      name: '文字层',
      elements: [
        {
          type: 'text',
          name: '标题',
          rect: { x: 0.1, y: 0.75, w: 0.8 },
          align: 'center',
          placeholder: '示例标题',
        },
      ],
    },
  ],
};

// 内置占位图：与 server 的 resolveAssets 用同一份文件
const svg = readFileSync('designassets/builtin/placeholder.svg', 'utf8');
const assets = {
  [PLACEHOLDER_ASSET]: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
};

const intent = planToIntent(PLAN);
const result = translate(intent);
const doc = result.doc;
const emit = emitDocument(doc, { assets });

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg);
};

ok(isTranslatable(result), `translate 有 error：${JSON.stringify(result.issues.filter((i) => i.level === 'error'))}`);
ok(emit.unsupported.length === 0, `emit unsupported：${JSON.stringify(emit.unsupported)}`);
ok(doc.layers.map((l) => l.name).join(',') === '产品层,文字层', `图层名 = ${doc.layers.map((l) => l.name).join(',')}`);

const image = doc.layers[0]?.elements.find((e) => e.type === 'image') as ImageNode | undefined;
const text = doc.layers[1]?.elements.find((e) => e.type === 'text') as TextNode | undefined;
ok(image?.asset === PLACEHOLDER_ASSET, `图片 asset = ${image?.asset}`);
ok(image?.rect.x === 300 && image?.rect.y === 240 && image?.rect.w === 600 && image?.rect.h === 600,
  `图片 rect = ${JSON.stringify(image?.rect)}`);
ok(text?.frame.x === 120 && text?.frame.y === 900 && text?.frame.w === 960, `文字 frame = ${JSON.stringify(text?.frame)}`);
ok(text?.fontSizePx === 26, `文字 fontSizePx = ${text?.fontSizePx}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
await page.setContent(emit.html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts?.ready);

const dom = await page.evaluate(() => {
  const img = document.querySelector('[data-layer="el-1-1"] img') as HTMLImageElement | null;
  const textEl = document.querySelector('[data-layer="el-2-1"]') as HTMLElement | null;
  // 字号在内层叶子（run span）上；[data-fit] 只是测量壳，计算值仍是默认 16px
  const textLeaf = textEl
    ? ([...textEl.querySelectorAll('*')].find(
        (el) => el.children.length === 0 && (el.textContent ?? '').trim() === '示例标题',
      ) as HTMLElement | undefined)
    : undefined;
  return {
    layers: [...document.querySelectorAll('[data-layer]')].map((e) => e.getAttribute('data-layer')),
    imgSrc: img?.getAttribute('src')?.slice(0, 30) ?? null,
    imgFit: img ? getComputedStyle(img).objectFit : null,
    text: textEl?.textContent?.trim() ?? null,
    textSize: textLeaf ? getComputedStyle(textLeaf).fontSize : null,
  };
});

ok(dom.imgSrc?.startsWith('data:image/svg+xml') ?? false, `图片 src 不是占位 SVG：${dom.imgSrc}`);
ok(dom.imgFit === 'contain', `图片 object-fit = ${dom.imgFit}`);
ok(dom.text?.includes('示例标题') ?? false, `文字内容 = ${dom.text}`);
ok(dom.textSize === '26px', `文字字号 = ${dom.textSize}`);

await page.screenshot({ path: '.tmp-sketch-render-white.png' });
await browser.close();

console.log(JSON.stringify({ layers: dom.layers, image: { src: dom.imgSrc, fit: dom.imgFit }, text: { value: dom.text, size: dom.textSize } }, null, 2));

if (fails.length) {
  console.error(`\n✗ ${fails.length} 条断言失败：`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('\n✓ 草图渲染探针通过，截图 .tmp-sketch-render-white.png');
