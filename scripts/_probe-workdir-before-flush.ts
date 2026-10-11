/**
 * 探针：**首条消息（落盘前）也必须解析出真实 workDir** —— 三种修法 A/C 的验收。
 *
 * 事故背景（实测）：`chat` 端点在首条消息里先落盘贴图、再 appendEvent。
 * 此刻会话尚未落盘、只在 `pending` 里；若 `getWorkDir` 只扫磁盘（resolveSessionLocation）
 * 就会解析失败 → 退回 DEFAULT_WORK_DIR(test_product) → 首图写错目录、事件里却存
 * 相对**真实** workDir 的路径 → 之后必 404（表现为「首图必然丢失」）。
 *
 * 断言口径全部是**几何/身份**，不是"函数被调到了"：
 *   [A] pending 会话 getWorkDir === 创建时登记的目录（且 ≠ DEFAULT_WORK_DIR）
 *   [C] 非登记目录必须被 listRoots 拒（落点校验的前提成立）
 *   [回归] 落盘后 getWorkDir 仍 === 真目录（不因修复而回归）
 *   [回归] 旧数据（无 pending、文件在盘）仍走磁盘解析
 *   [文件名] 同一毫秒生成的落点文件名**两两不同**（无随机段时会撞）
 *
 * 用法：npm run step scripts/_probe-workdir-before-flush.ts
 * 自清理：删掉临时目录，并把 ~/.vinart/workdirs.json 还原。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import * as t from '../src/designharness/session/transcript';

const REGISTRY = join(homedir(), '.vinart', 'workdirs.json');
const ROOT = resolve('.tmp-run/probe-workdir');
const PROJ = join(ROOT, 'my-project');

let checks = 0;
function ok(cond: unknown, msg: string): void {
  checks++;
  if (!cond) throw new Error(`断言失败 → ${msg}`);
  console.log('  ✓', msg);
}
function msg(text: string): Omit<t.SessionEvent, 'seq'> & Record<string, unknown> {
  return {
    ts: new Date().toISOString(),
    kind: 'message',
    id: `m_${crypto.randomUUID().slice(0, 6)}`,
    role: 'user',
    text,
  };
}

const registryBefore = existsSync(REGISTRY) ? readFileSync(REGISTRY, 'utf8') : null;
rmSync(ROOT, { recursive: true, force: true });

try {
  console.log('【A】pending 会话（未落盘）解析真实 workDir —— 本次事故的根因断言');
  const id = await t.createSession(PROJ);
  ok(!existsSync(join(PROJ, '.vinart', 'sessions', `${id}.jsonl`)), '此刻会话尚未落盘（惰性）');
  const wdBefore = await t.getWorkDir(id);
  ok(resolve(wdBefore) === resolve(PROJ), `落盘前 getWorkDir = ${wdBefore}（= 登记的目录）`);
  ok(
    resolve(wdBefore) !== resolve(t.DEFAULT_WORK_DIR),
    `落盘前**没有**退回 DEFAULT_WORK_DIR（${t.DEFAULT_WORK_DIR}）—— 首图不会再写错目录`,
  );

  console.log('【回归】落盘后仍解析同一目录');
  await t.appendEvent(id, msg('首条消息'));
  ok(existsSync(join(PROJ, '.vinart', 'sessions', `${id}.jsonl`)), '事件已落盘');
  const wdAfter = await t.getWorkDir(id);
  ok(resolve(wdAfter) === resolve(PROJ), `落盘后 getWorkDir = ${wdAfter}（与落盘前一致）`);

  console.log('【C】落点校验的前提：非登记目录不在 listRoots 内');
  const roots = await t.listRoots();
  ok(
    roots.some((r) => resolve(r) === resolve(PROJ)),
    `登记过的目录在 listRoots 里（${PROJ}）`,
  );
  const bogus = join(ROOT, 'never-registered');
  ok(
    !roots.some((r) => resolve(r) === resolve(bogus)),
    '未登记目录不在 listRoots 里 → 可被拒写（Fix C 的判据成立）',
  );

  console.log('【回归】旧数据：无 pending、文件在盘 → 仍走磁盘解析');
  t.__debugClearPendingForProbe(id);
  const wdLegacy = await t.getWorkDir(id);
  ok(resolve(wdLegacy) === resolve(PROJ), `清掉 pending 后仍能靠磁盘解析：${wdLegacy}`);

  console.log('【文件名】同一毫秒生成的落点文件名两两不同（无随机段会撞）');
  const mk = (i: number) =>
    `uploads/chat-${Date.now()}-${i}-${crypto.randomUUID().slice(0, 8)}.jpg`;
  const names = [mk(0), mk(0), mk(0)];
  ok(new Set(names).size === names.length, `3 次生成 3 个不同名字：${names.map((n) => n.split('-').slice(-2).join('-')).join(' / ')}`);

  console.log(`\nALL PASS — ${checks} 断言全绿`);
} finally {
  rmSync(ROOT, { recursive: true, force: true });
  if (registryBefore !== null) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(REGISTRY, registryBefore, 'utf8');
  }
}
