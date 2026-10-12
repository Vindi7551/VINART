/**
 * 校验文档里的示例代码块是否真的合法。
 *
 * 动机：design-sketch.md 是喂给模型的**唯一知识来源**，它里面的示例必须能被
 * checkSketch 放过 —— 否则模型照抄示例就会被拦，白白浪费轮次。
 * 这个脚本把文档里所有 ```json / ```jsonc 块抠出来，能当版式解析的就跑一遍校验。
 *
 * 用法：
 *   npm run step scripts/check-doc-examples.ts -- src/document/design-sketch.md src/document/README.md
 *
 * ⚠️ README.md 是 CRLF 换行，匹配代码围栏的正则必须写成 `\r?\n`，
 * 否则一个块都抓不到（会误报"发现 0 个"）。
 */
import { readFileSync } from 'node:fs';
import { checkSketch } from '../src/document/validate';

const files = process.argv.slice(2);
let totalBad = 0;

for (const f of files) {
  console.log(`\n${'='.repeat(66)}\n${f}\n${'='.repeat(66)}`);
  const md = readFileSync(f, 'utf8');
  const blocks = [...md.matchAll(/```jsonc?\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  console.log(`发现 ${blocks.length} 个 JSON 代码块\n`);

  blocks.forEach((b, i) => {
    const label = `块 ${i + 1}`;
    let v: unknown;
    try {
      v = JSON.parse(b);
    } catch {
      console.log(`${label}: — 含注释，跳过`);
      return;
    }
    const o = v as Record<string, unknown>;
    if (!o.name || !Array.isArray(o.layers)) {
      console.log(`${label}: — 不是版式（无 name/layers），跳过`);
      return;
    }
    const r = checkSketch(v);
    const errs = r.issues.filter((x) => x.level === 'error');
    if (errs.length) {
      totalBad++;
      console.log(`${label} "${String(o.name)}": ✗ ${errs.length} 个错误`);
      errs.forEach((e) => console.log(`      ${e.path} —— ${e.message.slice(0, 90)}`));
    } else {
      console.log(`${label} "${String(o.name)}": ✓ 通过`);
    }
  });
}

console.log(`\n${'='.repeat(66)}`);
console.log(totalBad === 0 ? '文档里的示例全部合法' : `有 ${totalBad} 个示例不合法`);
console.log('='.repeat(66) + '\n');
process.exit(totalBad === 0 ? 0 : 1);
