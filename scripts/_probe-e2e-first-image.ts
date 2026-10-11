/**
 * 端到端验收：**首条消息带图**（原 bug 的精确场景）。
 * 走真实 HTTP（8787），断言图片落在**会话真实 workDir** 下、且事件引用可回读。
 */
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = 'http://localhost:8787';
const PROBE = resolve('.tmp-run/e2e-upload-test');
const DEFAULT_WD = resolve('test_product');
let checks = 0;
function ok(c: unknown, m: string): void {
  checks++;
  if (!c) throw new Error(`断言失败 → ${m}`);
  console.log('  ✓', m);
}

rmSync(PROBE, { recursive: true, force: true });
mkdirSync(PROBE, { recursive: true });

console.log('【1】建会话（绑定临时目录）');
const created = await (await fetch(`${BASE}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ workDir: PROBE }),
})).json() as { id: string };
const sid = created.id;
ok(/^sess_/.test(sid), `会话已建：${sid}`);
ok(!existsSync(join(PROBE, '.vinart', 'sessions', `${sid}.jsonl`)), '磁盘上尚无会话文件（惰性）');

console.log('【2】首条消息带图 —— 原 bug 精确场景');
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const resp = await fetch(`${BASE}/api/sessions/${sid}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: '', images: [`data:image/png;base64,${png}`] }),
});
ok(resp.ok, `chat 返回 HTTP ${resp.status}`);
await resp.text();

console.log('【3】图片必须落在**真实 workDir** 的 uploads/ 下');
const upDir = join(PROBE, 'uploads');
ok(existsSync(upDir), `上传目录已创建：${upDir}`);
const files = readdirSync(upDir);
ok(files.length === 1, `目录里有 1 个文件：${files.join(', ')}`);
const fname = files[0]!;
ok(/-\d+-[0-9a-f]{8}\.png$/.test(fname), `文件名含随机段（防覆盖）：${fname}`);

console.log('【4】错误目录不得出现该图（原事故形态）');
const wrongDir = join(DEFAULT_WD, 'uploads');
const leaked = existsSync(wrongDir) ? readdirSync(wrongDir).filter((f) => f === fname) : [];
ok(leaked.length === 0, `图**没有**落进 DEFAULT_WORK_DIR(${wrongDir})`);

console.log('【5】事件里的引用必须能被文件服务回读（端到端闭环）');
const raw = readFileSync(join(PROBE, '.vinart', 'sessions', `${sid}.jsonl`), 'utf8');
const evLine = raw.split('\n').find((l) => l.includes('"images"'))!;
const rel = (JSON.parse(evLine) as { images: string[] }).images[0]!;
ok(rel === `uploads/${fname}`, `事件引用 = ${rel}`);
const fileResp = await fetch(`${BASE}/api/sessions/${sid}/file/${rel}`);
ok(fileResp.ok, `/file/ 回读成功 HTTP ${fileResp.status}（不再是 404）`);

console.log(`\nALL PASS — ${checks} 断言全绿`);
rmSync(PROBE, { recursive: true, force: true });
