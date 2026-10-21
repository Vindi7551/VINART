/**
 * **旧文档 → 新结构**迁移：扁平的 `layers`（矩形/文字/图片/组混在一起）⇒
 * 「画布 → 图层 → 元素」（见 `src/document/vocabulary.ts` 文件头）。
 *
 * ## 折叠规则**不在这个脚本里**
 *
 * 用的是 `vocabulary.wrapIntoLayers` —— 翻译器产出新文档时用的是**同一份**。
 * 各写一遍必然漂开（这个仓库已经吃过几次"两份实现漂开"的亏）。
 *
 * ## 判"已经是新结构"
 *
 * 旧结构：`layers[i]` 是**节点**，带 `type`（`'shape'` / `'text'` / …）。
 * 新结构：`layers[i]` 是**图层**，带 `elements`、**没有 `type`**。
 * ⇒ 判据就是这一条，重复跑是幂等的（不会套两层）。
 *
 * ## 用法
 *
 * ```
 * node --experimental-transform-types --import ./scripts/_ts-resolve.mjs \
 *   scripts/migrate-doc.ts <doc.json> [<doc.json> ...] [--write]
 * ```
 *
 * 不带 `--write` 只**试算并打印**（看折成几个图层、每个装几个元素）；
 * 带 `--write` 才落盘，且**先在旁边留一份 `.bak`**。
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

import { wrapIntoLayers } from '../src/document/vocabulary.ts';
import type { DesignDocument, ElementNode } from '../src/document/vocabulary.ts';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const paths = argv.filter((a) => !a.startsWith('--'));

if (!paths.length) {
  console.error('用法: ... scripts/migrate-doc.ts <doc.json> [<doc.json> ...] [--write]');
  process.exit(1);
}

/**
 * 旧文档里组的字段叫 `children`，新模型叫 `elements`（递归改名）。
 *
 * ⚠️ 这一步**必须在 `wrapIntoLayers` 之前**做：那个函数收的是**新形状**的节点
 *    （它读 `e.elements`）。第一版漏了这步，运行时 `l.elements.length` 直接炸。
 */
function renameChildren(n: Record<string, unknown>): void {
  if (!n || typeof n !== 'object') return;
  const kids = n.children;
  if (Array.isArray(kids)) {
    n.elements = kids;
    delete n.children;
    for (const c of kids) renameChildren(c as Record<string, unknown>);
  }
}

/**
 * ⭐ **文字：`rect` → `frame`**（2026-10-17）。
 *
 * - **丢掉 `h`** —— 文字的高度是**排版结果** ✗ 存了必然漂（见 `TextFrame` 的注释）
 * - **路径文字（`path` / `curve`）保留 `h`** —— 它是 SVG `viewBox` 的长宽比，是**输入** ✓
 *
 * ⚠️ 这条迁移**与层级结构无关** ⇒ 必须跑在 `alreadyNew` 的提前 `continue` **之前**
 *    （现有文档全是新结构，否则永远跑不到 ✗）
 */
function migrateText(n: unknown): void {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) {
    for (const c of n) migrateText(c);
    return;
  }
  const o = n as Record<string, unknown> & { type?: unknown; rect?: Record<string, number>; path?: unknown; curve?: unknown };
  if (o.type === 'text' && o.rect) {
    const { x, y, w, h } = o.rect;
    o.frame = { x, y, w, ...(o.path || o.curve ? { h } : {}) };
    delete o.rect;
  }
  for (const k of Object.keys(o)) migrateText(o[k]);
}

let changed = 0;
for (const p of paths) {
  const raw = JSON.parse(readFileSync(p, 'utf8')) as {
    canvas: DesignDocument['canvas'];
    layers: unknown[];
  };
  const first = raw.layers[0] as { type?: unknown; elements?: unknown } | undefined;
  const alreadyNew = !!first && first.type === undefined && Array.isArray(first.elements);

  // ⭐ **文字迁移与层级结构无关** ⇒ 先跑（见 `migrateText` 的注释）
  const beforeText = JSON.stringify(raw);
  migrateText(raw);
  const textChanged = beforeText !== JSON.stringify(raw);

  if (alreadyNew && !textChanged) {
    console.log(`  跳过（已经是新结构、文字也已迁移）：${p}`);
    continue;
  }
  if (alreadyNew) {
    // 只落了文字迁移 ⇒ **不要再 `wrapIntoLayers`**（那会把图层拍平 ✗）
    console.log(`  ${p}`);
    console.log('    只做文字迁移：rect → frame（路径文字保留 h）');
    if (write) {
      copyFileSync(p, `${p}.bak`);
      writeFileSync(p, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
      console.log(`    已写入（备份：${p}.bak）`);
    }
    changed += 1;
    continue;
  }

  const elements = raw.layers as unknown as ElementNode[];
  for (const e of elements) renameChildren(e as unknown as Record<string, unknown>);
  const layers = wrapIntoLayers(elements);
  console.log(`  ${p}`);
  console.log(`    旧：${elements.length} 个平铺节点（画布的直接孩子全是元素）`);
  console.log(`    新：${layers.length} 个图层 —— ` + layers.map((l) => `${l.id}(${l.elements.length} 个元素)`).join(' · '));
  if (write) {
    copyFileSync(p, `${p}.bak`);
    writeFileSync(p, `${JSON.stringify({ canvas: raw.canvas, layers }, null, 2)}\n`, 'utf8');
    console.log(`    已写入（备份：${p}.bak）`);
    changed += 1;
  }
}

console.log(write ? `\n迁移 ${changed} 份` : '\n（试算，未落盘 —— 加 --write 才写）');
