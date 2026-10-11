/**
 * **M1 不变量探针** —— 验收 `docs/EDITOR-EVOLUTION.md` §5.5 里 M1 那四条。
 *
 * 与 `_probe-editor-behaviour.ts` 分工不同：
 * - 那一支测「**功能没回退**」（20 条，M1 前后都应全绿）
 * - 这一支测「**M1 确实做到了**」（去注入之后才可能成立的新断言）
 *
 * 四条：
 * ① 子文档 `<script>` 数恒 0（且覆盖层不在子文档里）
 * ② `src/editor/` 不含全局网页对象（grep，见 `src/editor/README.md`）
 * ③ 真实 app 端到端位移正确 —— **多个 zoom 各测一条 move + 一条 resize**
 *    （口径：屏幕拖 N px ⇒ 子文档 Δ = N/zoom）
 * ④ 命中测试两段式 —— 手柄赢过底下的层；点选中框边线**不取消选中**
 * ⑤ 显式指针生命周期 —— 拖到画布外仍然跟手（`setPointerCapture`）
 *
 * 运行：npm run step scripts/_probe-m1-invariants.ts
 * 前置：`npm run dev` 起着。
 */

import { chromium, type Page } from 'playwright';
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const PORT = process.env.VINART_PORT || '5174';
const WORKDIR = process.env.VINART_WORKDIR || 'D:\\workplace\\test';
const DESIGN = process.env.VINART_DESIGN || 'POSTER01';
const SESSION_TITLE = process.env.VINART_SESSION_TITLE || '生成类似的海报。';

let pass = 0;
const fails: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fails.push(msg); console.log(`  ✗ ${msg}`); }
}
function info(msg: string) { console.log(`  · ${msg}`); }

// ── 产物备份/恢复（防抖自动保存会写盘）────────────────────────────
const DESIGN_DIR = join(WORKDIR, 'designs', DESIGN);
const backups = new Map<string, string>();
function backup() {
  for (const f of ['design-sketch.json', 'design-appearance.json'].map((x) => join(DESIGN_DIR, x))) {
    if (!existsSync(f)) continue;
    const b = `${f}.probe-backup`;
    copyFileSync(f, b);
    backups.set(f, b);
  }
}
function restore() {
  for (const [f, b] of backups) if (existsSync(b)) copyFileSync(b, f);
  for (const [, b] of backups) { try { unlinkSync(b); } catch { /* ignore */ } }
}

const HELPERS = `
window.__vt = {
  frame() { return document.querySelector('.preview-frame'); },
  wrap() { return document.querySelector('.canvas-wrapper'); },
  canv() { return document.querySelector('.preview-canvas'); },
  child() { try { const f = this.frame(); return f && f.contentDocument; } catch (e) { return null; } },
  zoom() { const f = this.frame(), w = this.wrap(); return f && w ? w.getBoundingClientRect().width / f.clientWidth : 1; },
  layer(id) { const d = this.child(); return d && d.querySelector('[data-layer="' + id + '"]'); },
  style(id) { const el = this.layer(id); if (!el) return null; return {
    left: parseFloat(el.style.left), top: parseFloat(el.style.top),
    w: parseFloat(el.style.width), h: parseFloat(el.style.height) }; },
  layerBox(id) { const el = this.layer(id); if (!el) return null; const r = el.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; },
  toPage(lx, ly) { const w = this.wrap().getBoundingClientRect(), z = this.zoom();
    return { x: w.x + lx * z, y: w.y + ly * z }; },
  /** 装饰件（父优先、回退子）—— rect 退化则返回 null，拒绝盲拖 */
  deco(sel) {
    const w = this.wrap().getBoundingClientRect(), z = this.zoom();
    let el = document.querySelector(sel);
    if (el) { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, where: 'parent' }; }
    const d = this.child(); el = d && d.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { x: w.x + (r.x + r.width / 2) * z, y: w.y + (r.y + r.height / 2) * z, where: 'child' };
  },
  selBox() {
    const pick = (root) => (root ? root.querySelector('[data-ve-handle="se"]') : null);
    let h = pick(document), where = 'parent';
    if (!h) { h = pick(this.child()); where = 'child'; }
    if (!h) return null;
    const ov = h.parentElement, r = ov.getBoundingClientRect();
    return { where, display: getComputedStyle(ov).display, w: r.width, h: r.height };
  },
  /** 选中框的上边中点（页面坐标）；dy 为负 = 往框外挪 */
  boxEdge(dy) {
    const h = document.querySelector('[data-ve-handle="se"]');
    if (!h) return null;
    const ov = h.parentElement, r = ov.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + dy };
  },
  counts() {
    const d = this.child();
    return {
      childScripts: d ? d.querySelectorAll('script').length : -1,
      childOverlay: d ? d.querySelectorAll('[data-ve-overlay],[data-ve-handle],[data-ve-rot]').length : -1,
      parentOverlay: document.querySelectorAll('[data-ve-overlay]').length,
      parentHandles: document.querySelectorAll('[data-ve-handle],[data-ve-rot]').length,
    };
  },
  selectedId() {
    const root = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^版式编辑$/.test((e.textContent || '').trim()));
    const panel = root && root.closest('.ui-panel, section, div');
    if (!panel) return null;
    const b = panel.querySelector('b');
    return b ? b.textContent.trim() : null;
  },
  zoomIn() { const b = [...document.querySelectorAll('.zoom-btn')].find((x) => x.textContent.trim() === '+'); if (b) b.click(); },
  zoomOut() { const b = [...document.querySelectorAll('.zoom-btn')].find((x) => x.textContent.trim() === '−'); if (b) b.click(); },
  errors: [],
};
`;

async function setup(page: Page) {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.evaluate(HELPERS);
  await page.locator('.session-item-title', { hasText: SESSION_TITLE }).first().click();
  await page.waitForTimeout(2500);
  await page.evaluate((name) => {
    const n = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.textContent || '').trim() === name);
    if (n[0]) ((n[0].closest('button,a,li,div[role],div') || n[0]) as HTMLElement).click();
  }, DESIGN);
  await page.waitForTimeout(3500);
  return errs;
}

/** 选中某层：点它的中心 */
async function selectLayer(page: Page, id: string) {
  const b = await page.evaluate((x) => { const v = window.__vt.layerBox(x); return v ? window.__vt.toPage(v.cx, v.cy) : null; }, id);
  if (!b) return false;
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(250);
  return (await page.evaluate(() => window.__vt.selectedId())) === id;
}

/** 点一次缩放按钮，并**等到 zoom 真的变了**（React 提交是异步的，点完立刻读会读到旧值） */
async function nudgeZoom(page: Page, dir: 'in' | 'out') {
  const before = await page.evaluate(() => window.__vt.zoom());
  await page.evaluate((d) => (d === 'in' ? window.__vt.zoomIn() : window.__vt.zoomOut()), dir);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(60);
    const now = await page.evaluate(() => window.__vt.zoom());
    if (Math.abs(now - before) > 1e-6) return now;
  }
  return before;
}

/** 在给定 zoom 下量一条 move 与一条 resize */
async function measureAt(page: Page, id: string, label: string) {
  const st = await page.evaluate((x) => {
    const s = window.__vt.style(x);
    const w = window.__vt.wrap().getBoundingClientRect();
    return { s, zoom: window.__vt.zoom(), wrap: { x: w.x, y: w.y, w: w.width, h: w.height } };
  }, id);
  const zoom = st.zoom;
  const N = 40;
  const stepLocal = +(N / zoom).toFixed(2);
  info(`${label}：实际 zoom = ${zoom.toFixed(4)}`);

  // ── move：向左拖 40 屏幕 px（内移，保证元素不越出画布）──
  const from = await page.evaluate((x) => { const b = window.__vt.layerBox(x); return window.__vt.toPage(b.cx, b.cy); }, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - N, from.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const s1 = await page.evaluate((x) => window.__vt.style(x), id);
  const dMove = +(s1.left - st.s.left).toFixed(2);
  ok(Math.abs(dMove + stepLocal) < 2, `${label} move：Δleft ${dMove} ≈ ${-stepLocal}`);

  // ── resize：se 柄 +40 屏幕 px（只吃 Δx）──
  const deco = await page.evaluate(() => {
    const d = window.__vt.deco('[data-ve-handle="se"]');
    if (!d) return null;
    const w = window.__vt.wrap().getBoundingClientRect();
    d.inside = d.x >= w.x && d.x <= w.x + w.width && d.y >= w.y && d.y <= w.y + w.height;
    return d;
  });
  if (!deco || !(deco as { inside?: boolean }).inside) {
    ok(false, `${label} resize：se 柄够不着（${deco ? '在画布外' : '找不到'}）`);
    return;
  }
  const before = await page.evaluate((x) => window.__vt.style(x), id);
  await page.mouse.move(deco.x, deco.y);
  await page.mouse.down();
  await page.mouse.move(deco.x + N, deco.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate((x) => window.__vt.style(x), id);
  const dW = +(after.w - before.w).toFixed(2);
  ok(Math.abs(dW - stepLocal) < 2, `${label} resize：Δw ${dW} ≈ ${stepLocal}`);
}

(async () => {
  if (!existsSync(DESIGN_DIR)) {
    console.error(`✗ 找不到产物目录：${DESIGN_DIR}`);
    process.exit(2);
  }
  backup();
  console.log(`备份 ${backups.size} 个文件（跑完恢复）`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  try {
    const errs = await setup(page);

    const st0 = await page.evaluate(() => {
      const d = window.__vt.child();
      return {
        zoom: window.__vt.zoom(),
        layers: d ? [...d.querySelectorAll('[data-layer]')].map((e) => e.getAttribute('data-layer')) : [],
        counts: window.__vt.counts(),
      };
    });
    info(`图层 ${st0.layers.length} 个；zoom = ${st0.zoom.toFixed(4)}`);
    ok(st0.layers.length > 0, `可编辑图层存在（${st0.layers.length}）`);
    if (!st0.layers.length) throw new Error('没有图层');
    const ID = st0.layers.includes('title_cn') ? 'title_cn' : st0.layers[0];

    // ══ ① 子文档里没有脚本、也没有覆盖层 ══════════════════════════
    console.log('\n【①】子文档是纯渲染产物');
    info(`子文档 script=${st0.counts.childScripts} / 覆盖层残留=${st0.counts.childOverlay}`);
    info(`父文档 overlay=${st0.counts.parentOverlay} / 手柄=${st0.counts.parentHandles}`);
    ok(st0.counts.childScripts === 0, '子文档 <script> 数 = 0');
    ok(st0.counts.childOverlay === 0, '子文档里没有覆盖层元素');
    ok(st0.counts.parentOverlay === 1, '覆盖层只有一份，且在父文档');

    // ══ ② src/editor 不含全局网页对象 ════════════════════════════
    console.log('\n【②】src/editor 不引用全局网页对象');
    let hits = '';
    try {
      hits = execFileSync('grep', ['-rnE', '\\b(document|window)\\b', 'src/editor/'], { encoding: 'utf8' });
    } catch { hits = ''; }   // grep 无命中 → 退出码 1 → execFileSync 抛
    if (hits.trim()) info(hits.trim().split('\n').slice(0, 5).join('\n'));
    ok(!hits.trim(), 'grep 无命中（编辑器只认参数流入的文档）');

    // ══ ③ 多个 zoom 下的端到端位移 ═══════════════════════════════
    console.log('\n【③】端到端位移（多个 zoom）');
    ok(await selectLayer(page, ID), `先在 zoom=${st0.zoom.toFixed(3)} 下选中 ${ID}`);
    await measureAt(page, ID, 'z=fit');

    const z2 = await nudgeZoom(page, 'out');
    if (await selectLayer(page, ID)) await measureAt(page, ID, `z=${z2.toFixed(4)}`);
    else ok(false, '缩小后重新选中失败');

    const z3 = await nudgeZoom(page, 'out');
    if (await selectLayer(page, ID)) await measureAt(page, ID, `z=${z3.toFixed(4)}`);
    else ok(false, '再缩小后重新选中失败');

    // ══ ④ 命中测试两段式 ═════════════════════════════════════════
    console.log('\n【④】两段式命中');
    // 放大一点，好让手柄与边线都看得清
    await nudgeZoom(page, 'in');
    await nudgeZoom(page, 'in');
    ok(await selectLayer(page, ID), `${ID} 已选中（为命中测试做准备）`);

    // ④a 手柄赢过底下的层：按在 se 柄上 = 缩放，不是移动
    const stA = await page.evaluate((x) => window.__vt.style(x), ID);
    const h = await page.evaluate(() => {
      const d = window.__vt.deco('[data-ve-handle="se"]');
      if (!d) return null;
      const w = window.__vt.wrap().getBoundingClientRect();
      d.inside = d.x >= w.x && d.x <= w.x + w.width && d.y >= w.y && d.y <= w.y + w.height;
      return d;
    });
    if (h && (h as { inside?: boolean }).inside) {
      await page.mouse.move(h.x, h.y);
      await page.mouse.down();
      await page.mouse.move(h.x + 25, h.y, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const stB = await page.evaluate((x) => window.__vt.style(x), ID);
      info(`按 se 柄后：left ${stA.left}→${stB.left}，w ${stA.w}→${stB.w}`);
      ok(Math.abs(stB.w - stA.w) > 10 && Math.abs(stB.left - stA.left) < 1, '手柄优先：宽度变、left 不变（没被底下那层截胡成移动）');
    } else {
      ok(false, '④a 找不到可用的 se 柄');
    }

    // ④b 点选中框**边线** → 不取消选中
    const boxA = await page.evaluate(() => window.__vt.selBox());
    const edge = await page.evaluate(() => window.__vt.boxEdge(1));
    if (edge && boxA && boxA.display === 'block') {
      await page.mouse.click(edge.x, edge.y);
      await page.waitForTimeout(250);
      const boxB = await page.evaluate(() => window.__vt.selBox());
      info(`点边线前 ${JSON.stringify(boxA)} → 后 ${JSON.stringify(boxB)}`);
      ok(!!boxB && boxB.display === 'block' && boxB.w > 1, '点选中框边线**不取消选中**（旧实现在这里会归零）');
    } else {
      ok(false, '④b 选中框不可见，无法测边线');
    }

    // ══ ⑤ 拖到画布外仍跟手（setPointerCapture）═══════════════════
    console.log('\n【⑤】拖出画布边界仍跟手');
    ok(await selectLayer(page, ID), `${ID} 已选中（为越界拖拽做准备）`);
    const stC = await page.evaluate((x) => window.__vt.style(x), ID);
    const z5 = await page.evaluate(() => window.__vt.zoom());
    const from5 = await page.evaluate((x) => { const b = window.__vt.layerBox(x); return window.__vt.toPage(b.cx, b.cy); }, ID);
    const wrapR = await page.evaluate(() => { const r = window.__vt.wrap().getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    // 目标：画布右缘之外（但仍留在视口内），保证"松手时指针不在画布里"
    const outsideX = Math.min(wrapR.x + wrapR.w + 60, 1580);
    const moved = outsideX - from5.x;
    await page.mouse.move(from5.x, from5.y);
    await page.mouse.down();
    await page.mouse.move(outsideX, from5.y, { steps: 10 });
    const mid = await page.evaluate((x) => window.__vt.style(x), ID);   // 松手**之前**读
    await page.mouse.up();
    await page.waitForTimeout(200);
    const stD = await page.evaluate((x) => window.__vt.style(x), ID);
    info(`画布右缘 x=${(wrapR.x + wrapR.w).toFixed(1)}，松手点 x=${outsideX.toFixed(1)}（画布外）`);
    info(`拖动中 left ${stC.left} → ${mid.left}；松手后 ${stD.left}`);
    ok(Math.abs(mid.left - stC.left) > 5, '指针在画布外时仍在跟手（未中途断掉）');
    ok(Math.abs(stD.left - stC.left - moved / z5) < 2, `松手落定位移正确（Δ=${(stD.left - stC.left).toFixed(2)} ≈ ${(moved / z5).toFixed(2)}）`);

    // ══ 运行时错误 ═══════════════════════════════════════════════
    console.log('\n【⑥】运行时错误');
    ok(errs.length === 0, `无运行时错误（${errs.length}）`);
    errs.slice(0, 8).forEach((e) => info('! ' + e));
  } catch (e) {
    fails.push('probe 异常：' + (e as Error).message);
    console.error('PROBE ERROR:', (e as Error).stack || e);
  } finally {
    await browser.close();
    restore();
    console.log('\n产物已恢复');
  }

  console.log('\n' + '='.repeat(62));
  console.log(`M1 不变量：${pass} 通过 / ${fails.length} 失败`);
  if (fails.length) {
    fails.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('M1 INVARIANTS OK');
})();
