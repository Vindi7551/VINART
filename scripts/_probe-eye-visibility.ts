/**
 * 图层眼睛（可视性开关）端到端探针 —— 跑**真应用**：真会话 → 产物库 → 真 iframe。
 *
 * 覆盖：
 *   【1】清单 10 行、每行有眼睛、状态与真 iframe 同步
 *   【2】点眼睛 → iframe 里那层 `display:none`，其余层不动；**不顺带选中**该行
 *   【3】**不污染数据**（核心诉求）——藏完等过 1.5s 自动保存窗口，
 *        `design-sketch.json` / `design-appearance.json` / `final.png` 逐字节不变，
 *        且 spec 的图层里**没有**任何可视性字段
 *   【4】藏掉"当前选中层" → **自动取消选中**（面板退回清单、iframe 虚线框收掉）
 *   【5】Alt+点击 = **独奏**（只剩这一层可见），再 Alt 点一次**还原**
 *   【6】藏了东西才出现的「全部显示」按钮
 *   【7】iframe 重载后**自愈**（onLoad 重放整集，DOM 回来不再是全显示）
 *
 * 为什么必须真应用：`ve:set-hidden` 要跨 iframe 边界打到**服务端现场渲染**的
 * 真 HTML 上；`data-layer` 选择器、选中框、就地改字的收尾都只有真画布能验。
 *
 * ⚠️ 只读：不点 💾/⟳，不改任何 spec。唯一写入是应用自身的
 * `logSessionAction('open-layout')`（正常点开产物也会写，不进对话流）。
 *
 * 运行：npm run step scripts/_probe-eye-visibility.ts
 *      npm run step scripts/_probe-eye-visibility.ts -- <会话id> <版式名>
 */

import { chromium, type Frame } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SID = process.argv[2] ?? 'sess_1b6ec46c';
const LAYOUT = process.argv[3] ?? 'POSTER01';
const WORK = process.env.VINART_PROBE_WORKDIR ?? 'D:/workplace/test';
const OUT = resolve('.tmp-run');

let pass = 0;
const fails: string[] = [];
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fails.push(msg);
    console.log(`  ✗ ${msg}${extra ? ` —— ${extra}` : ''}`);
  }
}

const sha = (p: string) => {
  const f = resolve(p);
  return existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16) : '(缺失)';
};
const LAYOUT_DIR = `${WORK}/designs/${LAYOUT}`;
const TRACKED = [
  `${LAYOUT_DIR}/design-sketch.json`,
  `${LAYOUT_DIR}/design-appearance.json`,
  `${LAYOUT_DIR}/final.png`,
];

// ══════════════════════════════════════════════
// 浏览器
// ══════════════════════════════════════════════
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({
  viewport: { width: 1600, height: 980 },
  deviceScaleFactor: 2,
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text());
});

// 让应用启动就恢复目标会话（否则无会话 → 画廊不渲染）
await page.addInitScript((sid) => {
  localStorage.setItem('vinart.sessionId', sid);
}, SID);

/** 画布所在的 iframe（以 `data-ve-ready` 就绪标记为准，不靠下标猜） */
async function canvasFrame(): Promise<Frame> {
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const ready = await f.evaluate(() => document.documentElement.hasAttribute('data-ve-ready')).catch(() => false);
    if (ready) return f;
  }
  throw new Error('画布 iframe 未就绪（data-ve-ready 缺失）');
}

/** iframe 里当前「看得见」的图层 id */
const visibleIds = (frame: Frame) =>
  frame.evaluate(() =>
    [...document.querySelectorAll('[data-layer]')]
      .filter((el) => getComputedStyle(el as HTMLElement).display !== 'none')
      .map((el) => el.getAttribute('data-layer') as string),
  );

/** 清单里某图层那一行 */
const row = (id: string) =>
  page.locator('.ui-list-item').filter({ has: page.locator(`b:text-is("${id}")`) });

const eye = (id: string) => row(id).locator('.layer-eye');
const hiddenRowIds = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.ui-list-item.layer-hidden')].map(
      (el) => (el.querySelector('b') as HTMLElement).textContent as string,
    ),
  );
const clickEye = async (id: string, alt = false) => {
  await eye(id).click(alt ? { modifiers: ['Alt'] } : undefined);
  await page.waitForTimeout(180); // 等 postMessage 过界 + iframe 应用
};

// ══════════════════════════════════════════════
console.log(`\n【0】打开应用，恢复会话 ${SID}`);
await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 40000 });

// 应用启动自愈可能重写注册表——记录一下，只报告不断言
const REG = process.env.USERPROFILE + '/.vinart/workdirs.json';
const regBefore = sha(REG);

await page.waitForSelector('.artifact-card', { timeout: 20000 });
const cards = await page.locator('.artifact-card .artifact-name').allTextContents();
ok(cards.includes(LAYOUT), `产物库列出了「${LAYOUT}」`, `实得 ${cards.join(', ')}`);

console.log(`\n【1】点开 ${LAYOUT} → 检查器栏的图层清单`);
await page.locator('.artifact-card', { hasText: LAYOUT }).first().click();
await page.waitForSelector('.inspector-col .ui-list-item', { timeout: 20000 });
const before = TRACKED.map(sha);

const ids = await page.locator('.ui-list-item b').allTextContents();
ok(ids.length === 10, `清单 10 个图层`, `实得 ${ids.length}: ${ids.join(',')}`);
ok(
  ids.join(',') === 'bg,panel_dark,rule_side,title_cn,rule_title,title_en,slogan,release,credits,lead_portrait',
  '顺序与版式一致（自上而下 = 绘制顺序）',
  ids.join(','),
);

const eyeCount = await page.locator('.ui-list-item .layer-eye').count();
ok(eyeCount === ids.length, `每行都有眼睛（${eyeCount} 个）`);

const frame = await canvasFrame();
let vis = await visibleIds(frame);
ok(vis.length === 10, `iframe 里 10 层全可见`, vis.join(','));

// 眼睛图标两态形状不同（eye-off 多两笔 + 斜杠）
const pathCounts = await page.evaluate(() => {
  const on = document.querySelector('.ui-list-item .layer-eye svg') as SVGElement;
  return { on: on.querySelectorAll('path').length, onCircles: on.querySelectorAll('circle').length };
});
ok(pathCounts.on === 1 && pathCounts.onCircles === 1, '可见态用 eye 图标（1 path + 1 circle）', JSON.stringify(pathCounts));

// ══════════════════════════════════════════════
console.log('\n【2】点 bg 的眼睛 → 只藏它，且不顺带选中');
await clickEye('bg');
vis = await visibleIds(frame);
ok(!vis.includes('bg'), 'iframe 里 bg 已不可见');
ok(vis.length === 9, '其余 9 层不动', vis.join(','));
const bgDisplay = await frame.evaluate(
  () => getComputedStyle(document.querySelector('[data-layer="bg"]') as HTMLElement).display,
);
ok(bgDisplay === 'none', `bg 的 computed display = none（实得 ${bgDisplay}）`);
ok((await hiddenRowIds()).join(',') === 'bg', '清单里只有 bg 那行进入隐藏态');
ok((await page.locator('.ui-list-item.active').count()) === 0, '点眼睛**没有**顺带选中该图层');
const offPaths = await page.evaluate(
  () => (document.querySelector('.ui-list-item.layer-hidden .layer-eye svg') as SVGElement).querySelectorAll('path').length,
);
ok(offPaths === 4, '隐藏态换成 eye-off 图标（4 path）', String(offPaths));

await page.screenshot({ path: `${OUT}/eye-2-hide-bg.png` });

// ══════════════════════════════════════════════
console.log('\n【3】不污染数据（核心诉求）——等过 1.5s 自动保存窗口再比字节');
await page.waitForTimeout(2600);
{
  const after = TRACKED.map(sha);
  const names = ['design-sketch.json', 'design-appearance.json', 'final.png'];
  for (let i = 0; i < TRACKED.length; i++) {
    ok(before[i] === after[i], `${names[i]} 逐字节不变`, `${before[i]} → ${after[i]}`);
  }
  const spec = await (await fetch(`http://localhost:8787/api/layout/${LAYOUT}/data?session=${SID}`)).json() as {
    spec: { layers: Record<string, unknown>[] };
  };
  const keys = Object.keys(spec.spec.layers[0]);
  const polluted = keys.filter((k) => /hidden|visible|display/i.test(k));
  ok(polluted.length === 0, `spec 图层里没有任何可视性字段（实得键 ${keys.join(',')}）`, polluted.join(','));
}

// ══════════════════════════════════════════════
console.log('\n【4】藏掉"当前选中层" → 自动取消选中');
// 注意真路径：选中该层 → 面板整栏切到检查器（清单 DOM 消失，眼睛也就点不到了）
// → 点「« 图层清单」回到清单（选中仍在）→ 这时才点得到它的眼睛。
await row('title_cn').click();
await page.waitForTimeout(250);
ok(await page.locator('.ui-section-title', { hasText: '文字' }).count() > 0, '选中后面板切到检查器（出现「文字」小节）');
ok((await page.locator('.ui-list-item').count()) === 0, '检查器模式下清单整栏替换（所以眼睛只在清单里）');
{
  const outline = await frame.evaluate(
    () => (document.querySelector('[data-layer="title_cn"]') as HTMLElement).style.outline,
  );
  ok(outline.includes('solid'), `iframe 里 title_cn 已画上选中框（outline="${outline}"）`);
}

await page.locator('.ui-btn.ghost', { hasText: '图层清单' }).click();
await page.waitForTimeout(200);
ok((await page.locator('.ui-list-item.active b').textContent()) === 'title_cn', '回到清单，title_cn 那行仍是激活态');

await clickEye('title_cn');
ok((await page.locator('.ui-list-item.active').count()) === 0, '选中被自动取消（清单无激活行）');
{
  const outline = await frame.evaluate(
    () => (document.querySelector('[data-layer="title_cn"]') as HTMLElement).style.outline,
  );
  ok(outline === '', `iframe 里选中虚线框已收掉（style.outline="${outline}"）`);
  const ovDisplay = await frame.evaluate(() => {
    const ov = [...document.querySelectorAll('body > div')].find((d) =>
      (d as HTMLElement).style.zIndex === '2147483645',
    ) as HTMLElement | undefined;
    return ov ? ov.style.display : '(未找到 overlay)';
  });
  ok(ovDisplay === 'none', `选中框 overlay 已隐藏（display=${ovDisplay}）`);
}

// ══════════════════════════════════════════════
console.log('\n【5】Alt+点击 = 独奏');
await clickEye('title_cn', true); // bg 仍藏着 + 独奏 title_cn
vis = await visibleIds(frame);
ok(vis.length === 1 && vis[0] === 'title_cn', 'iframe 里只剩 title_cn 可见', vis.join(','));
ok((await hiddenRowIds()).length === 9, '清单 9 行进入隐藏态');
ok(
  (await page.locator('.ui-hint').first().textContent())?.includes('已隐藏 9') === true,
  '清单提示写着「已隐藏 9」',
);
await page.screenshot({ path: `${OUT}/eye-3-solo.png` });

await clickEye('title_cn', true); // 再独奏一次 = 还原
vis = await visibleIds(frame);
ok(vis.length === 10, '再 Alt 点一次 → 全部显示', vis.join(','));
ok((await hiddenRowIds()).length === 0, '清单无隐藏行');

// ══════════════════════════════════════════════
console.log('\n【6】藏了东西才出现的「全部显示」');
ok(await page.locator('button', { hasText: '全部显示' }).count() === 0, '全显示时不显示该按钮');
await clickEye('rule_side');
await clickEye('slogan');
const showAll = page.locator('button', { hasText: '全部显示' });
ok(await showAll.count() === 1, '藏了 2 层 → 出现「全部显示」');
await showAll.click();
await page.waitForTimeout(200);
vis = await visibleIds(frame);
ok(vis.length === 10 && (await hiddenRowIds()).length === 0, '一键还原：10 层全可见');
ok(await page.locator('button', { hasText: '全部显示' }).count() === 0, '还原后按钮消失');

// ══════════════════════════════════════════════
console.log('\n【7】iframe 重载后自愈（onLoad 重放整集）');
await clickEye('bg');
ok(!(await visibleIds(frame)).includes('bg'), '重载前 bg 已藏');
// 重新赋 srcdoc = 换一个文档（等价于换版式时 srcdoc 重建）
await page.evaluate(() => {
  const f = document.querySelector('.preview-frame') as HTMLIFrameElement;
  f.srcdoc = f.srcdoc;
});
await page.waitForTimeout(900);
const frame2 = await canvasFrame();
vis = await visibleIds(frame2);
ok(!vis.includes('bg'), '重载后 bg 仍是隐藏的（onLoad 重放生效，没被"全显示"回滚）', vis.join(','));
ok(vis.length === 9, '重载后其余 9 层可见', vis.join(','));

// ══════════════════════════════════════════════
console.log('\n【8】收尾：还原到全显示，再拍一张对照图');
await page.locator('button', { hasText: '全部显示' }).click();
await page.waitForTimeout(200);
ok((await visibleIds(frame2)).length === 10, '回到全显示（不把隐藏态留给你）');
await page.screenshot({ path: `${OUT}/eye-1-all-visible.png` });

// ══════════════════════════════════════════════
console.log('\n【9】重载后宿主→画布通道仍通（新文档还认 ve:select / ve:patch）');
const regAfter = sha(REG);
await row('slogan').click();
await page.waitForTimeout(250);
{
  const outline = await frame2.evaluate(
    () => (document.querySelector('[data-layer="slogan"]') as HTMLElement).style.outline,
  );
  ok(outline.includes('solid'), `重载后的文档仍收到 ve:select（outline="${outline}"）`);
  ok(await page.locator('.ui-section-title', { hasText: '文字' }).count() > 0, '面板切到 slogan 的检查器');
}

console.log(`\n(信息) 工作目录注册表 ${regBefore === regAfter ? '未被改动' : `被重写 ${regBefore} → ${regAfter}`}`);

console.log(`\n———— ${pass} 通过 / ${fails.length} 失败 ————`);
if (fails.length) for (const f of fails) console.log(`  ✗ ${f}`);

await browser.close();
if (fails.length) process.exit(1);
