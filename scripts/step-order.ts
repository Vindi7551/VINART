/**
 * step-order —— 版式 + 创意方案 → assets.json（素材订单）
 *
 * 用法：
 *   npm run step scripts/step-order.ts -- <版式.json> --brief <方案.md> [--prompt-lang en] [--product <商品照>] [--force]
 *
 * 产出的 assets.json 落在版式目录（与 design-sketch.json 同目录），
 * 供 gen 阶段消费。--product 只决定模型能不能引用 @product，本次不读文件。
 *
 * --prompt-lang 是**生图提示词**的语言（默认 en——提示词的读者是生图模型，
 * seedream 中英双语原生），与 listing 的市场语言无关。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { generateOrders } from '../src/workflow/assetsgen/order';
import { fileToDataUrl } from '../src/gateway/util/data-url';
import type { DesignSketch } from '../src/workflow/design-sketch/design-sketch';

const argv = process.argv.slice(2);
const specPath = argv[0];
const briefIdx = argv.indexOf('--brief');
const briefPath = briefIdx >= 0 ? argv[briefIdx + 1] : null;
const langIdx = argv.indexOf('--prompt-lang');
const promptLang = langIdx >= 0 ? argv[langIdx + 1] : 'en';
const prodIdx = argv.indexOf('--product');
const productPath = prodIdx >= 0 ? argv[prodIdx + 1] : null;
const productAvailable = !!productPath && existsSync(productPath);
const force = argv.includes('--force');

if (!specPath || !existsSync(specPath)) {
  console.error(
    '用法: npm run step scripts/step-order.ts -- <版式.json> --brief <方案.md> [--prompt-lang en] [--product <商品照>] [--force]',
  );
  process.exit(1);
}
if (!briefPath || !existsSync(briefPath)) {
  console.error('✗ 需要 --brief <方案.md>（创意方案文件）');
  process.exit(1);
}

const SPEC = resolve(specPath);
const BRIEF = resolve(briefPath);

async function main() {
  const spec = JSON.parse(readFileSync(SPEC, 'utf8')) as DesignSketch;
  const OUT = resolve('test_product/layout', spec.name);
  const outPath = resolve(OUT, 'assets.json');

  if (existsSync(outPath) && !force) {
    console.log(`✓ ${outPath} 已存在，跳过（--force 强制重产）`);
    return;
  }

  const briefText = readFileSync(BRIEF, 'utf8');

  console.log('════════════════════════════════════════════════════════════════════');
  console.log('step-order —— 版式 + 创意方案 → 素材订单');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log(`  版式   : ${SPEC}`);
  console.log(`  方案   : ${BRIEF}`);
  console.log(`  提示词语言: ${promptLang}`);
  console.log(`  商品照 : ${productAvailable ? productPath : '（无——订单将不引用 @product）'}`);

  const orders = await generateOrders({
    spec,
    briefText,
    promptLang,
    productAvailable,
    productDataUrl: productAvailable ? fileToDataUrl(productPath!) : undefined,
  });

  writeFileSync(outPath, JSON.stringify(orders, null, 2) + '\n', 'utf8');
  console.log(`\n完成 —— ${outPath}（${orders.length} 条订单）`);
  for (const o of orders) {
    console.log(`    ${o.file}  ${o.size}  prompt ${o.prompt.length} 字符`);
  }
}

main().catch((e) => {
  console.error('\n✗ 失败:', e);
  process.exit(1);
});
