/**
 * 步骤 02 — 卖点审计（薄壳）
 *
 * 逻辑已迁入 src/workflow/briefgen/claims.ts（语言中性化：listing 语言是
 * 输入项 --lang，输出字段不再带 _de 后缀）。
 *
 * 运行：
 *   npm run step scripts/step-02-claims.ts
 *   npm run step scripts/step-02-claims.ts -- test_product/step-01-perceive.别的图.json [--lang de] [--bullets <文件>]
 *
 * 产出:<facts 所在目录>/step-02.json(给 step-03 消费)
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { auditClaims, printClaims } from '../src/workflow/briefgen/claims';

const argv = process.argv.slice(2);
const DEFAULT_FACTS = 'test_product/step-01-perceive.json';

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

const factsPath = resolve(positional[0] || DEFAULT_FACTS);
const langIdx = argv.indexOf('--lang');
const LANG = langIdx >= 0 ? argv[langIdx + 1] : 'de';
const bulletsIdx = argv.indexOf('--bullets');
const SELLING_POINTS = resolve(bulletsIdx >= 0 ? argv[bulletsIdx + 1] : 'test_product/selling_point.txt');
// 输出跟随 facts 所在的产品目录——链 A 中间产物归产品,不同产品互不覆盖
const OUT_JSON = resolve(dirname(factsPath), 'step-02.json');

async function main() {
  console.log('\n' + '═'.repeat(66));
  console.log('步骤 02 — 卖点审计（宣称 → 要素级证据状态）');
  console.log('═'.repeat(66));

  if (!existsSync(factsPath)) {
    console.error(`\n✗ 找不到 step-01 的识别结果：${factsPath}`);
    console.error('\n请先跑 step-01：npm run step scripts/step-01-perceive.ts');
    process.exit(1);
  }
  if (!existsSync(SELLING_POINTS)) {
    console.error(`\n✗ 找不到卖点文件：${SELLING_POINTS}（--bullets <文件> 可指定）`);
    process.exit(1);
  }

  const facts = JSON.parse(readFileSync(factsPath, 'utf8'));
  if (!facts.parsed) {
    console.error(`\n✗ ${factsPath} 里没有解析成功的识别结果（parsed 字段为空）`);
    process.exit(1);
  }
  const bullets = readFileSync(SELLING_POINTS, 'utf8').trim();

  console.log(`\n[1] 输入`);
  console.log(`    step-01 事实   : ${factsPath}`);
  console.log(`    卖点文件       : ${SELLING_POINTS}（${bullets.split(/\n\s*\n/).filter(Boolean).length} 条）`);
  console.log(`    listing 语言   : ${LANG}`);

  console.log(`\n[2] 请求中（纯文本对文本，事实唯一来源是 step-01）…`);
  const r = await auditClaims(JSON.stringify(facts.parsed, null, 2), bullets, LANG, OUT_JSON);

  console.log(`\n[3] 结果`);
  if (r.usage) {
    console.log(`    prompt tokens     : ${r.usage.promptTokens}`);
    console.log(`    completion tokens : ${r.usage.completionTokens}`);
  }
  console.log(`    宣称数 : ${r.claims.length}`);
  console.log(`    已写入 ${OUT_JSON}`);

  console.log('\n' + '─'.repeat(66));
  console.log('要素级证据状态分布（需求清单由这层生成）');
  console.log('─'.repeat(66));
  printClaims(r);
  console.log();
}

main().catch((e) => {
  console.error('\n✗ 失败:', e);
  process.exit(1);
});
