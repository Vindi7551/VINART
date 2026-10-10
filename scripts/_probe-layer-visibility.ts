/**
 * 图层可视性集合运算 —— 纯逻辑探针（不开浏览器）。
 *
 * 覆盖 `src/ui/layer-visibility.ts` 的 `toggleHidden`：
 * 普通切换 / 独奏 / 独奏再点还原 / 换目标独奏 / 单层版式 / 顺序无关 / 不可变。
 *
 * 为什么先跑这个：独奏是**一次改多层**的操作，"再点一次能不能回来" 完全由
 * 集合语义决定；把这层算对了，浏览器里就只剩"有没有把 display 打对"要查。
 *
 * 运行：npm run step scripts/_probe-layer-visibility.ts
 */

import { toggleHidden } from '../src/ui/layer-visibility';

let pass = 0;
const fails: string[] = [];

function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fails.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

/** 断言隐藏集合等于给定元素（顺序无关） */
function eq(actual: ReadonlySet<string>, expected: string[], msg: string) {
  const a = [...actual].sort().join(',');
  const e = [...expected].sort().join(',');
  ok(a === e, `${msg} —— 期望 {${e || '空'}}，实得 {${a || '空'}}`);
}

const ALL = ['bg', 'panel_dark', 'rule_side', 'title_cn', 'title_en'];

console.log('\n【1】普通切换（点眼睛）');
eq(toggleHidden(new Set(), 'bg', false, ALL), ['bg'], '空集点 bg → 藏 bg');
eq(toggleHidden(new Set(['bg']), 'bg', false, ALL), [], '再点 bg → 显示');

console.log('\n【2】独奏（Alt+点击）：只留一个，其余全藏');
eq(toggleHidden(new Set(), 'title_cn', true, ALL), ['bg', 'panel_dark', 'rule_side', 'title_en'],
  '空集独奏 title_cn → 藏其余 4 个');
eq(toggleHidden(new Set(['bg']), 'title_cn', true, ALL), ['bg', 'panel_dark', 'rule_side', 'title_en'],
  '已有手工隐藏时独奏 → 仍以独奏目标为准（不累加）');

console.log('\n【3】独奏再点一次 → 还原全显示（可逆开关）');
eq(toggleHidden(new Set(['bg', 'panel_dark', 'rule_side', 'title_en']), 'title_cn', true, ALL), [],
  '同一目标再独奏 → 全显示');

console.log('\n【4】独奏换目标 → 换人');
eq(toggleHidden(new Set(['bg', 'panel_dark', 'rule_side', 'title_en']), 'title_en', true, ALL),
  ['bg', 'panel_dark', 'rule_side', 'title_cn'], '独奏 title_cn 时 Alt 点 title_en → 改独奏 title_en');

console.log('\n【5】独奏一个"当前已隐藏"的图层 → 把它放出来，其余全藏');
eq(toggleHidden(new Set(['bg']), 'bg', true, ALL), ['panel_dark', 'rule_side', 'title_cn', 'title_en'],
  '独奏隐藏中的 bg → bg 可见、其余全藏');

console.log('\n【6】边界：单层版式');
eq(toggleHidden(new Set(), 'only', true, ['only']), [], '只有一层时独奏 = 什么都不藏（本就只有它可见）');
eq(toggleHidden(new Set(), 'only', false, ['only']), ['only'], '只有一层时普通点击照常能藏');

console.log('\n【7】独奏判定与 allIds 顺序无关');
{
  const shuffled = ['title_en', 'title_cn', 'rule_side', 'panel_dark', 'bg'];
  eq(toggleHidden(new Set(['bg', 'panel_dark', 'rule_side', 'title_en']), 'title_cn', true, shuffled), [],
    'allIds 倒序时，"已在独奏这一层"仍能被识别 → 还原');
}

console.log('\n【8】不修改入参（纯函数）');
{
  const prev = new Set(['bg']);
  const snapshot = [...prev].join(',');
  toggleHidden(prev, 'bg', false, ALL);
  toggleHidden(prev, 'title_cn', true, ALL);
  ok([...prev].join(',') === snapshot, `原集合未被就地改动（仍为 {${snapshot}}）`);
}

console.log(`\n———— ${pass} 通过 / ${fails.length} 失败 ————`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
