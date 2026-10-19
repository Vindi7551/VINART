/**
 * 探针：文字就地编辑的两类硬问题（2026-10-19 修）
 *
 * 1. **打字 / 删字 / 输入法上屏后，父侧选中框要跟着文字高度走** ——
 *    文字高度是排版结果；编辑收尾期间 `selectionchange` 被 `suppressSel` 压着，
 *    不主动 `syncOverlay` 的话框会停在旧高度（实测 28 vs 56）。
 * 2. **中文输入法组合态**：
 *    - 段中组合：光标落在上屏文本之后（不是段尾）；
 *    - 跨 runs 选区被组合替换：doc 要跟着删（不是只改锚点那一段）；
 *    - Esc（`isComposing`）：只取消候选，不退出文字态；
 *    - Enter（`isComposing`）：只选词，不插换行；
 *    - `compositionend.data` 带串但 DOM 没上屏（取消）：不落盘。
 *
 * ⚠️ 组合态是用 `CompositionEvent` + 手动改 DOM 模拟的（无头浏览器没有真输入法）；
 *    真机上仍建议用中文输入法点一遍。
 *
 * 跑法：
 *   node --experimental-transform-types --import ./scripts/_ts-resolve.mjs scripts/_probe-editor-ime.ts
 */
import { chromium, type Page } from 'playwright';
import { buildSync } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('.tmp-run/probe-editor-ime.js');
mkdirSync(resolve('.tmp-run'), { recursive: true });
buildSync({
  entryPoints: [resolve('scripts/_probe-editor-ime.entry.ts')],
  bundle: true,
  format: 'iife',
  outfile: OUT,
  logLevel: 'silent',
});

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg);
};

const browser = await chromium.launch({ headless: true });

async function boot(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 600, height: 500 } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.setContent('<!DOCTYPE html><html><body style="margin:0"></body></html>');
  await page.addScriptTag({ path: OUT });
  await page.evaluate(() => window.__boot?.());
  await page.waitForFunction(() => !!window.__ed, null, { timeout: 10_000 });
  return page;
}

const overlayHeight = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-ve-overlay]');
    return el ? +el.getBoundingClientRect().height.toFixed(1) : null;
  });

const vtHeight = (page: Page, id: string) =>
  page.evaluate((id) => {
    const f = document.getElementById('f') as HTMLIFrameElement;
    const el = f.contentDocument!.querySelector(`[data-fit="${id}"]`)!;
    return +el.getBoundingClientRect().height.toFixed(1);
  }, id);

const qText = (page: Page) =>
  page.evaluate(() => {
    const n = window.__ed!.doc.layers[0].elements.find((e) => e.id === 'q')!;
    return n.type === 'text' ? n.runs.map((r) => r.text).join('') : '';
  });

const enterQ = async (page: Page) => {
  await page.evaluate(() => {
    window.__ed!.select('q');
    window.__ed!.beginTextEdit('q');
  });
  await page.waitForTimeout(80);
};

const caretAt = (page: Page, run: number, offset: number) =>
  page.evaluate(
    ({ run, offset }) => {
      const f = document.getElementById('f') as HTMLIFrameElement;
      const span = f.contentDocument!.querySelector(`[data-fit="q"] [data-run="${run}"]`)!;
      const tn = span.firstChild!;
      const r = f.contentDocument!.createRange();
      r.setStart(tn, offset);
      r.collapse(true);
      const s = f.contentWindow!.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      f.contentDocument!.dispatchEvent(new (f.contentWindow as any).Event('selectionchange'));
    },
    { run, offset },
  );

// ── 1) 打字换行后，选中框跟文字高度 ─────────────────────────
{
  const page = await boot();
  await page.evaluate(() => {
    window.__ed!.select('p');
    window.__ed!.beginTextEdit('p');
  });
  await page.waitForTimeout(80);
  await page.keyboard.type(' alpha beta gamma delta epsilon zeta', { delay: 5 });
  await page.waitForTimeout(250);
  const [ov, vt] = [await overlayHeight(page), await vtHeight(page, 'p')];
  console.log(`① 打字换行：选中框 ${ov}px / 文字 ${vt}px`);
  ok(ov !== null && Math.abs(ov - vt) <= 1, `选中框没跟上文字高度（overlay=${ov} vt=${vt}）`);
  await page.close();
}

// ── 2) 段中组合：光标在上屏文本之后 ─────────────────────────
{
  const page = await boot();
  await enterQ(page);
  await caretAt(page, 0, 3);
  await page.evaluate(() => {
    const f = document.getElementById('f') as HTMLIFrameElement;
    const w = f.contentWindow!;
    f.contentDocument!.dispatchEvent(new (w as any).CompositionEvent('compositionstart'));
    const span = f.contentDocument!.querySelector('[data-fit="q"] [data-run="0"]')!;
    const tn = span.firstChild!;
    tn.nodeValue = tn.nodeValue!.slice(0, 3) + '中文' + tn.nodeValue!.slice(3);
    const r = f.contentDocument!.createRange();
    r.setStart(tn, 5);
    r.collapse(true);
    const s = w.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    f.contentDocument!.dispatchEvent(new (w as any).CompositionEvent('compositionend', { data: '中文' }));
  });
  await page.waitForTimeout(150);
  const state = await page.evaluate(() => {
    const f = document.getElementById('f') as HTMLIFrameElement;
    const s = f.contentWindow!.getSelection()!;
    return {
      text: window.__ed!.doc.layers[0].elements.find((e) => e.id === 'q')!.type === 'text'
        ? (window.__ed!.doc.layers[0].elements.find((e) => e.id === 'q') as any).runs.map((r: any) => r.text).join('')
        : '',
      caretOffset: s.anchorOffset,
      caretRun: (s.anchorNode?.parentElement as HTMLElement | null)?.getAttribute('data-run') ?? null,
    };
  });
  console.log(`② 段中组合：doc=${JSON.stringify(state.text)} 光标=run ${state.caretRun} / offset ${state.caretOffset}`);
  ok(state.text === 'Hel中文lo world', `段中组合文字不对：${JSON.stringify(state.text)}`);
  ok(state.caretRun === '0' && state.caretOffset === 5, `段中组合光标应 0:5，实为 ${state.caretRun}:${state.caretOffset}`);
  await page.close();
}

// ── 3) 跨 runs 选区被组合替换：doc 跟着删 ───────────────────
{
  const page = await boot();
  await enterQ(page);
  await page.evaluate(() => {
    const f = document.getElementById('f') as HTMLIFrameElement;
    const w = f.contentWindow!;
    const s0 = f.contentDocument!.querySelector('[data-fit="q"] [data-run="0"]')!.firstChild!;
    const s1 = f.contentDocument!.querySelector('[data-fit="q"] [data-run="1"]')!.firstChild!;
    const r = f.contentDocument!.createRange();
    r.setStart(s0, 2);
    r.setEnd(s1, 2);
    const s = w.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    f.contentDocument!.dispatchEvent(new (w as any).Event('selectionchange'));
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const f = document.getElementById('f') as HTMLIFrameElement;
    const w = f.contentWindow!;
    f.contentDocument!.dispatchEvent(new (w as any).CompositionEvent('compositionstart'));
    const span0 = f.contentDocument!.querySelector('[data-fit="q"] [data-run="0"]')!;
    const span1 = f.contentDocument!.querySelector('[data-fit="q"] [data-run="1"]')!;
    // 模拟浏览器：删掉跨段选区，在起点插入组合文本
    span0.firstChild!.nodeValue = 'He中文';
    span1.firstChild!.nodeValue = 'rld';
    const r = f.contentDocument!.createRange();
    r.setStart(span0.firstChild!, 4);
    r.collapse(true);
    const s = w.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    f.contentDocument!.dispatchEvent(new (w as any).CompositionEvent('compositionend', { data: '中文' }));
  });
  await page.waitForTimeout(150);
  const text = await qText(page);
  console.log(`③ 跨段选区被组合替换：doc=${JSON.stringify(text)}`);
  ok(text === 'He中文rld', `跨段组合后 doc 应为 "He中文rld"，实为 ${JSON.stringify(text)}`);
  await page.close();
}

// ── 4/5) 组合态的 Esc / Enter 归输入法 ─────────────────────
{
  const page = await boot();
  await enterQ(page);
  const esc = await page.evaluate(() => {
    const f = document.getElementById('f') as HTMLIFrameElement;
    f.contentDocument!.dispatchEvent(
      new (f.contentWindow as any).KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
    );
    return window.__ed!.textEditId;
  });
  console.log(`④ 组合态 Esc：textEditId=${JSON.stringify(esc)}`);
  ok(esc === 'q', `组合态 Esc 把文字态退掉了（textEditId=${esc}）`);

  const before = await qText(page);
  await page.evaluate(() => {
    const f = document.getElementById('f') as HTMLIFrameElement;
    const el = f.contentDocument!.querySelector('[data-fit="q"] [data-run="0"]')!;
    const tn = el.firstChild!;
    const r = f.contentDocument!.createRange();
    r.setStart(tn, tn.nodeValue!.length);
    r.collapse(true);
    const s = f.contentWindow!.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    f.contentDocument!.dispatchEvent(new (f.contentWindow as any).Event('selectionchange'));
    f.contentDocument!.dispatchEvent(
      new (f.contentWindow as any).InputEvent('beforeinput', {
        inputType: 'insertLineBreak',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForTimeout(80);
  const after = await qText(page);
  console.log(`⑤ 组合态 Enter：${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  ok(after === before, `组合态 Enter 往文档里插了换行：${JSON.stringify(after)}`);
  await page.close();
}

// ── 6) 取消组合：data 带串但 DOM 没上屏 ────────────────────
{
  const page = await boot();
  await enterQ(page);
  const before = await qText(page);
  await page.evaluate(() => {
    const f = document.getElementById('f') as HTMLIFrameElement;
    const w = f.contentWindow!;
    f.contentDocument!.dispatchEvent(new (w as any).CompositionEvent('compositionstart'));
    // 不碰 DOM（浏览器取消组合后 DOM 保持原文）
    f.contentDocument!.dispatchEvent(new (w as any).CompositionEvent('compositionend', { data: '中文' }));
  });
  await page.waitForTimeout(120);
  const after = await qText(page);
  console.log(`⑥ 取消组合：${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  ok(after === before, `取消的组合被落盘了：${JSON.stringify(after)}`);
  await page.close();
}

await browser.close();

if (fails.length) {
  console.error(`\n✗ ${fails.length} 条断言失败：`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('\n✓ 选中框随文字高度 / 输入法段中·跨段·Esc·Enter·取消 全部正常');
