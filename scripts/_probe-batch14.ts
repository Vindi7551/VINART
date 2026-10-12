/**
 * 14-brief 批量压测 —— 子 agent 并发场景的渲染提速验收。
 *
 * 与 2026-10-01 的串行 compile 压测（约 50 分钟）同名单对照：
 * 这次走 runner 并发池 + design-sketch 工具集，渲染经 render_sketch →
 * runtime.ts 共享渲染器（persistent context，进程内多 page 并发）。
 *
 * 机制组装与 spawn-tool.ts 同款（system + 工具表 + dir + 真网关），
 * 只是父会话换成固定测试 id，记账照常落 transcript。
 *
 * 用法：npm run step scripts/_probe-batch14.ts
 * 产物：test_product/batch14/designs/<name>/{design-sketch.json, sketch.png}
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAgentBatch, type AgentBatchEvent } from '../src/designharness/subagent/runner';
import { designAgentSystem } from '../src/designharness/subagent/design-system';
import { DESIGN_SKETCH_TOOLS } from '../src/designharness/tools';
import { getChatGateway } from '../src/config';
import { disposeSketchRenderer } from '../src/render/runtime';

// 与 2026-10-01 串行压测同一名单（原文件已丢失，按同主题同难度重建）
const SLUGS = [
  'album-cover', 'camping-gear', 'children-book', 'fitness-app',
  'pet-food', 'plush-penguin', 'realestate', 'tech-launch',
  'wedding-invite', 'kaffee', 'parfum-noir', 'hiring-poster',
  'restaurant-menu', 'film-stille-frequenz',
];

const BRIEF_DIR = resolve('test_product/briefs');
const OUT_DIR = resolve('test_product/batch14/designs');
const SESSION_ID = 'sess_batch14';

async function main(): Promise<void> {
  const jobs = SLUGS.map((slug) => {
    const path = resolve(BRIEF_DIR, `${slug}.md`);
    const brief = readFileSync(path, 'utf8').trim();
    if (!brief.startsWith(`版式名：${slug}`)) {
      throw new Error(`${slug}.md 第一行必须是「版式名：${slug}」`);
    }
    return {
      label: slug,
      name: slug,
      brief,
    };
  });

  const events: AgentBatchEvent[] = [];
  const t0 = Date.now();

  console.log(`── 14-brief 批量压测开始：${jobs.length} jobs，并发 4 ──`);

  const batch = await runAgentBatch({
    sessionId: SESSION_ID,
    system: designAgentSystem(),
    seed: [],
    jobs,
    dir: OUT_DIR,
    tools: DESIGN_SKETCH_TOOLS,
    stream: (m, o) => getChatGateway().stream(m, o),
    maxConcurrent: 4,
    onEvent: (evt) => {
      events.push(evt);
      if (evt.kind === 'agent-result') {
        const dt = ((Date.now() - t0) / 1000).toFixed(0);
        const mark = evt.stopReason === 'completed' ? '✓' : `✗ ${evt.stopReason}`;
        console.log(`[t+${dt}s] ${evt.label} → ${mark} · artifacts=${evt.artifacts.length}${evt.diagnostic ? ' · ' + evt.diagnostic.slice(0, 120) : ''}`);
      }
    },
  });

  const wallSec = (Date.now() - t0) / 1000;

  // ── 产物核验：spec + png 真实落盘 ──
  const checks = SLUGS.map((slug) => {
    const dir = resolve(OUT_DIR, slug);
    const spec = resolve(dir, 'design-sketch.json');
    const png = resolve(dir, 'sketch.png');
    const specOk = existsSync(spec);
    const pngOk = existsSync(png) && statSync(png).size > 1000;
    return { slug, specOk, pngOk, pngKB: pngOk ? Math.round(statSync(png).size / 1024) : 0 };
  });

  // ── 汇总 ──
  const completed = batch.outcomes.filter((o) => o.stopReason === 'completed').length;
  const byReason: Record<string, number> = {};
  for (const o of batch.outcomes) byReason[o.stopReason] = (byReason[o.stopReason] ?? 0) + 1;

  console.log('\n══════════════ 汇总 ══════════════');
  console.log(`墙钟：${wallSec.toFixed(1)}s（2026-10-01 串行基线约 50 分钟）`);
  console.log(`完成：${completed}/${SLUGS.length} · stopReason 分布：${JSON.stringify(byReason)}`);
  console.log(`usage：${JSON.stringify(batch.usage)}`);
  console.log(`aborted：${batch.aborted}`);
  console.log('\n── 产物核验（spec + png>1KB）──');
  for (const c of checks) {
    console.log(`${c.specOk && c.pngOk ? '✓' : '✗'} ${c.slug.padEnd(24)} spec=${c.specOk ? 'ok' : 'MISSING'} png=${c.pngOk ? c.pngKB + 'KB' : 'MISSING'}`);
  }

  const summary = {
    wallSec: Math.round(wallSec * 10) / 10,
    completed,
    total: SLUGS.length,
    byReason,
    usage: batch.usage,
    aborted: batch.aborted,
    artifacts: checks,
    events,
  };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(resolve('test_product/batch14/summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n汇总已落 test_product/batch14/summary.json');
}

main()
  .catch(async (e) => {
    console.error('BATCH FAILED:', e);
    await disposeSketchRenderer();
    process.exit(1);
  })
  .finally(() => {
    // SIGTERM 纪律：浏览器活着就退出 → 整条命令组被 SIGTERM（exit 1）。
    // CLI 收尾必须显式 dispose 共享渲染器再退出。
    void disposeSketchRenderer().then(() => process.exit(0));
  });
