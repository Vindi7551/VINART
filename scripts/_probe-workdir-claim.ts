/**
 * 「选目录即登记」+「登记前对账」的验收探针。
 *
 * 覆盖三件事：
 *   【1】缺口本体：目录里有会话数据但没登记 → 列表看不见（不是被过滤，是没人去找）
 *   【2】认领关闭缺口：claimWorkDir = 登记（写前与注册表对账）+ 对账该目录的会话索引
 *   【3】索引对账：补登（有文件没条目）/ 删幽灵（有条目没文件）/ 修正（字段与事件流不符）
 *
 * ⚠️ 单进程内 `listRoots()` 有内存缓存且**不失效**（设计如此，省每请求一次读盘），
 * 所以本探针断言的是「缓存内」的行为；跨进程（重启服务）的失忆用文件是否存在来表征。
 *
 * 用法：npm run step scripts/_probe-workdir-claim.ts
 * 自清理：还原 ~/.vinart/workdirs.json，删掉临时目录。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import * as t from '../src/designharness/session/transcript';

const REGISTRY = join(homedir(), '.vinart', 'workdirs.json');
const ROOT = resolve('.tmp-run/probe-claim');
const X = join(ROOT, '旧机器上留下的目录');

let checks = 0;
function ok(cond: unknown, msg: string): void {
  checks++;
  if (!cond) throw new Error(`断言失败 → ${msg}`);
  console.log('  ✓', msg);
}
const meta = (workDir?: string) =>
  JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', kind: 'meta', ...(workDir ? { workDir } : {}) });
const msg = (text: string, ts = '2026-01-01T00:00:01.000Z') =>
  JSON.stringify({ ts, kind: 'message', id: `m_${Math.random().toString(36).slice(2, 8)}`, role: 'user', text });
const indexEntry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: 'x',
  updatedAt: '2020-01-01T00:00:00.000Z',
  messageCount: 99,
  workDir: null,
  home: '/wrong',
  ...over,
});

const registryBefore = existsSync(REGISTRY) ? readFileSync(REGISTRY, 'utf8') : null;
rmSync(ROOT, { recursive: true, force: true });
rmSync(REGISTRY, { force: true }); // 起点：模拟「新机器 / 刚清过 ~/.vinart」

try {
  // ── 造「上一辈子留下的数据」：直接按落点约定铺文件，**不经过 createSession**
  const dir = join(X, '.vinart', 'sessions');
  mkdirSync(dir, { recursive: true });
  //  ① sess_ok     ：文件 + 索引条目都在，但条目字段全是错的（漂了）→ 应被「修正」
  //  ② sess_orphan ：只有文件、索引里没有                                        → 应被「补登」
  //  ③ sess_ghost  ：索引里有、文件没有了                                        → 应被「摘掉」
  writeFileSync(join(dir, 'sess_ok.jsonl'), [meta(X), msg('上一辈子说的话')].join('\n') + '\n', 'utf8');
  writeFileSync(
    join(dir, 'sess_orphan.jsonl'),
    [meta(X), msg('我是孤儿')].join('\n') + '\n',
    'utf8',
  );
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify([indexEntry('sess_ok'), indexEntry('sess_ghost', { title: '早就没了' })], null, 2) + '\n',
    'utf8',
  );

  console.log('【1】缺口本体：数据在盘上、目录没登记 → 列表看不见');
  ok(!(await t.listRoots()).includes(X), 'X 不在注册表');
  ok(
    !(await t.listSessions()).some((s) => [ 'sess_ok', 'sess_orphan' ].includes(s.id)),
    'listSessions() 里没有这两个会话 —— 不是被过滤，是根本没人去那个目录找',
  );

  console.log('\n【2】认领 = 登记（写前与注册表对账）');
  const rep = await t.claimWorkDir(X);
  ok(resolve(rep.root) === resolve(X), `claimWorkDir 返回规范化的 root → ${rep.root}`);
  ok(existsSync(REGISTRY), `注册表被就地创建 → ${REGISTRY}`);
  const roots = JSON.parse(readFileSync(REGISTRY, 'utf8')) as string[];
  ok(roots.length === 1 && resolve(roots[0]) === resolve(X), `注册表只有一条且是规范形式 → ${JSON.stringify(roots)}`);
  ok(
    (await t.listSessions()).some((s) => s.id === 'sess_ok'),
    '认领后立刻可见（数据没搬、meta 没改）',
  );

  console.log('\n【3】登记前对账：同一目录的不同写法不会变成两条');
  const weird = X.replace(/\\/g, '/').toUpperCase(); // 正斜杠 + 大写 = 同一目录的另一种写法
  const before = (await t.listRoots()).length;
  await t.registerRoot(weird); // 若不对账就会 push 出第二条
  const after = (await t.listRoots()).length;
  ok(after === before, `先按另一种写法登记再按规范写法登记，注册表仍是 ${after} 条（不会长出重复）`);

  console.log('\n【4】目录索引对账：补登 / 删幽灵 / 修正');
  ok(rep.added.includes('sess_orphan'), `补登：磁盘上有文件、索引里没有 → ${rep.added.join(',')}`);
  ok(rep.dropped.includes('sess_ghost'), `删幽灵：索引里有、磁盘上没有 → ${rep.dropped.join(',')}`);
  ok(rep.fixed.includes('sess_ok'), `修正：字段与事件流不符 → ${rep.fixed.join(',')}`);
  ok(rep.total === 2, `对账后会话总数 = 2（实际 ${rep.total}）`);
  const after4 = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as Array<Record<string, unknown>>;
  const okEntry = after4.find((e) => e.id === 'sess_ok')!;
  ok(okEntry.title === '上一辈子说的话', `标题按事件流修正 → 「${okEntry.title}」`);
  ok(okEntry.messageCount === 1, `消息数按事件流修正（99 → ${okEntry.messageCount}）`);
  ok(String(okEntry.home).replace(/\\/g, '/').toLowerCase() === X.replace(/\\/g, '/').toLowerCase(), `home 修正为真实落点 → ${okEntry.home}`);
  ok(!after4.some((e) => e.id === 'sess_ghost'), '幽灵条目已从索引摘掉');

  console.log('\n【5】幂等：再认领一次 = 零写盘（三项全空）');
  const rep2 = await t.claimWorkDir(X);
  ok(
    rep2.added.length === 0 && rep2.dropped.length === 0 && rep2.fixed.length === 0,
    `第二次认领无需改动（added/dropped/fixed 全空，total=${rep2.total}）`,
  );

  console.log('\n【6】注册表丢了 → 重启进程即失忆（数据一个字节没少）');
  rmSync(REGISTRY, { force: true });
  ok(!existsSync(REGISTRY), '注册表文件已删除');
  ok(existsSync(join(dir, 'sess_ok.jsonl')), '会话文件本身毫发无损');
  console.log('     恢复路径：前端启动自愈会把 localStorage 里记得的目录重新认领 → 列表自动回来。');

  console.log(`\n共 ${checks} 条断言通过。`);
} finally {
  if (registryBefore === null) rmSync(REGISTRY, { force: true });
  else writeFileSync(REGISTRY, registryBefore, 'utf8');
  rmSync(ROOT, { recursive: true, force: true });
  console.log('\n注册表已还原，临时目录已清理。');
}
