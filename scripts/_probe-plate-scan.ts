/**
 * 扫「压图文字底衬」—— 统计每个版式里被**自动**加了反相底衬的文字节点。
 *
 * ⚠️ **该机制已于 2026-10-10 删除**（`render.ts` 里的 `overlayTextIds` /
 * `plateFor` / `colorLuminance` 全部移除）。删前实测：34 个版式 · 168 个
 * 文字节点里有 **28 个**被自动加衬（分布在 8 个版式：P01 11、SK02 5/5、
 * goose-PT07 3、POSTER02 3、61bIICZBYDL…-PT01 2、tst-PT01 2、
 * complete_test-PT06 1、shirt-PT03 1）。删后复跑 `--clean` 已归零。
 * 本脚本留作**回归守卫**：底衬只要重新出现就会在这里报出来。
 *
 * 这个兜底当年是**渲染时现算**的，不写在 spec 里，所以看数据文件看不出来
 * —— 只能拦渲染产物数。
 *
 * 用法：
 *   npm run step scripts/_probe-plate-scan.ts                  # 只报告
 *   npm run step scripts/_probe-plate-scan.ts -- --clean       # 断言一处都没有
 *
 * 底衬的指纹：文字节点的 `<div data-fit="…">` 上带 `background:`。
 * 正常情况下这个 div 只有 `position/width/height`（见 render.ts 的 renderText）。
 */
import { readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const API = 'http://localhost:8787';
const CLEAN = process.argv.includes('--clean');
/** 工作目录里的产物（会话模式：版式在 <workDir>/designs/<name>） */
const SESSION = process.env.VINART_PROBE_SESSION ?? 'sess_1b6ec46c';
const WORK_LAYOUTS = ['P01', 'POSTER01', 'POSTER02'];

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

type Row = { name: string; where: string; texts: number; plated: number; platedIds: string[] };

async function scan(name: string, where: string, session?: string): Promise<Row | null> {
  const url = `${API}/api/layout/${encodeURIComponent(name)}/data${session ? `?session=${session}` : ''}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = (await r.json()) as { html: string };
  // 文字节点的底板 div：<div data-fit="id" style="[background:…;]position:relative…">
  const re = /<div data-fit="([^"]+)"[^>]*style="([^"]*)"/g;
  let m: RegExpExecArray | null;
  let texts = 0;
  const platedIds: string[] = [];
  while ((m = re.exec(j.html))) {
    texts++;
    if (/background:/.test(m[2])) platedIds.push(m[1]);
  }
  return { name, where, texts, plated: platedIds.length, platedIds };
}

const rows: Row[] = [];

// ① 仓库里的版式（无会话 → test_product/layout）
const repoRoot = resolve('test_product/layout');
if (existsSync(repoRoot)) {
  for (const d of readdirSync(repoRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    if (!existsSync(join(repoRoot, d.name, 'design-sketch.json'))) continue;
    const row = await scan(d.name, 'test_product');
    if (row) rows.push(row);
  }
}

// ② 工作目录里的产物（会话模式）
for (const n of WORK_LAYOUTS) {
  const row = await scan(n, SESSION, SESSION);
  if (row) rows.push(row);
}

// ── 报告 ──
const w = Math.max(12, ...rows.map((r) => r.name.length));
console.log(`\n${'版式'.padEnd(w)} | 文字 | 有底衬 | 命中图层`);
console.log('-'.repeat(w + 34));
for (const r of rows) {
  console.log(
    `${r.name.padEnd(w)} | ${String(r.texts).padStart(4)} | ${String(r.plated).padStart(6)} | ${r.platedIds.join(', ') || '—'}`,
  );
}
const totText = rows.reduce((s, r) => s + r.texts, 0);
const totPlate = rows.reduce((s, r) => s + r.plated, 0);
const hitLayouts = rows.filter((r) => r.plated > 0);

console.log(`\n合计：${rows.length} 个版式 · ${totText} 个文字节点 · **${totPlate} 个被加了底衬**（分布在 ${hitLayouts.length} 个版式里）`);
if (hitLayouts.length) {
  console.log('会因此次删除而**画面变化**的版式：');
  for (const r of hitLayouts) console.log(`  · ${r.name}（${r.where}）— ${r.plated}/${r.texts} 个文字，如 ${r.platedIds.slice(0, 4).join(', ')}`);
}

console.log('');
if (CLEAN) {
  ok(totPlate === 0, `机制已删净：${rows.length} 个版式里一处底衬都没有`, `实得 ${totPlate} 处`);
} else {
  console.log('（报告模式：未做断言。删完加 `-- --clean` 复跑一次应得 0）');
}

console.log(`\n———— ${pass} 通过 / ${fails.length} 失败 ————`);
if (fails.length) for (const f of fails) console.log(`  ✗ ${f}`);
if (fails.length) process.exit(1);
