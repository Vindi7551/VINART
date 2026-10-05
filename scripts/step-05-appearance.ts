/**
 * 步骤 05 — 外观编译（版式 + 创意方案 + 产品照 → 专属配色）
 *
 * 颜色不必每次都套资产库预设：这一步按产品自动生成一套内嵌配色 +
 * 每图层颜色分配，落成版式同目录的 design-appearance.json。
 * 产出是数据——人可改几个色值再重渲 final(几秒/张,零 API)。
 * 好用的配色由人再提升进 designassets/elements/palette/。
 *
 * 运行：
 *   npm run step scripts/step-05-appearance.ts -- test_product/layout/<名>/design-sketch.json \
 *     --brief test_product/briefs/<名>.md --product test_product/<产品>/照.jpg
 *
 * 产出：<spec 同目录>/design-appearance.json
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileAppearance } from '../src/workflow/appearance/compile';

const argv = process.argv.slice(2);
const TAKES = new Set(['--brief', '--product', '--max-rounds']);
const used = new Set<number>();
argv.forEach((a, i) => {
  if (TAKES.has(a)) {
    used.add(i);
    used.add(i + 1);
  }
});
const positional = argv.filter((_a, i) => !used.has(i));

const specIdx = positional[0];
const briefIdx = argv.indexOf('--brief');
const productIdx = argv.indexOf('--product');
const roundsIdx = argv.indexOf('--max-rounds');

const SPEC = resolve(specIdx || '');
const BRIEF = briefIdx >= 0 ? resolve(argv[briefIdx + 1]) : null;
const PRODUCT = productIdx >= 0 ? resolve(argv[productIdx + 1]) : null;
const MAX_ROUNDS = roundsIdx >= 0 ? Number(argv[roundsIdx + 1]) : 3;

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(66));
  console.log('步骤 05 — 外观编译(专属配色生成)');
  console.log('═'.repeat(66));

  if (!specIdx || !existsSync(SPEC)) {
    console.error(`\n✗ 找不到版式规格:${SPEC}`);
    console.error('\n用法:npm run step scripts/step-05-appearance.ts -- <design-sketch.json> --brief <方案.md> [--product <产品照>]');
    process.exit(1);
  }

  console.log(`\n[1] 输入`);
  console.log(`    版式   : ${SPEC}`);
  if (BRIEF) console.log(`    方案   : ${BRIEF}`);
  console.log(`    产品照 : ${PRODUCT ?? '(未提供——配色将只按方案氛围派生)'}`);

  console.log(`\n[2] 编译\n`);
  const r = await compileAppearance({
    specPath: SPEC,
    briefPath: BRIEF ?? '',
    productPath: PRODUCT,
    maxRounds: MAX_ROUNDS,
  });

  const pal = r.appearance.palette as Record<string, string>;
  console.log(`\n${'═'.repeat(66)}`);
  console.log(`完成 —— ${r.outPath}`);
  console.log(`    配色角色:${Object.keys(pal).join(' / ')}`);
  console.log(`    字体方案:${r.appearance.fontScheme}`);
  console.log(`    图层分配:${Object.keys(r.appearance.layers ?? {}).length} 个`);
  console.log('\n下一步(重渲成品,零 API):');
  console.log(`  npm run step scripts/step-layout.ts -- ${SPEC} final`);
  console.log();
}

main().catch((e: Error) => {
  console.error('\n✗ 失败:', e.message);
  process.exit(1);
});
