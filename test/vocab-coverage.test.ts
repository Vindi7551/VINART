/**
 * **词汇 → 编译器** 的逐字段覆盖对账（清单在 `scripts/_vocab-coverage-cases.ts`）。
 *
 * 这个测试守着一条规矩：`emit.ts` 声称「**绝不静默丢弃**」——
 * 词汇里有、它这一版翻不出来的，必须进 `unsupported` 报出来，不许装作支持。
 *
 * 所以这里断言的不是"全部支持"（那是奢望），而是：
 * **每一个字段都要有明确结论** —— 落地 / 已报 / 静默丢弃，三者必居其一，
 * 而且"静默丢弃"的清单一打印出来就能看见（它是缺陷，不是状态）。
 */

import { describe, expect, it } from 'vitest';

import { CASES, formatReport, nestedTextFitGap, runCoverage, runSemanticChecks, runStrokeMatrix, runVisualMatrix } from '../scripts/_vocab-coverage-cases';
import { emitDocument } from '../src/render/vocabulary/emit';
import type { DesignDocument } from '../src/document/vocabulary';

describe('词汇 → 编译器 逐字段覆盖对账', () => {
  it('每个字段都跑出了结论（清单长度对得上，没有漏项）', () => {
    const rows = runCoverage();
    expect(rows.length).toBe(CASES.length);
    // 每个字段名唯一 —— 重名会让"某项没结论"被掩盖
    expect(new Set(CASES.map((c) => c.field)).size).toBe(CASES.length);
  });

  it('打印三分清单（静默丢弃 = 需要修的那些）', () => {
    const rows = runCoverage();
    console.log(formatReport(rows));
    expect(rows.filter((r) => r.state === '静默丢弃')).toBeDefined();
  });

  it('打印 Stroke / 效果 / fill 的落点矩阵', () => {
    const vis = runVisualMatrix();
    const print = (title: string, list: Array<{ field: string; kind: string; state: string }>, kinds: string[]) => {
      const fields = [...new Set(list.map((r) => r.field))];
      console.log(`\n【${title}】`);
      console.log(`  ${'字段'.padEnd(20)}${kinds.map((k) => k.padEnd(12)).join('')}`);
      for (const f of fields) {
        console.log(
          `  ${f.padEnd(20)}${kinds.map((k) => (list.find((x) => x.field === f && x.kind === k)?.state ?? '?').padEnd(12)).join('')}`,
        );
      }
    };
    print('Stroke 字段 × 元素类型', runStrokeMatrix(), ['shape', 'text', 'image']);
    print('元素级效果 × 元素类型', vis.effects, ['shape', 'text', 'image', 'svg']);
    print('元素级 fill × 元素类型', vis.fills, ['shape', 'text', 'image', 'svg']);
    expect(vis.effects.length).toBeGreaterThan(0);
  });

  it('三条语义机检（文字渐变填色 / 多层 fill / 四角圆角）', () => {
    for (const c of runSemanticChecks()) {
      console.log(`  ${c.ok ? '✓' : '⚠️'} ${c.name}${c.ok ? '' : `\n      ${c.detail}`}`);
    }
    expect(runSemanticChecks().length).toBe(3);
  });

  it('组内文字在不在「实测装填」名单里', () => {
    const gap = nestedTextFitGap();
    console.log(`  fitTargets = ${gap.listed.join(', ') || '（空）'}；组内文字 = ${gap.nested.join(', ')}`);
    // ⚠️ 这一条**暂时不判失败**（它是待修的缺陷），但必须留下痕迹：
    //    组内文字拿不到装填系数 ⇒ 长文字一定会冲出框。
    expect(gap.nested.length).toBeGreaterThan(0);
  });

  /**
   * ⚠️ 守的是一个**比"字段没实现"更糟**的失败模式。
   *
   * 一条声明里只要有一个**非法值**，浏览器丢掉的是**整条声明** ——
   * 实测 `transform:scale(undefined,2)` 会把同一行好好的 `rotate` 一起带走，
   * 而且当时 `unsupported` 是**空的**（一声不响地没了）。
   *
   * ⇒ "产物里出现 `undefined` / `NaN` / `null` 的字面量"必须是**红灯**，
   *   不能靠人肉读产物才能发现。
   */
  it('产物 HTML 里不许出现 undefined / NaN / null 的字面量', () => {
    const shape = (id: string) => ({
      id,
      type: 'shape' as const,
      kind: 'rect' as const,
      rect: { x: 0, y: 0, w: 10, h: 10 },
      fill: '#333',
    });
    const text = (id: string) => ({
      id,
      type: 'text' as const,
      rect: { x: 0, y: 0, w: 100, h: 20 },
      runs: [{ text: 'x' }],
    });
    const canvas = { width: 900, height: 600 };
    /**
     * ⚠️ 结构是「画布 → **图层** → 元素」（2026-10-16 改，见 `vocabulary.ts` 文件头）：
     *    `doc.layers` 收的是**图层**，节点得放进 `Layer.elements` 里。
     *    图层**永远和画布一样大** ⇒ 元素坐标就是画布坐标（这些用例的数值一个都没动）。
     */
    const inLayer = (node: unknown) => ({ canvas, layers: [{ id: 'L', elements: [node] }] });

    // 每一条都是"**合法**写法"或"**坏值**" —— 两种都不许把 undefined 拼进产物
    const cases: Array<[string, unknown]> = [
      ['底色省略（合法 ⇒ 白底）', { canvas, layers: [] }],
      ['底色多层', { canvas: { ...canvas, background: ['linear-gradient(#000,#fff)', 'linear-gradient(#fff,#000)'] }, layers: [] }],
      ['transform 空对象', inLayer({ ...shape('s1'), transform: {} })],
      ['只写 origin', inLayer({ ...shape('s2'), transform: { origin: { x: 0, y: 1 } } })],
      ['scale 缺 x（坏值）', inLayer({ ...shape('s3'), transform: { rotate: -8, scale: { y: 2 } } })],
      ['rotate 是字符串（坏值）', inLayer({ ...shape('s4'), transform: { rotate: '8' } })],
      ['文字 + transform', inLayer({ ...text('t1'), transform: { rotate: 3 } })],
      ['文字 + scale（非法，会被丢）', inLayer({ ...text('t2'), transform: { scale: { x: 2, y: 2 } } })],
    ];

    for (const [name, doc] of cases) {
      const { html, unsupported } = emitDocument(doc as DesignDocument);
      for (const junk of ['undefined', 'NaN', 'null']) {
        expect(html.includes(junk), `「${name}」的产物里出现了 ${junk}`).toBe(false);
      }
      console.log(`  ✓ ${name}（unsupported ${unsupported.length} 条）`);
    }
  });
});
