/**
 * 前端冒烟：一级分组 + 未选目录禁聊 + 📂 锁定。
 *
 * 断言的是**几何与 DOM 事实**，不是"看起来对"——历史教训：元素飘到屏幕另一端
 * 也照样"拖成功"（见 MEMORY.md 的 UI 冒烟铁律）。
 * 用法：npm run step scripts/_probe-ui-workdir.ts
 */
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE ?? 'http://localhost:5173';
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
let checks = 0;
function ok(cond: unknown, msg: string): void {
  checks++;
  if (!cond) throw new Error(`断言失败 → ${msg}`);
  console.log('  ✓', msg);
}

try {
  try {
    browser = await chromium.launch({ channel: 'chromium' });
  } catch {
    browser = await chromium.launch(); // headless_shell 缺失时的回退
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // 无会话态：清掉存档与待用环境（惰性会话 + 环境缓存都在 localStorage）
  await page.evaluate(() => {
    localStorage.removeItem('vinart.sessionId');
    localStorage.removeItem('vinart.pendingEnv');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  console.log('【1】未选目录 → 不允许开聊');
  const ta = page.locator('.input-row textarea');
  ok(await ta.isDisabled(), '输入框 disabled');
  const ph = (await ta.getAttribute('placeholder')) ?? '';
  ok(/工作目录/.test(ph) && /不允许/.test(ph), `placeholder 明确说明原因 → ${ph}`);
  const sendBtn = page.locator('.input-toolbar .composer-send');
  ok(await sendBtn.isDisabled(), '发送按钮 disabled');
  const emptyText = (await page.locator('.chat-empty').innerText()).trim();
  ok(/工作目录/.test(emptyText), `空态文案引导选目录 → ${emptyText}`);

  console.log('【1b】输入区改版：单卡片 + 工具条（上传/目录/发送），Agent 药丸已删');
  ok((await page.locator('.composer').count()) === 1, '输入区是单个 .composer 卡片');
  ok((await page.locator('.agent-select').count()) === 0, 'Agent 药丸已删除（它本来就没绑任何行为）');
  ok((await page.locator('.input-toolbar .composer-tool').count()) === 1, '工具条有上传按钮');
  ok((await page.locator('.input-toolbar .workdir-bar').count()) === 1, '工作目录控件已下移进工具条');
  ok((await page.locator('.input-toolbar .composer-send').count()) === 1, '发送按钮在工具条内');

  console.log('【2】📂 未被锁定（无会话时可自由选目录）');
  const folder = page.locator('.workdir-bar button').first();
  ok(await folder.isEnabled(), '📂 可点（无会话）');

  console.log('【3】项目层 UI 已消失');
  ok((await page.locator('.project-bar').count()) === 0, '页面里没有 .project-bar');
  ok((await page.locator('.project-bar select').count()) === 0, '没有项目下拉');
  ok(!/项目:/.test(await page.locator('.workdir-bar').innerText()), '工作目录条里没有「项目:」字样');

  console.log('【4】📂 的几何位置（贴右栏，不许飘到屏幕另一端）');
  const box = await folder.boundingBox();
  const rightColBox = await page.locator('.right-col').boundingBox();
  ok(!!box && !!rightColBox, '取到 📂 与右栏的 boundingBox');
  ok(
    box!.x >= rightColBox!.x - 1 && box!.x < rightColBox!.x + rightColBox!.width,
    `📂 x=${Math.round(box!.x)} 落在右栏 [${Math.round(rightColBox!.x)}, ${Math.round(rightColBox!.x + rightColBox!.width)}] 内`,
  );

  console.log('【5】手输目录 → 门禁解除');
  await page.locator('.workdir-bar a', { hasText: '手输' }).click();
  const dirInput = page.locator('.workdir-bar input');
  await dirInput.fill('D:/desktop/vinart/test_product');
  await dirInput.press('Enter');
  await page.waitForTimeout(400);
  const barText = (await page.locator('.workdir-bar').innerText()).trim();
  ok(/test_product/.test(barText), `目录条已显示所选目录 → ${barText}`);
  ok(!(await ta.isDisabled()), '输入框解禁');
  const ph2 = (await ta.getAttribute('placeholder')) ?? '';
  ok(/Ctrl\+V/.test(ph2), `placeholder 恢复为正常引导 → ${ph2}`);
  await ta.fill('随便一句话');
  await page.waitForTimeout(200);
  ok(await sendBtn.isEnabled(), '有内容后发送按钮可点');

  console.log('【5b】工具条不溢出：发送键必须留在卡片内（窄右栏也不许被挤出去）');
  const composerBox = await page.locator('.composer').boundingBox();
  const sendBox = await page.locator('.composer-send').boundingBox();
  ok(!!composerBox && !!sendBox, '取到卡片与发送键的 boundingBox');
  ok(
    sendBox!.x + sendBox!.width <= composerBox!.x + composerBox!.width + 1,
    `发送键右缘 ${Math.round(sendBox!.x + sendBox!.width)} ≤ 卡片右缘 ${Math.round(composerBox!.x + composerBox!.width)}`,
  );
  const tb = await page.locator('.input-toolbar').evaluate((el) => ({
    sw: el.scrollWidth,
    cw: el.clientWidth,
  }));
  ok(tb.sw <= tb.cw + 1, `工具条无横向溢出（scrollWidth ${tb.sw} ≤ clientWidth ${tb.cw}）`);

  await ta.fill('');

  console.log('【6】侧栏按工作目录一级分组（组名 = 目录末段）');
  const heads = await page.locator('.session-group-head.dir .group-label').allInnerTexts();
  ok(heads.length > 0, `侧栏有分组组头：${heads.join(' / ')}`);
  ok(
    heads.every((h) => !h.includes('\\') && !h.includes('/')),
    '组头只显示目录末段（不含路径分隔符）',
  );
  ok(
    new Set(heads).size === heads.length,
    `组头不重名（正反斜杠/大小写不同的同一目录必须合成一组）→ ${new Set(heads).size}/${heads.length}`,
  );
  ok(
    (await page.locator('.session-group-head.proj').count()) === 0,
    '没有第二层（项目）组头',
  );
  ok(
    (await page.locator('.session-group-head.dir .group-new').count()) > 0,
    '目录组头有 ✎（在此目录下新建对话）',
  );

  console.log('【7】选目录即登记：不用发一句话就能看见那个目录里已有的会话');
  await page.evaluate(() => {
    localStorage.removeItem('vinart.sessionId');
    localStorage.removeItem('vinart.pendingEnv');
    localStorage.removeItem('vinart.recentWorkDirs');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  // 挑一个浏览器从没碰过的目录（正斜杠写法，顺带验证归一）
  await page.locator('.workdir-bar a', { hasText: '手输' }).click();
  await page.locator('.workdir-bar input').fill('D:/workplace/test');
  await page.locator('.workdir-bar input').press('Enter');
  await page.waitForTimeout(1500);

  // 期望值直接从 API 取（不写死条数，数据变了探针也不会假装通过）
  const expected = await page.evaluate(async () => {
    const list = (await (await fetch('/api/sessions')).json()) as Array<{ home?: string }>;
    return list.filter((s) => (s.home ?? '').replace(/\\/g, '/').toLowerCase().endsWith('/workplace/test'));
  });
  const labels2 = await page.locator('.session-group-head.dir .group-label').allInnerTexts();
  const idx = labels2.indexOf('test');
  ok(idx >= 0, `侧栏出现了 test 组 → ${labels2.join(' / ')}`);
  ok(
    labels2.filter((l) => l === 'test').length === 1,
    '正斜杠写法没有长出第二个同名组（分组键已归一）',
  );
  const items = await page.locator('.session-group').nth(idx).locator('.session-item').count();
  ok(
    expected.length > 0 && items === expected.length,
    `该目录里已有的 ${expected.length} 条会话**未发任何消息**就出现在侧栏（实际 ${items} 条）`,
  );

  console.log(`\n全部 ${checks} 条断言通过。`);
} finally {
  if (browser) await browser.close();
}
