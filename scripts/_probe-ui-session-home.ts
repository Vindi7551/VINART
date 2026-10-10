/**
 * 全栈冒烟：从 UI 选目录 → 发第一条消息 → 会话文件真的落在那个目录里。
 *
 * 这是「会话跟着工作目录走」在用户实际操作路径上的验证（API 单测在
 * _probe-sessions-store.ts；这里走 React state + SSE 的真实链路）。
 * 用完清理临时目录并还原 ~/.vinart/workdirs.json（探针不留垃圾）。
 *
 * 用法：npm run step scripts/_probe-ui-session-home.ts
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE ?? 'http://localhost:5173';
const REGISTRY = join(homedir(), '.vinart', 'workdirs.json');
const HOME_DIR = resolve('.tmp-run/ui-e2e-home'); // 用户「选」的工作目录
const UI_PATH = HOME_DIR.replace(/\\/g, '/'); // 手输时用正斜杠，顺便验证归一

let checks = 0;
function ok(cond: unknown, msg: string): void {
  checks++;
  if (!cond) throw new Error(`断言失败 → ${msg}`);
  console.log('  ✓', msg);
}

const registryBefore = existsSync(REGISTRY) ? readFileSync(REGISTRY, 'utf8') : null;
rmSync(HOME_DIR, { recursive: true, force: true });
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

try {
  try {
    browser = await chromium.launch({ channel: 'chromium' });
  } catch {
    browser = await chromium.launch();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('vinart.sessionId');
    localStorage.removeItem('vinart.pendingEnv');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  console.log('【1】选目录（手输，正斜杠）');
  await page.locator('.workdir-bar a', { hasText: '手输' }).click();
  await page.locator('.workdir-bar input').fill(UI_PATH);
  await page.locator('.workdir-bar input').press('Enter');
  await page.waitForTimeout(400);
  ok(existsSync(join(HOME_DIR, '.vinart', 'sessions')) === false, '会话文件此刻还不存在（惰性）');

  console.log('【2】直接发一条消息（会话在这一刻才诞生）');
  await page.locator('.input-row textarea').fill('只回复两个字：收到');
  await page.locator('.input-row textarea').press('Enter');
  // 等 SSE 落盘：文件出现即视为完成（最多 60s）
  const sidFile = () =>
    existsSync(join(HOME_DIR, '.vinart', 'sessions'))
      ? readdirSync(join(HOME_DIR, '.vinart', 'sessions')).find((f) => f.endsWith('.jsonl'))
      : undefined;
  for (let i = 0; i < 120 && !sidFile(); i++) await page.waitForTimeout(500);
  const f = sidFile();
  ok(!!f, `会话文件落在用户选的目录里 → ${join(HOME_DIR, '.vinart', 'sessions')}\\${f}`);
  const sid = String(f).replace(/\.jsonl$/, '');

  const lines = readFileSync(join(HOME_DIR, '.vinart', 'sessions', String(f)), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { kind: string; workDir?: string; text?: string });
  ok(lines[0].kind === 'meta', `第一行是诞生 meta（workDir 固化）`);
  ok(
    lines[0].workDir?.replace(/\\/g, '/').toLowerCase() === UI_PATH.toLowerCase(),
    `meta.workDir 与用户选的目录一致 → ${lines[0].workDir}`,
  );
  ok(
    lines.some((l) => l.kind === 'message' && l.text === '只回复两个字：收到'),
    '用户消息已落盘',
  );

  console.log('【3】📂 对该会话已锁定（工作目录创建即绑定）');
  const folder = page.locator('.workdir-bar button').first();
  ok(await folder.isDisabled(), '📂 disabled');
  const tip = (await folder.getAttribute('title')) ?? '';
  ok(/不可更改/.test(tip), `提示说明为何锁定 → ${tip.split('\\n')[0]}`);

  console.log('【4】侧栏出现该目录的组头，且会话在组内');
  await page.waitForTimeout(500);
  const groups = await page.locator('.session-group').allInnerTexts();
  ok(
    groups.some((g) => g.includes('ui-e2e-home') && g.includes('只回复两个字')),
    `侧栏分组含本次会话 → ${groups.filter((g) => g.includes('ui-e2e-home')).join(' | ').slice(0, 80)}`,
  );

  console.log(`\n全部 ${checks} 条断言通过。会话 ${sid} 落点已确认在用户选的目录内。`);
} finally {
  if (browser) await browser.close();
  if (registryBefore === null) rmSync(REGISTRY, { force: true });
  else writeFileSync(REGISTRY, registryBefore, 'utf8');
  rmSync(HOME_DIR, { recursive: true, force: true });
  console.log('注册表已还原，临时工作目录已清理。');
}
