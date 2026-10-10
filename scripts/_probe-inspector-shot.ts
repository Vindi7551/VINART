/**
 * 量检查器栏 —— 「松/紧」要有数字，不靠印象。
 *
 * 配套 `scripts/_probe-inspector/index.html`（真组件 + 真样式表 + 真版式数据）。
 *
 * 跑三遍，量化「收紧能省多少」：
 *   pass 0 baseline —— 现状
 *   pass 1 spacing  —— 只收紧间距与行盒（行高、外边距、内边距、滑块行）
 *   pass 2 inline   —— 再叠一层：x/y/w/h 这类**单字符标签**从「占一整行」改行内
 *                      ⚠️ pass 2 用 `:nth-of-type` 硬选小节，**只是探针里的模拟**，
 *                         真实现要动 JSX（`Row` 支持行内标签），所以这层数字是上界。
 *
 * 输出：每栏的小节骨架（高度/外边距）、控件实高、间距 token、
 *       内容总高 vs 可视高（底部那片空白）、2× 截图。
 *
 * ⚠️ **只改这个页面的样式，产品代码一行不动。**
 *
 * 运行：
 *   npm run step scripts/_probe-inspector-shot.ts
 *   npm run step scripts/_probe-inspector-shot.ts -- <url> <png前缀>
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173/scripts/_probe-inspector/index.html';
const prefix = resolve(process.argv[3] ?? '.tmp-run/inspector');

/** pass 1：只动间距与行盒——不碰结构与控件尺寸 */
const TIGHT_SPACING = `
  .ui-panel-body { padding: 8px 10px; line-height: 1.4; }
  .ui-section { margin-bottom: 8px; }
  .ui-section.divider { padding-top: 6px; margin-top: 6px; }
  .ui-section-title { margin-bottom: 3px; }
  .ui-section > *:last-child { margin-bottom: 0; }
  .ui-row { margin-bottom: 5px; gap: 6px; }
  .ui-field { gap: 2px; }
  .ui-field-label { line-height: 1.25; }
  .ui-slider-field { margin-bottom: 5px; gap: 6px; }
  .ui-slider-field .ui-field-label { min-width: 50px; }
  .ui-slider-value { min-width: 34px; }
  .ui-hint { line-height: 1.45; }
  .ui-input { padding: 3px 6px; }
`;

/** pass 2：再叠「单字符标签行内化」（模拟用，硬选含 x/y/w/h 的小节） */
const TIGHT_INLINE = `
  .ui-row > .ui-field { flex-direction: row; align-items: center; gap: 4px; }
  .ui-row > .ui-field .ui-field-label { flex: none; min-width: 10px; }
`;

const PASSES: { name: string; css: string }[] = [
  { name: 'baseline', css: '' },
  { name: 'spacing ', css: TIGHT_SPACING },
  { name: 'inline  ', css: TIGHT_SPACING + TIGHT_INLINE },
];

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({
  viewport: { width: 1080, height: 900 },
  deviceScaleFactor: 2,
});
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.ui-panel-body', { timeout: 15000 });
await page.waitForTimeout(400);

const measure = () =>
  page.evaluate(() => {
    const r1 = (n: number) => Math.round(n * 10) / 10;

    const cols = [...document.querySelectorAll('.inspector-col')].map((col) => {
      const body = col.querySelector('.ui-panel-body') as HTMLElement;
      const head = col.querySelector('.ui-panel-header') as HTMLElement;
      const bs = getComputedStyle(body);

      const kids = [...body.children].map((el) => {
        const cs = getComputedStyle(el);
        const title = el.querySelector(':scope > .ui-section-title') as HTMLElement | null;
        const r = el.getBoundingClientRect();
        return {
          label: title?.textContent ?? '',
          h: r1(r.height),
          bottom: r1(r.bottom),
          y: r1(r.y),
          mb: cs.marginBottom,
          ctl: [...el.querySelectorAll('.ui-input, .ui-slider-field, .ui-btn')].map(
            (c) => r1(c.getBoundingClientRect().height),
          ),
        };
      });

      const first = kids[0];
      const last = kids[kids.length - 1];
      const contentH = first && last ? r1(last.bottom - first.y) : 0;
      const gaps: number[] = [];
      for (let i = 1; i < kids.length; i++) gaps.push(r1(kids[i].y - kids[i - 1].bottom));

      return {
        type: col.getAttribute('data-probe-type'),
        header: r1(head.getBoundingClientRect().height),
        bodyH: body.clientHeight,
        contentH,
        tail: r1(body.clientHeight - parseFloat(bs.paddingTop) - contentH),
        kids,
        gaps,
      };
    });

    const one = (sel: string, prop: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop as never] : '-';
    };
    return {
      cols,
      spacing: {
        row: `${one('.ui-row', 'gap')} / mb ${one('.ui-row', 'marginBottom')}`,
        field: `${one('.ui-field', 'gap')} / mb ${one('.ui-field', 'marginBottom')}`,
        section: `mb ${one('.ui-section', 'marginBottom')}`,
        slider: `${one('.ui-slider-field', 'gap')} / mb ${one('.ui-slider-field', 'marginBottom')}`,
        bodyLine: one('.ui-panel-body', 'lineHeight'),
      },
    };
  });

for (const pass of PASSES) {
  await page.evaluate(() => document.getElementById('__probe_tight')?.remove());
  if (pass.css) await page.addStyleTag({ content: pass.css, id: '__probe_tight' } as never);
  else await page.evaluate(() => document.getElementById('__probe_tight')?.remove());
  await page.waitForTimeout(200);

  const rep = await measure();
  console.log(`\n████████ pass [${pass.name}] ████████`);
  for (const c of rep.cols) {
    const secs = c.kids
      .map((k) => `${k.label || '(无标题)'}=${k.h}${k.mb === '0px' ? '' : `+${k.mb}`}`)
      .join('  ');
    console.log(
      `[${c.type}] 表头 ${c.header} · 正文可视 ${c.bodyH} · 内容 ${c.contentH} · 底部空白 ${c.tail}`,
    );
    console.log(`        小节：${secs}`);
    console.log(`        控件实高：${[...new Set(c.kids.flatMap((k) => k.ctl))].join(', ')}`);
    console.log(`        相邻净空：${c.gaps.join(' | ')}`);
  }
  if (pass.name === 'baseline') console.log(`\n间距 token：${JSON.stringify(rep.spacing)}`);
  await page.screenshot({ path: `${prefix}-${pass.name.trim()}.png`, fullPage: true });
  // 单栏裁图:全页图被缩小后看不清控件细节(眼睛/图标/字号),这一张是**原始像素**
  await page
    .locator('.inspector-col')
    .first()
    .screenshot({ path: `${prefix}-${pass.name.trim()}-crop.png` });
}

console.log(`\n已保存 ${prefix}-{baseline,spacing,inline}.png`);
await browser.close();
