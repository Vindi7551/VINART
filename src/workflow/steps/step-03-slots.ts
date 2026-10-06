/**
 * 步骤 03 — 套图规划（薄壳）
 *
 * 逻辑已迁入 src/workflow/briefgen/plan.ts。翻新时砍掉了旧版的两块职责：
 * 版式草案（归 compile）、生成提示词（归 assetsgen/order）——
 * 规划层只回答「做哪几张图、每张回答什么购买问题、图上写什么字」。
 *
 * 运行：
 *   npm run step scripts/step-03-slots.ts
 *   npm run step scripts/step-03-slots.ts -- test_product/step-02-claims.json [--lang de] [--bullets <文件>]
 *
 * 产出：test_product/step-03-slots.json（给 step-04 消费）
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { planSlots, printPlan } from '../../workflow/briefgen/plan';

const argv = process.argv.slice(2);
const DEFAULT_CLAIMS = 'test_product/step-02-claims.json';

// 位置参数与选项值分开（--bullets 的值不以 -- 开头，会被误当位置参数）
const TAKES = new Set(['--lang', '--bullets']);
const used = new Set<number>();
argv.forEach((a, i) => {
  if (TAKES.has(a)) {
    used.add(i);
    used.add(i + 1);
  }
});
const positional = argv.filter((_a, i) => !used.has(i));

const claimsPath = resolve(positional[0] || DEFAULT_CLAIMS);
const langIdx = argv.indexOf('--lang');
const LANG = langIdx >= 0 ? argv[langIdx + 1] : 'de';
const bulletsIdx = argv.indexOf('--bullets');
const SELLING_POINTS = resolve(bulletsIdx >= 0 ? argv[bulletsIdx + 1] : 'test_product/selling_point.txt');
// 输出跟随 claims 所在的产品目录——链 A 中间产物归产品,不同产品互不覆盖
const OUT_JSON = resolve(dirname(claimsPath), 'step-03.json');

async function main() {
  console.log('\n' + '═'.repeat(66));
  console.log('步骤 03 — 套图规划（一张图 = 一个购买问题）');
  console.log('═'.repeat(66));

  if (!existsSync(claimsPath)) {
    console.error(`\n✗ 找不到 step-02 的审计结果：${claimsPath}`);
    console.error('\n请先跑 step-02：npm run step scripts/step-02-claims.ts');
    process.exit(1);
  }
  if (!existsSync(SELLING_POINTS)) {
    console.error(`\n✗ 找不到卖点文件：${SELLING_POINTS}（--bullets <文件> 可指定）`);
    process.exit(1);
  }

  const claimsRec = JSON.parse(readFileSync(claimsPath, 'utf8'));
  if (!claimsRec.claims?.length) {
    console.error(`\n✗ ${claimsPath} 里没有审计结果（claims 为空）`);
    process.exit(1);
  }
  const workList = claimsRec.imageWorkList ?? [];
  const bullets = readFileSync(SELLING_POINTS, 'utf8').trim();

  console.log(`\n[1] 输入`);
  console.log(`    step-02 审计   : ${claimsPath}`);
  console.log(`    待覆盖需求数   : ${workList.length}`);
  console.log(`    listing 语言   : ${LANG}`);

  console.log(`\n[2] 请求中…`);
  const r = await planSlots(bullets, claimsRec.claims, workList, LANG, OUT_JSON);

  console.log(`\n[3] 结果`);
  if (r.usage) {
    console.log(`    prompt tokens     : ${r.usage.promptTokens}`);
    console.log(`    completion tokens : ${r.usage.completionTokens}`);
  }
  console.log(`    槽位数 : ${r.slots.length}（${r.slots.map((s) => s.slot).join(' / ')}）`);
  console.log(`    已写入 ${OUT_JSON}`);

  console.log('\n' + '─'.repeat(66));
  console.log('套图一览');
  console.log('─'.repeat(66));
  printPlan(r);
  console.log();

  if (r.openQuestions.length) {
    console.log('需要拍板的问题：');
    for (const q of r.openQuestions) console.log(`  - ${q}`);
    console.log();
  }
}

main().catch((e) => {
  console.error('\n✗ 失败:', e);
  process.exit(1);
});
