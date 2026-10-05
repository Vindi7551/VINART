/**
 * 步骤 01 — 图像识别（薄壳）
 *
 * 逻辑已迁入 src/workflow/briefgen/perceive.ts（gateway 直调，与 order/compile 同模式）。
 * 本文件只做 CLI：解析参数 → 调用 → 打印产物。
 *
 * 运行：
 *   npm run step scripts/step-01-perceive.ts
 *   npm run step scripts/step-01-perceive.ts -- test_product/别的图.png
 *
 * 产出:<图片所在目录>/step-01.json(结构化识别结果,链 A 中间产物归产品目录)
 */

import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { perceiveProduct, printPerceive } from '../src/workflow/briefgen/perceive';

const DEFAULT_IMAGE = 'test_product/shirt/71R5FYOm25L._AC_SX522_.jpg';

const imageArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const PRODUCT_IMAGE = resolve(imageArg || DEFAULT_IMAGE);

// 输出跟随**产品目录**(图片所在目录)——链 A 中间产物归产品,不同产品互不覆盖
const OUT_JSON = resolve(dirname(PRODUCT_IMAGE), 'step-01.json');

async function main() {
  console.log('\n' + '═'.repeat(64));
  console.log('步骤 01 — 图像识别');
  console.log('═'.repeat(64));

  if (!existsSync(PRODUCT_IMAGE)) {
    console.error(`\n✗ 找不到图片：${PRODUCT_IMAGE}`);
    console.error('\n用法：npm run step scripts/step-01-perceive.ts -- <图片路径>');
    process.exit(1);
  }
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extname(PRODUCT_IMAGE).toLowerCase())) {
    console.error(`\n✗ 不支持的图片格式 "${extname(PRODUCT_IMAGE)}"`);
    process.exit(1);
  }

  console.log(`\n[1] 输入`);
  console.log(`    图片 : ${PRODUCT_IMAGE}`);
  console.log(`    detail : original（小字/雕刻识别必须全分辨率）`);

  const r = await perceiveProduct(PRODUCT_IMAGE, OUT_JSON);

  console.log(`\n[2] 结果`);
  console.log(`    耗时 : ${r.elapsedMs}ms`);
  if (r.usage) {
    console.log(`    prompt tokens     : ${r.usage.promptTokens}`);
    console.log(`    completion tokens : ${r.usage.completionTokens}`);
  }
  console.log(`    已写入 ${OUT_JSON}`);

  console.log('\n' + '─'.repeat(64));
  console.log('结构化识别结果');
  console.log('─'.repeat(64));
  printPerceive(r.parsed);
  console.log();
}

main().catch((e) => {
  console.error('\n✗ 失败:', e);
  process.exit(1);
});
