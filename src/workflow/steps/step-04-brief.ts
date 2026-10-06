/**
 * 步骤 04 — brief 编写（链 A 的最后一步）
 *
 * 把 step-03 的图位规划 + 卖点 + 产品事实「翻译」成 compile 可直接吃的
 * 创意方案 md——每个副图位一份，落 test_product/briefs/<产品名>-<slot>.md。
 * 此后 compile 用法与手写 brief 完全一致：
 *   npm run step src/workflow/design-sketch/compile.ts -- test_product/briefs/xxx.md
 *
 * ⚠️ 旧 step-04-design.ts（三层设计草案）的职责已被 compile 取代，脚本移入 .backup/。
 * ⚠️ MAIN 跳过——纯白底机械处理没有设计决策，走图像处理管线。
 *
 * 运行：
 *   npm run step scripts/step-04-brief.ts -- --facts test_product/shirt/step-01.json --bullets test_product/shirt/selling-points.txt --name shirt   # 全部副图(规划缺省在同目录 step-03.json)
 *   npm run step scripts/step-04-brief.ts -- --only PT01         # 只做一个
 *   npm run step scripts/step-04-brief.ts -- --name myproduct    # 指定产品名（默认取卖点文件名）
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { draftBrief } from '../../workflow/briefgen/draft';

const argv = process.argv.slice(2);

// ⚠️ 选项值解析:--bullets 等的值不以 -- 开头,
// 简单的 find(!startsWith('--')) 会把它误当位置参数(实测踩过)
const TAKES = new Set(['--only', '--name', '--bullets', '--facts', '--slots', '--workdir', '--lang']);
const used = new Set<number>();
argv.forEach((a, i) => {
  if (TAKES.has(a)) {
    used.add(i);
    used.add(i + 1);
  }
});

const factsIdx = argv.indexOf('--facts');
// 缺省跟随产品目录(链 A 中间产物归产品,test-01 与 step-03 同目录)
const FACTS_PATH = resolve(factsIdx >= 0 ? argv[factsIdx + 1] : 'test_product/step-01.json');
const slotsIdx = argv.indexOf('--slots');
const SLOTS_PATH = resolve(
  slotsIdx >= 0 ? argv[slotsIdx + 1] : join(dirname(FACTS_PATH), 'step-03.json'),
);
const onlyIdx = argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1].split(',').map((s) => s.trim().toUpperCase()) : null;
const nameIdx = argv.indexOf('--name');
const bulletsIdx = argv.indexOf('--bullets');
const langIdx = argv.indexOf('--lang');

const SELLING_POINTS = resolve(bulletsIdx >= 0 ? argv[bulletsIdx + 1] : 'test_product/selling_point.txt');
const LANG = langIdx >= 0 ? argv[langIdx + 1] : 'de';
// 方案落盘跟随工作目录(--workdir;缺省旧约定 test_product/briefs)
const workdirIdx = argv.indexOf('--workdir');
const OUT_DIR = resolve(
  workdirIdx >= 0 ? join(argv[workdirIdx + 1], 'briefs') : 'test_product/briefs',
);
// 产物目录可能被清理（实测：清空 test_product 后重跑，writeFileSync 直接 ENOENT）
// ——落盘前自建，脚本对「干净工作区」自洽
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log('\n' + '═'.repeat(66));
  console.log('步骤 04 — brief 编写（规划 → 每图位一份创意方案）');
  console.log('═'.repeat(66));

  if (!existsSync(SLOTS_PATH)) {
    console.error(`\n✗ 找不到 step-03 的规划：${SLOTS_PATH}`);
    console.error('\n请先跑 step-03：npm run step scripts/step-03-slots.ts');
    process.exit(1);
  }
  if (!existsSync(SELLING_POINTS)) {
    console.error(`\n✗ 找不到卖点文件：${SELLING_POINTS}（--bullets <文件> 可指定）`);
    process.exit(1);
  }
  if (!existsSync(FACTS_PATH)) {
    console.error(`\n✗ 找不到识别结果：${FACTS_PATH}（--facts <文件> 可指定）`);
    process.exit(1);
  }

  const plan = JSON.parse(readFileSync(SLOTS_PATH, 'utf8'));
  const slots = plan.slots ?? [];
  if (!slots.length) {
    console.error(`\n✗ ${SLOTS_PATH} 里没有图位规划（slots 为空）`);
    process.exit(1);
  }
  const facts = JSON.parse(readFileSync(FACTS_PATH, 'utf8')).parsed;
  const bullets = readFileSync(SELLING_POINTS, 'utf8').trim();

  // 产品名默认取卖点文件名——与手写 brief 的命名习惯一致（pet-food.md 等）
  const productName =
    nameIdx >= 0 ? argv[nameIdx + 1] : SELLING_POINTS.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');

  // MAIN 跳过：纯白底机械处理，没有设计空间
  const targets = slots.filter((s: { slot: string }) => {
    if (s.slot === 'MAIN') return false;
    if (!ONLY) return true;
    return ONLY.includes(s.slot);
  });
  const skipped = slots.filter((s: { slot: string }) => !targets.includes(s));

  console.log(`\n[1] 输入`);
  console.log(`    规划        : ${SLOTS_PATH}（${slots.length} 槽位）`);
  console.log(`    产品名      : ${productName}`);
  console.log(`    listing 语言: ${LANG}`);
  console.log(
    `    本轮编写    : ${targets.map((s: { slot: string }) => s.slot).join(', ') || '（无）'}`,
  );
  if (skipped.length) {
    console.log(`    跳过        : ${skipped.map((s: { slot: string }) => s.slot).join(', ')}（MAIN 无设计空间 / 未选中）`);
  }

  console.log(`\n[2] 逐个编写（每图位一次调用，失败不连坐）\n`);
  const ok: string[] = [];
  const failed: { slot: string; msg: string }[] = [];

  for (const slot of targets) {
    const outFile = resolve(OUT_DIR, `${productName}-${slot.slot}.md`);
    console.log(`  ── ${slot.slot} ──`);
    try {
      // 只喂该 slot 覆盖的要素，控制 prompt 体积
      // （plan 落盘的 claims 是 compact 格式：elements 字段）
      const related = (plan.claims ?? []).filter((c: { elements?: { element: string }[] }) =>
        (slot.covers_elements ?? []).some((ce: string) =>
          (c.elements ?? []).some((e) => e.element === ce),
        ),
      );
      const r = await draftBrief(slot, related, bullets, facts, outFile);
      console.log(`     ✓ ${outFile}（${r.text.length} 字符）`);
      ok.push(slot.slot);
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0];
      console.log(`     ✗ ${msg}`);
      failed.push({ slot: slot.slot, msg: (e as Error).message });
    }
  }

  console.log(`\n${'═'.repeat(66)}`);
  console.log(`完成 —— ${ok.length}/${targets.length} 份 brief 落 ${OUT_DIR}`);
  if (ok.length) {
    console.log('\n下一步（每份 brief 一个版式）：');
    for (const s of ok) {
      console.log(
        `  npm run step src/workflow/design-sketch/compile.ts -- test_product/briefs/${productName}-${s}.md`,
      );
    }
  }
  if (failed.length) {
    console.log('\n失败清单（重跑单步即可，用 --only <slot>）：');
    for (const f of failed) console.log(`  - ${f.slot}: ${f.msg.split('\n')[0]}`);
    process.exit(2);
  }
  console.log();
}

main().catch((e) => {
  console.error('\n✗ 失败:', e);
  process.exit(1);
});
