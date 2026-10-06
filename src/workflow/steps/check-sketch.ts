/**
 * 校验一份或多份 design-sketch.json（**只查结构，不渲染**）
 *
 * 用法：
 *   npm run step scripts/check-sketch.ts -- <spec.json> [更多 spec…]
 *
 * 用途：
 * - 手写 spec 时先跑一遍，别等渲染出怪东西才发现
 * - 排查模型产出的 spec 到底哪里不合法
 *
 * 渲染器里还有一道运行时守卫（顺序 / z-index），这个工具查的是那之前的事。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkAppearance, checkSketch } from '../../workflow/design-sketch/validate';

async function main(): Promise<void> {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    console.error('用法：npm run step scripts/check-sketch.ts -- <spec.json> [更多 spec…]');
    process.exit(1);
  }

  let bad = 0;
  for (const f of files) {
    const p = resolve(f);
    console.log(`\n${'─'.repeat(70)}\n${f}\n${'─'.repeat(70)}`);

    if (!existsSync(p)) {
      console.log('  ✗ 文件不存在');
      bad++;
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(p, 'utf8'));
    } catch (e) {
      console.log(`  ✗ JSON 解析失败：${(e as Error).message}`);
      bad++;
      continue;
    }

    // 按文件名自动分派：外观文件用外观校验，其余按版式校验
    const isAppearance = /design-appearance\.json$/.test(f);
    const r = isAppearance ? checkAppearance(raw) : checkSketch(raw);
    const errs = r.issues.filter((i) => i.level === 'error');
    const warns = r.issues.filter((i) => i.level === 'warn');

    if (r.ok && warns.length === 0) {
      console.log('  ✓ 通过（无问题）');
      continue;
    }
    if (errs.length) {
      console.log(`  ✗ ${errs.length} 个错误：`);
      errs.forEach((i, n) => console.log(`    ${n + 1}. ${i.path} —— ${i.message}`));
      bad++;
    }
    if (warns.length) {
      console.log(`  ⚠️ ${warns.length} 个警告：`);
      warns.forEach((i, n) => console.log(`    ${n + 1}. ${i.path} —— ${i.message}`));
    }
    if (r.ok) console.log('  ✓ 结构合法（只有警告）');
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(bad === 0 ? `全部通过（${files.length} 份）` : `${bad} / ${files.length} 份有问题`);
  console.log('═'.repeat(70) + '\n');
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
