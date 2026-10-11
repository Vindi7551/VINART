/**
 * 编辑器**行为契约**回归探针 —— M1（去注入 + 父侧覆盖层）的验收基线。
 *
 * 为什么要这一支：M1 的验收标准是「现有编辑功能一模一样」，但**没有基线就没法判定**。
 * 本探针只断言**用户可见的行为与产物数据**，不断言实现细节
 * （例如"覆盖层在父文档还是子文档"、"选中描边画在哪"）—— 所以它在 M1 前后都应全绿。
 *
 * 断言口径一律是**几何**：屏幕拖 N px ⇒ 子文档里该层位移 N/zoom px。
 * 只跑"函数被调到了"是没用的：元素飘到屏幕另一端，拖拽也"成功"。
 *
 * ⚠️ 本探针会驱动真实 app，**会触发 1.5s 防抖自动保存**，从而改写
 *    `<workDir>/designs/<name>/design-sketch.json`。所以先备份、finally 里恢复。
 *
 * 运行：npm run step scripts/_probe-editor-behaviour.ts
 * 前置：`npm run dev` 起着（vite 会自带把 8787 也拉起来）。
 */

import { chromium, type Page } from 'playwright';
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

declare global {
  // 浏览器内注入的探针工具集（见 HELPERS）
  interface Window { __vt: any }
}

const PORT = process.env.VINART_PORT || '5173';
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
const GUARDED = ['design-sketch.json', 'design-appearance.json'].map((f) => join(DESIGN_DIR, f));
const backups = new Map<string, string>();

function backup() {
  for (const f of GUARDED) {
    if (!existsSync(f)) continue;
    const b = `${f}.probe-backup`;
    copyFileSync(f, b);
    backups.set(f, b);
  }
}
function restore() {
  for (const [f, b] of backups) {
    if (existsSync(b)) { copyFileSync(b, f); }
  }
  for (const [, b] of backups) { try { unlinkSync(b); } catch { /* ignore */ } }
}

// ── 浏览器内工具（同时兼容"覆盖层在子文档"与"在父文档"两代实现）──────
const HELPERS = `
window.__vt = {
  frame() { return document.querySelector('.preview-frame'); },
  wrap() { return document.querySelector('.canvas-wrapper'); },
  zoom() { const f = this.frame(), w = this.wrap(); return f && w ? w.getBoundingClientRect().width / f.clientWidth : 1; },
  child() { const f = this.frame(); try { return f && f.contentDocument; } catch (e) { return null; } },
  layer(id) { const d = this.child(); return d && d.querySelector('[data-layer="' + id + '"]'); },
  /** 子文档 local px → 页面 px */
  toPage(lx, ly) { const w = this.wrap().getBoundingClientRect(), z = this.zoom(); return { x: w.x + lx * z, y: w.y + ly * z }; },
  layerBox(id) { const el = this.layer(id); if (!el) return null; const r = el.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height }; },
  style(id) { const el = this.layer(id); if (!el) return null; return {
    left: parseFloat(el.style.left), top: parseFloat(el.style.top),
    w: parseFloat(el.style.width), h: parseFloat(el.style.height),
    transform: el.style.transform || '', display: getComputedStyle(el).display }; },
  text(id) { const el = this.layer(id); if (!el) return null; const f = el.querySelector('.btfit'); return f ? f.textContent : el.textContent; },
  /** 装饰件中心（父文档优先，回退子文档）—— 两代实现都能找到。
   *  ⚠️ 若 rect 退化（display:none 或已被移到画布外），**返回 null**——
   *  否则会照着一个假坐标去拖，"什么都没发生"却看起来像"拖成功"。*/
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
  /** 选中框（overlay）的可见性 —— 父子两代实现都能用；Escape 后应不可见 */
  selBox() {
    const pick = (root) => (root ? root.querySelector('[data-ve-handle="se"]') : null);
    let h = pick(document), where = 'parent';
    if (!h) { h = pick(this.child()); where = 'child'; }
    if (!h) return null;
    const ov = h.parentElement, r = ov.getBoundingClientRect();
    return { where, display: getComputedStyle(ov).display, w: r.width, h: r.height };
  },
  /** 宿主侧"当前选中的图层 id"——从版式编辑面板头部读，与实现无关 */
  selectedId() {
    const root = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^版式编辑$/.test((e.textContent || '').trim()));
    const panel = root && root.closest('.ui-panel, section, div');
    if (!panel) return null;
    const b = panel.querySelector('b');
    return b ? b.textContent.trim() : null;
  },
  /** 按 Field 标签找 input */
  inputByLabel(label) {
    const root = document.querySelector('.inspector-col') || document;
    for (const n of root.querySelectorAll('*')) {
      if (n.children.length === 0 && (n.textContent || '').trim() === label) {
        let p = n.parentElement;
        for (let i = 0; i < 4 && p; i++) { const inp = p.querySelector('input'); if (inp) return inp; p = p.parentElement; }
      }
    }
    return null;
  },
  /** React 受控 input：必须走原生 setter + input 事件 */
  setInput(inp, v) {
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(inp, v);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  },
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

  const opened = await page.evaluate((name) => {
    const nodes = [...document.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && (e.textContent || '').trim() === name);
    if (!nodes[0]) return false;
    ((nodes[0].closest('button,a,li,div[role],div') || nodes[0]) as HTMLElement).click();
    return true;
  }, DESIGN);
  await page.waitForTimeout(3500);
  return { errs, opened };
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
    const { errs, opened } = await setup(page);
    ok(opened, `画廊里找到并打开 ${DESIGN}`);

    const st = await page.evaluate(() => {
      const d = window.__vt.child();
      const f = window.__vt.frame();
      return {
        hasFrame: !!f,
        zoom: window.__vt.zoom(),
        layers: d ? [...d.querySelectorAll('[data-layer]')].map((e) => e.getAttribute('data-layer')) : [],
        childScripts: d ? d.querySelectorAll('script').length : -1,
      };
    });
    info(`zoom = ${st.zoom.toFixed(4)}；子文档 <script> = ${st.childScripts}；图层 ${st.layers.length} 个`);
    ok(st.hasFrame, '画布 iframe 存在');
    ok(st.layers.length > 0, `可编辑图层存在（${st.layers.length} 个）`);
    if (!st.layers.length) throw new Error('没有图层，后续无法断言');

    const ID = st.layers.includes('title_cn') ? 'title_cn' : st.layers[0];
    const zoom = st.zoom;

    // ── 1) 图上点选 ──
    console.log('\n【1】图上点选');
    let box = await page.evaluate((id) => { const b = window.__vt.layerBox(id); return b ? window.__vt.toPage(b.cx, b.cy) : null; }, ID);
    await page.mouse.click(box!.x, box!.y);
    await page.waitForTimeout(250);
    const sel = await page.evaluate(() => window.__vt.selectedId());
    info(`点 ${ID} 后，面板显示的选中层 = ${sel}`);
    ok(sel === ID, `图上点选生效（面板切到 ${ID}）`);

    // ── 2) 拖拽位移 ──
    // ⚠️ 必须**向左**拖：向右会把层的右下角推出画布（1440 宽），
    //    后续 se 柄就落到 iframe 之外、够不着了（曾因此误判"缩放坏了"）。
    console.log('\n【2】拖拽移动（口径：屏幕 Δ ⇒ 子文档 Δ/zoom）');
    const s0 = await page.evaluate((id) => window.__vt.style(id), ID);
    const N = 40;
    box = await page.evaluate((id) => { const b = window.__vt.layerBox(id); return window.__vt.toPage(b.cx, b.cy); }, ID);
    await page.mouse.move(box!.x, box!.y);
    await page.mouse.down();
    await page.mouse.move(box!.x - N, box!.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const s1 = await page.evaluate((id) => window.__vt.style(id), ID);
    const dMove = +(s1.left - s0.left).toFixed(1);
    const expMove = +(-N / zoom).toFixed(1);
    info(`${ID}.left ${s0.left} → ${s1.left}（Δ=${dMove}，理论 ${expMove} = -${N}px / ${zoom.toFixed(3)}）`);
    ok(Math.abs(dMove - expMove) < 4, `拖拽位移正确（Δ=${dMove} ≈ ${expMove}）`);

    // ── 3) 四角缩放（se 柄，只吃 Δx）──
    console.log('\n【3】缩放（se 柄）');
    const deco = await page.evaluate(() => {
      const d = window.__vt.deco('[data-ve-handle="se"]');
      if (!d) return null;
      const w = window.__vt.wrap().getBoundingClientRect();
      // 柄必须落在画布可见区域内，否则鼠标点到 iframe 外面，拖拽会静默失效
      d.inside = d.x >= w.x && d.x <= w.x + w.width && d.y >= w.y && d.y <= w.y + w.height;
      d.wrapRight = +(w.x + w.width).toFixed(1);
      return d;
    });
    ok(!!deco, `找到 se 缩放柄（在 ${deco?.where}）`);
    ok(!!deco && (deco as any).inside, `se 柄在画布可见区内（x=${deco ? (deco as any).x.toFixed(1) : '-'} ≤ 右缘 ${deco ? (deco as any).wrapRight : '-'}）`);
    if (deco) {
      const before = await page.evaluate((id) => window.__vt.style(id), ID);
      const DX = 40;
      await page.mouse.move(deco.x, deco.y);
      await page.mouse.down();
      await page.mouse.move(deco.x + DX, deco.y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(250);
      const after = await page.evaluate((id) => window.__vt.style(id), ID);
      const dW = +(after.w - before.w).toFixed(1);
      const expW = +(DX / zoom).toFixed(1);
      info(`${ID}.width ${before.w} → ${after.w}（Δ=${dW}，理论 ${expW}）`);
      ok(Math.abs(dW - expW) < 4, `缩放宽度正确（Δ=${dW} ≈ ${expW}）`);
    }

    // ── 4) 旋转 ──
    console.log('\n【4】旋转（顶部旋转柄）');
    const rot = await page.evaluate(() => window.__vt.deco('[data-ve-rot]'));
    ok(!!rot, `找到旋转柄（在 ${rot?.where}）`);
    if (rot) {
      const before = await page.evaluate((id) => window.__vt.style(id), ID);
      await page.mouse.move(rot.x, rot.y);
      await page.mouse.down();
      await page.mouse.move(rot.x + 60, rot.y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(250);
      const after = await page.evaluate((id) => window.__vt.style(id), ID);
      const m = /rotate\((-?[\d.]+)deg\)/.exec(after.transform || '');
      const deg = m ? parseFloat(m[1]) : 0;
      info(`transform ${before.transform || '(空)'} → ${after.transform || '(空)'}`);
      ok(Math.abs(deg) > 1, `旋转生效（角度 ${deg}°）`);
    }

    // ── 5) 面板 patch（x 输入框）──
    console.log('\n【5】参数面板改属性');
    const hasX = await page.evaluate(() => !!window.__vt.inputByLabel('x'));
    ok(hasX, '检查器里找到 x 输入框');
    if (hasX) {
      const before = await page.evaluate((id) => window.__vt.style(id), ID);
      await page.evaluate(() => {
        const inp = window.__vt.inputByLabel('x');
        window.__vt.setInput(inp, '0.5');   // 0–1 比例
      });
      await page.waitForTimeout(300);
      const after = await page.evaluate((id) => window.__vt.style(id), ID);
      info(`${ID}.left ${before.left} → ${after.left}（面板设 x=0.5）`);
      ok(Math.abs(after.left - 0.5 * 1440) < 2, `面板 patch 落到画布（left ≈ ${0.5 * 1440}）`);
    }

    // ── 6) 隐藏图层（右侧图层清单的眼睛）──
    // 选中后右栏是「检查器态」，清单被替换 → 先点回「图层清单」，再点该行眼睛。
    console.log('\n【6】图层可视性');
    await page.evaluate(() => {
      const back = [...document.querySelectorAll('button')]
        .find((b) => (b.textContent || '').includes('图层清单'));
      if (back) back.click();
    });
    await page.waitForTimeout(350);
    const clickEye = (id: string) => page.evaluate((lid) => {
      const btn = [...document.querySelectorAll('.layer-eye')].find((b) => {
        const nm = b.closest('li,div')?.querySelector('.layer-name b');
        return nm && nm.textContent.trim() === lid;
      });
      if (!btn) return false;
      (btn as HTMLElement).click(); return true;
    }, id);
    const eye = await clickEye(ID);
    ok(!!eye, `找到 ${ID} 的眼睛按钮（右栏图层清单）`);
    if (eye) {
      await page.waitForTimeout(350);
      const disp = await page.evaluate((id) => window.__vt.style(id).display, ID);
      info(`隐藏后 ${ID} 的 computed display = ${disp}`);
      ok(disp === 'none', `隐藏生效（display: none）`);
      await clickEye(ID);                 // 还原，免得影响后续步骤
      await page.waitForTimeout(350);
      const disp2 = await page.evaluate((id) => window.__vt.style(id).display, ID);
      ok(disp2 !== 'none', `再点眼睛还原显示（display: ${disp2}）`);
    }

    // ── 7) 就地改字 ──
    console.log('\n【7】就地改字（双击）');
    const textLayer = st.layers.includes('slogan') ? 'slogan' : ID;
    const tb = await page.evaluate((id) => {
      const b = window.__vt.layerBox(id);
      if (!b) return null;
      const w = window.__vt.wrap().getBoundingClientRect();
      const p = window.__vt.toPage(b.cx, b.cy);
      p.inside = p.x >= w.x && p.x <= w.x + w.width && p.y >= w.y && p.y <= w.y + w.height;
      return p;
    }, textLayer);
    ok(!!tb && (tb as any).inside, `${textLayer} 中心在画布可见区内`);
    const tbox = tb;
    const beforeText = await page.evaluate((id) => window.__vt.text(id), textLayer);
    if (!tbox || !(tbox as any).inside) throw new Error(`${textLayer} 不在画布内，就地改字无法测`);
    await page.mouse.dblclick(tbox.x, tbox.y);
    await page.waitForTimeout(300);
    await page.keyboard.type('ZZZ');
    await page.waitForTimeout(150);
    await page.mouse.click(20, 20);          // 点空白处失焦 → 落定
    await page.waitForTimeout(400);
    const afterText = await page.evaluate((id) => window.__vt.text(id), textLayer);
    info(`${textLayer} 文字: ${JSON.stringify((beforeText || '').slice(0, 24))} → ${JSON.stringify((afterText || '').slice(0, 24))}`);
    ok((afterText || '').includes('ZZZ') && afterText !== beforeText, `就地改字落定（含 ZZZ）`);

    // ── 8) Escape 取消选中 ──
    // 口径 = **选中框消失**，不读宿主面板：当前实现的 `deselect()` 只清画布、
    // 不发宿主消息，面板会保持原样（这是既有行为，不是回归）。
    console.log('\n【8】Escape 取消选中');
    box = await page.evaluate((id) => { const b = window.__vt.layerBox(id); return window.__vt.toPage(b.cx, b.cy); }, ID);
    await page.mouse.click(box!.x, box!.y);
    await page.waitForTimeout(200);
    const boxBefore = await page.evaluate(() => window.__vt.selBox());
    info(`Escape 前选中框 = ${JSON.stringify(boxBefore)}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const boxAfter = await page.evaluate(() => window.__vt.selBox());
    info(`Escape 后选中框 = ${JSON.stringify(boxAfter)}`);
    ok(!!boxBefore && boxBefore.display === 'block' && boxBefore.w > 1, '选中框可见');
    ok(!!boxAfter && (boxAfter.display === 'none' || boxAfter.w < 1), `Escape 取消选中（选中框消失）`);

    // ── 9) 无运行时错误 ──
    console.log('\n【9】运行时错误');
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
  console.log(`行为契约：${pass} 通过 / ${fails.length} 失败`);
  if (fails.length) {
    fails.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('EDITOR BEHAVIOUR OK');
})();
