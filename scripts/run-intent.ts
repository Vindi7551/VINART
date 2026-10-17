/**
 * **意图 JSON → 文档 → 产物** —— 一条命令跑完整链（翻译器 → 编译器）。
 *
 * ```
 * node --experimental-transform-types --import ./scripts/_ts-resolve.mjs \
 *   scripts/run-intent.ts <intent.json> [--out <doc.json>]
 * ```
 *
 * ## 为什么要有它
 *
 * `test/vocab-coverage.test.ts` 只驱动**编译器**，而且是"**一个字段一个节点**"。
 * 翻译器那一半（比例 → px）**从来没有被任何测试走过**，也没人拿一份
 * "**所有字段同时在场**"的文档跑过整条链。
 *
 * 这个脚本拿一份**意图 JSON**（手写、可以含全部词汇）整条链跑一遍，把三段的问题**分开放**：
 *
 * | 段 | 看什么 |
 * |---|---|
 * | 翻译器 | `issues`（`error` = 文档不成立 / `note` = 能翻但值得提醒） |
 * | 编译器 | `unsupported`（翻不出，**已报**）、`notes` |
 * | 产物 | `<script>` 数必须 0 · 不许出现 `undefined` / `NaN` / `null` 字面量 |
 *
 * ## 退出码
 *
 * `0` 全清 · `1` 翻译器有 `error` 级问题 · `2` 产物里有脏字
 *
 * ⚠️ `unsupported` 非空**不算失败** —— 那是设计允许的"翻不出但诚实报出来"。
 *    真正该盯的是"**没报也没产出**"（静默丢弃），那要靠 `vocab-coverage.test.ts` 的逐字段对账。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ⚠️ 带 `.ts` 扩展名：Node 的原生类型剥离才认得（项目正式代码里不写扩展名）
import { formatIssues, isTranslatable, translate, type DesignIntent } from '../src/workflow/translate/translate.ts';
import { emitDocument } from '../src/render/vocabulary/emit.ts';

const argv = process.argv.slice(2);
const inPath = argv.find((a) => !a.startsWith('--'));
const outIdx = argv.indexOf('--out');
const outPath = outIdx >= 0 ? argv[outIdx + 1] : null;

if (!inPath) {
  console.error('用法: run-intent.ts <intent.json> [--out <doc.json>]');
  process.exit(64);
}

/**
 * 收集文档引用到的**所有素材名**：`asset` 字段，以及任何字符串里的 `url(名字)`。
 *
 * 它们会被合成一张**假映射**（`名字 → DATA:名字`）——
 * 目的是**不让"素材没找到"这条报告掩盖别的报告**。真实素材解析在服务端那一段。
 */
function assetsOf(v: unknown, key: string, out: Set<string>): Set<string> {
  if (typeof v === 'string') {
    if (key === 'asset') out.add(v);
    for (const m of v.matchAll(/url\(\s*['"]?([^)'"]+)/g)) out.add(m[1]);
    return out;
  }
  if (Array.isArray(v)) {
    for (const x of v) assetsOf(x, key, out);
    return out;
  }
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) assetsOf(val, k, out);
  }
  return out;
}

const intent = JSON.parse(readFileSync(resolve(inPath), 'utf8')) as DesignIntent;

const assets: Record<string, string> = {};
for (const name of assetsOf(intent, '', new Set())) assets[name] = `DATA:${name}`;

// ── ① 翻译器 ──────────────────────────────────────────────────────────
const r = translate(intent);
console.log('══ ① 翻译器 ════════════════════════════════════════════════════');
console.log(`   画布 ${r.doc.canvas.width}×${r.doc.canvas.height} · 顶层节点 ${r.doc.layers.length} 个`);
console.log(`   素材引用：${Object.keys(assets).join(', ') || '（无）'}`);
console.log(formatIssues(r).split('\n').map((l) => '   ' + l).join('\n'));

// ── ② 编译器 ──────────────────────────────────────────────────────────
const e = emitDocument(r.doc, { assets });
console.log('');
console.log('══ ② 编译器 ════════════════════════════════════════════════════');
console.log(`   产物 ${e.html.length} 字符`);
console.log(`   unsupported ${e.unsupported.length} 条（翻不出，但**报了**）：`);
for (const u of e.unsupported) console.log(`     [${u.id}] ${u.field} —— ${u.reason}`);
console.log(`   notes ${e.notes.length} 条（有损但不丢语义）：`);
for (const n of e.notes) console.log(`     [${n.id}] ${n.field} —— ${n.reason}`);

// ── ③ 产物体检 ────────────────────────────────────────────────────────
const junk = ['undefined', 'NaN', 'null'].filter((j) => e.html.includes(j));
const scripts = (e.html.match(/<script/g) ?? []).length;
console.log('');
console.log('══ ③ 产物体检 ══════════════════════════════════════════════════');
console.log(`   <script> 数 ${scripts}（必须 0 —— 编辑器不往子文档注脚本）`);
console.log(`   脏字 ${junk.length ? junk.join(', ') : '无'}`);

if (outPath) {
  const p = resolve(outPath);
  writeFileSync(p, JSON.stringify(r.doc, null, 2));
  console.log(`\n   doc 写入 ${p}`);
}

if (!isTranslatable(r)) process.exit(1);
if (junk.length || scripts) process.exit(2);
