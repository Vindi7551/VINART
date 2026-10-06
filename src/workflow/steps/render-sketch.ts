/**
 * 只渲草图 —— 不碰商品素材、不跑抠图、不生成任何图片请求。
 *
 * ## 为什么单独做一个
 *
 * `step-layout.ts` 是**完整流程**（[0] 抠图 → [1] 生图 → [2] 组装），
 * 它要求 spec 里的 `product` 照片必须存在。
 * 但**草图根本不需要商品照片**——它只画区域框和灰条。
 *
 * 实测踩到：spec 里的 `product` 指向一个已清理掉的临时文件，
 * 结果连草图都渲不出来。这里绕开那一整套，只做「读 spec → 渲草图」。
 *
 * ## 用法
 *
 * ```bash
 * npm run step scripts/render-sketch.ts -- test_product/layout/PT09/design-sketch.json
 * npm run step scripts/render-sketch.ts -- <spec1.json> <spec2.json> …
 * ```
 */

import { renderSketchFile } from '../../workflow/design-sketch/runtime';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (files.length === 0) {
  console.error('用法：npm run step scripts/render-sketch.ts -- <spec.json> [更多 spec…]');
  process.exit(1);
}

let bad = 0;
for (const f of files) {
  const r = await renderSketchFile(f);
  if (r.ok) {
    console.log(`  ✓ ${f}\n      → ${r.png}`);
  } else {
    console.log(`  ✗ ${f}\n      ${r.error}`);
    bad++;
  }
}

console.log(`\n${files.length - bad} / ${files.length} 成功`);
process.exit(bad === 0 ? 0 : 1);
