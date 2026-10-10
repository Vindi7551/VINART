/**
 * 对话气泡 Markdown 的端到端探针 —— 跑**真应用 + 真会话**（不造数据）。
 *
 * 为什么必须真应用：样式作用域是 `.chat-bubble .md`，而"哪条消息走 MD"这个判断
 * 在 `ConversationPanel` 里（`role === 'assistant' && kind !== 'log'`）。
 * 组件单测（`_probe-markdown-shot.ts`）验的是渲染本身，这里验的是**接线**：
 * 助手消息真的被解析了、日志/用户气泡真没被碰。
 *
 * 运行：npm run step scripts/_probe-chat-markdown-live.ts
 *      npm run step scripts/_probe-chat-markdown-live.ts -- <会话id>
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const SID = process.argv[2] ?? 'sess_1b6ec46c';
const OUT = resolve('.tmp-run/chat-markdown-live.png');

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
const page = await browser.newPage({ viewport: { width: 1600, height: 980 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text());
});
await page.addInitScript((sid) => localStorage.setItem('vinart.sessionId', sid), SID);

console.log(`\n【0】打开应用，恢复会话 ${SID}`);
await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForSelector('.chat-msg', { timeout: 25000 });
await page.waitForTimeout(500);

const stat = await page.evaluate(() => {
  const q = <T extends Element>(root: ParentNode, s: string) => [...root.querySelectorAll<T>(s)];
  // ⚠️ 日志消息的 class 是 **`chat-msg assistant log`**（role 仍是 assistant）——
  //    所以助手选择器必须显式排除 `.log`，否则 28 条日志会被算成"该有 .md 却没用 MD"。
  const CHAT = '.chat-msg.assistant:not(.log) .chat-bubble';
  const assistant = q<HTMLElement>(document, CHAT);
  const log = q<HTMLElement>(document, '.chat-msg.log .chat-bubble');
  const user = q<HTMLElement>(document, '.chat-msg.user .chat-bubble');
  return {
    total: q(document, '.chat-msg').length,
    assistant: assistant.length,
    log: log.length,
    user: user.length,
    assistantWithMd: assistant.filter((b) => b.querySelector('.md')).length,
    // 日志/用户气泡里出现 .md 就是接线错了
    logWithMd: log.filter((b) => b.querySelector('.md')).length,
    userWithMd: user.filter((b) => b.querySelector('.md')).length,
    assistantLiteralStars: assistant.filter((b) => /\*\*/.test(b.innerText)).length,
    logLiteralStars: log.filter((b) => /\*\*/.test(b.innerText)).length,
    strong: q(document, `${CHAT} .md strong`).length,
    li: q(document, `${CHAT} .md li`).length,
    headings: q(document, `${CHAT} .md h1, ${CHAT} .md h2, ${CHAT} .md h3`).length,
    inlineCode: q(document, `${CHAT} .md code`).length,
  };
});

console.log('\n【1】接线：助手解析、日志与用户不解析');
ok(stat.total > 0, `消息流渲染出来了（共 ${stat.total} 条）`);
ok(stat.assistant > 0, `普通助手气泡 ${stat.assistant} 个（另有 ${stat.log} 个日志气泡）`);
ok(stat.assistantWithMd === stat.assistant, '每个普通助手气泡里都有 .md 容器', `${stat.assistantWithMd}/${stat.assistant}`);
ok(stat.logWithMd === 0, `日志气泡里没有 .md（共 ${stat.log} 个）`, String(stat.logWithMd));
ok(stat.userWithMd === 0, `用户气泡里没有 .md（共 ${stat.user} 个）`, String(stat.userWithMd));

console.log('\n【2】普通助手消息里的字面星号已清零（这正是你截图里的问题）');
ok(stat.assistantLiteralStars === 0, '没有一个普通助手气泡还露着 **', `实得 ${stat.assistantLiteralStars} 个`);
ok(stat.strong >= 20, `真粗体渲染出来了（≥20 处，实得 ${stat.strong}）`);
ok(stat.li >= 10, `真列表项渲染出来了（≥10 项，实得 ${stat.li}）`);
ok(stat.headings >= 1, `## 标题渲染出来了（实得 ${stat.headings}）`);
ok(stat.inlineCode >= 1, `行内代码渲染出来了（实得 ${stat.inlineCode}）`);

console.log('\n【3】日志气泡保持字面（终端式输出不该被当散文解析）');
if (stat.log > 0) {
  const ws = await page.locator('.chat-msg.log .chat-bubble').first().evaluate((el) => getComputedStyle(el).whiteSpace);
  ok(ws === 'pre-wrap', `日志气泡仍是 pre-wrap 终端式（实得 ${ws}）`);
  // 日志里出现 ** 是**正常的**（工具输出原文），它就该原样显示
  console.log(`  (信息) 含字面 ** 的日志气泡：${stat.logLiteralStars} 个 —— 属预期，日志不解析`);
} else {
  console.log('  (跳过) 该会话没有日志气泡');
}
{
  const ws = await page.locator('.chat-msg.user .chat-bubble').first().evaluate((el) => getComputedStyle(el).whiteSpace);
  ok(ws === 'pre-wrap', `用户气泡换行保住（white-space=${ws}）`);
}

// 抽一条真实助手消息，逐字核对粗体文本（不是只有结构对）
console.log('\n【4】抽样逐字核对：`**出整套版式草案**` 里的词一个不差');
{
  const t = await page
    .locator('.chat-msg.assistant:not(.log) .chat-bubble .md strong')
    .filter({ hasText: '出整套版式草案' })
    .count();
  ok(t >= 1, '找到 <strong>出整套版式草案</strong>（原文 `**出整套版式草案**`）', String(t));
  const bubbleText = await page.locator('.chat-msg.assistant:not(.log) .chat-bubble').first().innerText();
  ok(!bubbleText.includes('**'), '该气泡文本里没有 **');
  ok(bubbleText.includes('出整套版式草案'), '文案本身还在（没被解析吃掉）');
}

await page.screenshot({ path: OUT });
console.log(`\n已保存 ${OUT}`);

console.log(`\n———— ${pass} 通过 / ${fails.length} 失败 ————`);
if (fails.length) for (const f of fails) console.log(`  ✗ ${f}`);

await browser.close();
if (fails.length) process.exit(1);
