/**
 * 会话存储落点验收（阶段 1）—— 断言「会话跟着工作目录走」的不变式。
 *
 * 用法：npm run step scripts/_probe-sessions-store.ts
 *
 * 全部是断言而非打印：任何一条不符 → 抛错 + 非 0 退出码。
 * 自清理：跑完删掉临时项目目录，并把 ~/.vinart/workdirs.json 还原（探针不留垃圾）。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import * as t from '../src/designharness/session/transcript';
import { resolveDesignDir } from '../src/designharness/tools/project-paths';

const REGISTRY = join(homedir(), '.vinart', 'workdirs.json');
const ROOT = resolve('.tmp-run/probe-store');
const A = join(ROOT, 'proj-a');
const B = join(ROOT, 'proj-b');

let checks = 0;
function ok(cond: unknown, msg: string): void {
  checks++;
  if (!cond) throw new Error(`断言失败 → ${msg}`);
  console.log('  ✓', msg);
}
function sessionsFile(root: string, id: string): string {
  return join(root, '.vinart', 'sessions', `${id}.jsonl`);
}
async function listIds(): Promise<string[]> {
  return (await t.listSessions()).map((s) => s.id);
}
// 返回类型显式标注：对象字面量里的 'message' 会被推断成 string，过不了
// SessionEvent 联合类型的窄化（appendEvent 参数的 kind 是字面量联合）。
function msg(text: string): Omit<t.SessionEvent, 'seq'> & Record<string, unknown> {
  return {
    ts: new Date().toISOString(),
    kind: 'message',
    id: `m_${crypto.randomUUID().slice(0, 6)}`,
    role: 'user',
    text,
  };
}

/** 注册表原文——跑完还原 */
const registryBefore = existsSync(REGISTRY) ? readFileSync(REGISTRY, 'utf8') : null;
rmSync(ROOT, { recursive: true, force: true });

try {
  console.log('【1】惰性创建：分配 id，但不落盘、不进列表');
  const id = await t.createSession(A);
  ok(/^sess_/.test(id), `createSession 返回 id = ${id}`);
  ok(!existsSync(sessionsFile(A, id)), '此刻磁盘上没有会话文件（惰性）');
  ok(!(await listIds()).includes(id), '零消息的空会话不在列表里');

  console.log('【2】第一个事件落盘：诞生即绑 workDir');
  await t.appendEvent(id, msg('你好'));
  ok(existsSync(sessionsFile(A, id)), `会话落在 <工作目录>/.vinart/sessions/ 内 → ${sessionsFile(A, id)}`);
  const lines = readFileSync(sessionsFile(A, id), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { kind: string; workDir?: string });
  ok(lines.length === 2, `文件两行：诞生 meta + 第一条消息（实际 ${lines.length} 行）`);
  ok(lines[0].kind === 'meta' && lines[0].workDir === resolve(A), `第一行是诞生 meta，workDir = ${lines[0].workDir}`);
  ok((await t.getWorkDir(id)) === resolve(A), 'getWorkDir = 工作目录本身（不再回退到仓库 test_product）');
  const loc = await t.resolveSessionLocation(id);
  ok(loc?.root === resolve(A), '落点反查命中 proj-a（落点由文件位置决定，不由 meta 决定）');
  const entry = (await t.listSessions()).find((s) => s.id === id);
  ok(entry?.home === resolve(A) && entry?.messageCount === 1, '列表条目 home = proj-a、messageCount = 1');

  console.log('【3】产物落点一级化：<工作目录>/designs/<版式名>（没有 project 那层）');
  const dd = await resolveDesignDir(id, 'PT01');
  ok(dd.workDir === resolve(A), `resolveDesignDir.workDir = 会话的工作目录（${dd.workDir}）`);
  ok(
    dd.dir === join(resolve(A), 'designs', 'PT01'),
    `版式的家 = <工作目录>/designs/PT01 → ${dd.dir}`,
  );
  ok(dd.exists === false, '目录尚不存在时 exists = false（新建场景，dir 是预期写位置）');

  console.log('【4】工作目录不可切换（创建时已绑定）');
  let lockedMsg = '';
  try {
    await t.setWorkDir(id, B);
  } catch (e) {
    lockedMsg = (e as Error).message;
  }
  ok(/不可更改/.test(lockedMsg), `setWorkDir 对已落盘会话抛错 → ${lockedMsg}`);

  console.log('【5】跨目录合并 + 注册表幂等');
  const idB = await t.createSession(B);
  await t.appendEvent(idB, msg('b 的会话'));
  const rootsBefore = (await t.listRoots()).length;
  await t.registerRoot(A);
  await t.registerRoot(B);
  ok((await t.listRoots()).length === rootsBefore, `registerRoot 幂等（仍是 ${rootsBefore} 个目录）`);
  const all = await t.listSessions();
  const two = all.filter((s) => s.id === id || s.id === idB);
  ok(two.length === 2, `列表跨目录合并成 ${two.length} 条：${two.map((s) => `${s.id}@${s.home.split(/[\\/]/).pop()}`).join(', ')}`);

  console.log('【6】删会话 = 只删它所在目录里的记录');
  await t.deleteSession(id);
  ok(!existsSync(sessionsFile(A, id)), '文件已删');
  ok(!(await listIds()).includes(id), '已从列表消失');
  ok(existsSync(sessionsFile(B, idB)), '另一个目录的会话不受影响');

  console.log('【7】删掉工作目录 = 会话跟着消失（零清理逻辑）');
  rmSync(B, { recursive: true, force: true });
  ok(!(await listIds()).includes(idB), 'proj-b 整个目录删掉后，它的会话不再出现');

  console.log(`\n全部 ${checks} 条断言通过。`);
} finally {
  if (registryBefore === null) rmSync(REGISTRY, { force: true });
  else writeFileSync(REGISTRY, registryBefore, 'utf8');
  rmSync(ROOT, { recursive: true, force: true });
  console.log('注册表已还原，临时目录已清理。');
}
