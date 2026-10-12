/**
 * 重渲若干版式目录的 **final.png**（走与 `render_design` 工具同一条渲染管道）。
 *
 * 用途：渲染器改了行为之后，把历史上渲出来的旧 PNG 刷成新的——
 * PNG 是**落盘的快照**，不刷的话版式页里看到的还是旧渲染，
 * 会让人误判「改动没生效」。（app 编辑视图是现场渲的，不受影响。）
 *
 * 用法：
 *   npm run step scripts/_rerender-clean.ts                          # 用下面的默认清单
 *   npm run step scripts/_rerender-clean.ts -- <目录> [<目录> ...]    # 指定目录
 *
 * 默认清单 = 2026-10-10 删掉「压图文字自动底衬」后画面会变的版式里、
 * **确实存在 final.png 需要刷新**的那些（SK02 / tst-PT01 只有草图，
 * POSTER02 没有成品，都不在清单里）。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { assembleFinal } from '../src/workflow/compose/assemble';
import { applyAppearance } from '../src/document/design-appearance';
import {
  disposeSketchRenderer,
  getSharedRenderer,
  loadAppearance,
  loadPalette,
  loadTypography,
} from '../src/render/runtime';
import { checkAppearance, checkAppearanceRefs, checkSketch } from '../src/document/validate';
import type { DesignSketch } from '../src/document/design-sketch';
import type { AssetOrders } from '../src/workflow/assetsgen/asset-order';

const DEFAULT_DIRS = [
  'test_product/layout/61bIICZBYDL._AC_SL1500_-PT01',
  'test_product/layout/complete_test-PT06',
  'test_product/layout/goose-PT07',
  'test_product/layout/shirt-PT03',
  'D:/workplace/test/designs/P01',
];

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dirs = (args.length ? args : DEFAULT_DIRS).map((d) => resolve(d));

const kb = (p: string) => (statSync(p).size / 1024).toFixed(0);

async function rerender(dir: string): Promise<boolean> {
  const specPath = resolve(dir, 'design-sketch.json');
  const tag = dir.replace(/\\/g, '/').split('/').slice(-1)[0];
  console.log(`\n── ${tag} ──`);
  if (!existsSync(specPath)) {
    console.log(`  ✗ 没有 design-sketch.json：${specPath}`);
    return false;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(specPath, 'utf8'));
  } catch (e) {
    console.log(`  ✗ spec 不是合法 JSON：${(e as Error).message}`);
    return false;
  }
  // ⚠️ 校验**只警告不中止**：`checkSketch` 是聊天链 `render_design` 工具的
  // 守卫（拦新写的 spec），而 app 的 `/api/layout/<name>/data` 根本不校验、
  // 渲染器也仍然认 spec 里的内联 fill/color/opacity。历史版式多为旧格式
  // （颜色写在 spec 里），若在这里中止就刷不了它们——那才是本脚本的目的。
  const check = checkSketch(raw);
  if (!check.ok) {
    console.log(`  ⚠ 校验有 ${check.issues.length} 条问题（旧格式，照渲）：`);
    for (const i of check.issues.slice(0, 3)) console.log(`      ${i.path}: ${i.message}`);
    if (check.issues.length > 3) console.log(`      …还有 ${check.issues.length - 3} 条`);
  }
  const spec = raw as DesignSketch;

  const appearance = loadAppearance(specPath);
  const apCheck = checkAppearance(appearance);
  if (!apCheck.ok) {
    console.log('  ✗ 外观校验不通过：' + apCheck.issues.map((i) => `${i.path}: ${i.message}`).join('；'));
    return false;
  }
  for (const w of checkAppearanceRefs(spec, appearance)) console.log(`  ⚠ ${w.path}: ${w.message}`);

  const painted = {
    ...spec,
    layers: applyAppearance(spec.layers, appearance) as typeof spec.layers,
  };

  const ordersPath = resolve(dir, 'assets.json');
  const orders: AssetOrders = existsSync(ordersPath)
    ? (JSON.parse(readFileSync(ordersPath, 'utf8')) as AssetOrders)
    : [];

  const pngPath = resolve(dir, 'final.png');
  const before = existsSync(pngPath) ? kb(pngPath) : null;

  const renderer = await getSharedRenderer();
  let result;
  try {
    result = await assembleFinal({
      spec: painted,
      orders,
      outDir: dir,
      searchRoots: [],
      palette: loadPalette(appearance.palette ?? 'warm-copper'),
      typography: loadTypography(appearance.fontScheme ?? 'legacy-system'),
      host: renderer,
      renderer,
    });
  } catch (e) {
    console.log(`  ✗ 渲染失败：${(e as Error).message}`);
    return false;
  }

  const after = kb(result.png);
  console.log(`  ✓ ${before === null ? '新建' : `${before} KB → ${after} KB`}`);
  return true;
}

let okCount = 0;
for (const d of dirs) {
  if (await rerender(d)) okCount++;
}

// ⚠️ 浏览器活着就退出 node → 整条命令组被 SIGTERM（exit 1），beforeExit 钩子不触发
await disposeSketchRenderer();
console.log(`\n———— ${okCount} / ${dirs.length} 重渲成功 ————`);
process.exit(okCount === dirs.length ? 0 : 1);
