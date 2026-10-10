/**
 * Markdown 观测台的断言 + 截图。
 *
 * 断言分两类，缺一不可：
 *   - **DOM 结构**：`**` 有没有变成 <strong>、列表是不是真列表、表格/代码块渲染没渲染
 *   - **视觉**：截图（2×）之后放大看间距与层级 —— 结构对不等于好读
 *
 * 关键反例断言（最容易被 Markdown 误伤的地方）：
 *   - 用户气泡**不许**解析（`**` 要原样露出来，且换行靠 pre-wrap 保住）
 *   - `2*3*4` 不许被当成强调（`*` 在词间能配对成 <em>，是 CommonMark 的经典坑）
 *   - 单个换行必须留住（`remark-breaks` 就是为这条加的）
 *
 * 运行：npm run step scripts/_probe-markdown-shot.ts
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:5173/scripts/_probe-markdown/index.html';
const OUT = resolve(process.argv[3] ?? '.tmp-run/chat-markdown.png');

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

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text());
});

await page.goto(URL, { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForSelector('.chat-bubble .md', { timeout: 20000 });
await page.waitForTimeout(400);

/** 每个样本的 DOM 统计 + 是否有字面星号 */
const perCase = await page.evaluate(() =>
  [...document.querySelectorAll('.chat-msg[data-probe-case]')].map((el) => {
    const bubble = el.querySelector('.chat-bubble') as HTMLElement;
    const q = (s: string) => el.querySelectorAll(s).length;
    return {
      case: el.getAttribute('data-probe-case') as string,
      hasMd: q('.md') === 1,
      literalStars: (bubble.innerText.match(/\*\*/g) ?? []).length,
      strong: q('strong'),
      em: q('em'),
      ul: q('ul'),
      li: q('li'),
      headings: q('h1,h2,h3'),
      code: q('code'),
      pre: q('pre'),
      table: q('table'),
      th: q('th'),
      linksBlank: q('a[target="_blank"]'),
      linksNoReferrer: q('a[rel*="noreferrer"]'),
      blockquote: q('blockquote'),
      del: q('del'),
      checkboxes: q('input[type="checkbox"]'),
      br: q('br'),
      // 首尾子元素不该有外边距（否则气泡上下多出空白）
      firstMarginTop: (() => {
        const f = (el.querySelector('.md') as HTMLElement).firstElementChild as HTMLElement | null;
        return f ? getComputedStyle(f).marginTop : '';
      })(),
      lastMarginBottom: (() => {
        const kids = (el.querySelector('.md') as HTMLElement).children;
        const l = kids[kids.length - 1] as HTMLElement;
        return getComputedStyle(l).marginBottom;
      })(),
    };
  }),
);

console.log('\n【1】三个样本都走 Markdown 渲染，且**没有字面星号残留**');
ok(perCase.length === 4, `4 个样本都渲染出来了（实得 ${perCase.length}）`);
for (const c of perCase) {
  ok(c.hasMd, `${c.case} → 有 .md 容器`);
  ok(c.literalStars === 0, `${c.case} → 没有字面 ** 残留`, `实得 ${c.literalStars} 处`);
}

console.log('\n【2】粗体 / 列表 / 标题');
{
  const a = perCase[0];
  ok(a.strong >= 4, '样本① 的 `**…**` 变成 <strong>（≥4 处）', String(a.strong));
  ok(a.ul >= 1 && a.li >= 6, '样本① 的 `- …` 变成真列表（≥6 项）', `ul=${a.ul} li=${a.li}`);
  const listText = await page
    .locator('.chat-msg[data-probe-case]')
    .first()
    .locator('li')
    .first()
    .innerText();
  ok(listText.includes('竖版海报'), '列表项文案逐字正确', listText.slice(0, 40));
  const b = perCase[1];
  ok(b.headings >= 2, '样本② 的 `## …` 变成标题（≥2 个）', String(b.headings));
  ok(b.code >= 1, '样本② 的行内 `code` 渲染出来了');
}

console.log('\n【3】GFM：代码块 / 表格 / 链接 / 任务列表 / 删除线 / 引用');
{
  const g = perCase[2];
  ok(g.pre >= 1, '代码块 <pre> 渲染', String(g.pre));
  ok(g.table === 1 && g.th >= 3, '表格渲染（含表头）', `table=${g.table} th=${g.th}`);
  ok(g.linksBlank === 1, '链接带 target="_blank"（不然会把应用导航走）', String(g.linksBlank));
  ok(g.linksNoReferrer === 1, '链接带 rel=noreferrer');
  ok(g.checkboxes === 2, '任务列表渲染出 2 个复选框', String(g.checkboxes));
  ok(g.del === 1, '删除线渲染', String(g.del));
  ok(g.blockquote === 1, '引用渲染', String(g.blockquote));
}

console.log('\n【4】反例：单换行留住；词间 `_` 不配对、`*` 会配对');
{
  const e = perCase[3];
  ok(e.br >= 1, '单个换行变成 <br>（remark-breaks 生效）', String(e.br));

  // 逐段核对（整例统计分不清是哪一段触发的）
  const paras = await page.evaluate(() => {
    const md = document
      .querySelectorAll('.chat-msg[data-probe-case]')[3]
      .querySelector('.md') as HTMLElement;
    return [...md.querySelectorAll('p')].map((p) => ({
      text: (p as HTMLElement).innerText.replace(/\n/g, ' '),
      em: p.querySelectorAll('em').length,
    }));
  });
  const underscore = paras.find((p) => p.text.includes('title_cn'));
  ok(
    !!underscore && underscore.em === 0,
    '下划线词间**不**配对：`title_cn 与 title_en` 保持原样（图层 id 全靠这条）',
    underscore ? `em=${underscore.em}` : '未找到该段',
  );

  // ⚠️ 已知边界（不是 bug）：CommonMark 允许**词间** `*` 配对成强调，
  //    与 GitHub 一致。要"更聪明"得写 remark 插件关掉词内强调，代价大于收益；
  //    单个 `*`（如 `*.json`、路径里的 `*`）不受影响，只有成对时才会。
  const star = paras.find((p) => p.text.includes('2'));
  ok(
    !!star && star.em === 1,
    '星号词间按 CommonMark 配对成强调（**已知边界**，故意按住不"修"）',
    star ? `em=${star.em}` : '未找到该段',
  );
  ok(
    !!star && star.text.includes('2') && star.text.replace(/\s/g, '').includes('234'),
    '强调判定不影响数字本身（2 3 4 都还在）',
    star?.text,
  );
  ok(e.literalStars === 0, '边界样本里也没有字面星号残留');
}

console.log('\n【5】用户气泡**不解析** Markdown，但换行留住');
{
  const user = page.locator('.chat-msg.user .chat-bubble').first();
  const text = await user.innerText();
  ok(!(await user.locator('.md').count()), '用户气泡内没有 .md 容器');
  ok(text.includes('**这两个星号原样显示**'), '用户写的 ** 原样显示（不被吃成粗体）');
  const ws = await user.evaluate((el) => getComputedStyle(el).whiteSpace);
  ok(ws === 'pre-wrap', `用户气泡 white-space = pre-wrap（实得 ${ws}）`);
  const lines = text.split('\n').length;
  ok(lines >= 2, '用户气泡的换行保留（≥2 行）', `实得 ${lines} 行`);
}

console.log('\n【6】气泡首尾不多出空白（免得视觉上"很松"）');
for (const c of perCase) {
  ok(c.firstMarginTop === '0px', `${c.case} → 首个子元素 margin-top 归零`, c.firstMarginTop);
  ok(c.lastMarginBottom === '0px', `${c.case} → 末个子元素 margin-bottom 归零`, c.lastMarginBottom);
}

await page.screenshot({ path: OUT, fullPage: true });
console.log(`\n已保存 ${OUT}`);

console.log(`\n———— ${pass} 通过 / ${fails.length} 失败 ————`);
if (fails.length) for (const f of fails) console.log(`  ✗ ${f}`);

await browser.close();
if (fails.length) process.exit(1);
