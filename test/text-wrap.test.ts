/**
 * `wrap` 的默认值：**默认换行（normal）**，单行必须显式 `nowrap`。
 *
 * 这条同时守着三个入口（漏一个就会出现"面板/工具改了但画布不变"）：
 * - 渲染器：`emit.ts` 的 `white-space`；
 * - 编辑器面板：`fieldsFor` 的 `get` / `set`（`normal` 要删字段，不留冗余）；
 * - AI 两个口：`patch_doc` 的白名单 + `planToIntent` 的透传。
 */

import { describe, expect, it } from 'vitest';

import type { DesignDocument, ElementNode } from '../src/document/vocabulary';
import { applyPatches } from '../src/document/patch';
import { fieldsFor } from '../src/editor/inspector';
import { emitDocument } from '../src/render/vocabulary/emit';
import { planToIntent, type SketchPlan } from '../src/schema/plan';

const CANVAS = { width: 400, height: 300 };

const inLayer = (node: unknown): DesignDocument =>
  ({ canvas: CANVAS, layers: [{ id: 'L', elements: [node] }] }) as DesignDocument;

const text = (extra: Record<string, unknown> = {}): ElementNode =>
  ({
    id: 't',
    type: 'text',
    frame: { x: 0, y: 0, w: 200 },
    runs: [{ text: 'one two three four five six seven eight nine ten' }],
    ...extra,
  }) as ElementNode;

const vtStyle = (html: string): string => /data-fit="t" style="([^"]*)"/.exec(html)?.[1] ?? '';

describe('wrap 默认 normal', () => {
  it('渲染：缺省 = 换行；显式 nowrap = 单行', () => {
    expect(vtStyle(emitDocument(inLayer(text())).html)).toContain('white-space:normal');
    expect(vtStyle(emitDocument(inLayer(text({ wrap: 'nowrap' }))).html)).toContain('white-space:nowrap');
  });

  it('面板：缺省显示 normal；选 normal 删字段，选 nowrap 写字段', () => {
    const f = fieldsFor(text(), CANVAS).find((x) => x.path === 'wrap')!;
    expect(f).toBeTruthy();
    expect(f.get(text())).toBe('normal');
    expect(f.get(text({ wrap: 'nowrap' }))).toBe('nowrap');

    const n = text({ wrap: 'nowrap' });
    f.set(n, 'normal');
    expect((n as { wrap?: string }).wrap).toBeUndefined();

    f.set(n, 'nowrap');
    expect((n as { wrap?: string }).wrap).toBe('nowrap');
  });

  it('patch_doc：wrap 只给 text；normal 收成"省略"', () => {
    const r1 = applyPatches(inLayer(text({ wrap: 'nowrap' })), [{ id: 't', path: 'wrap', value: 'normal' }]);
    expect(r1.errors).toEqual([]);
    expect((r1.doc.layers[0].elements[0] as { wrap?: string }).wrap).toBeUndefined();

    const r2 = applyPatches(inLayer(text()), [{ id: 't', path: 'wrap', value: 'nowrap' }]);
    expect((r2.doc.layers[0].elements[0] as { wrap?: string }).wrap).toBe('nowrap');

    const img = applyPatches(
      inLayer({ id: 'p', type: 'image', asset: 'a.png', rect: { x: 0, y: 0, w: 10, h: 10 } }),
      [{ id: 'p', path: 'wrap', value: 'normal' }],
    );
    expect(img.errors[0]).toContain('只有 text');
  });

  it('plan：wrap 在 schema 里可写，并透传到 intent', () => {
    const base: SketchPlan = {
      canvas: { ratio: '1:1' },
      layers: [
        {
          name: 'L',
          elements: [
            { type: 'text', name: '标题', rect: { x: 0.1, y: 0.1, w: 0.5 }, wrap: 'nowrap' },
            { type: 'text', name: '正文', rect: { x: 0.1, y: 0.2, w: 0.5 } },
          ],
        },
      ],
    };
    const intent = planToIntent(base) as any;
    const kids = intent.layers[0].children;
    expect(kids[0].wrap).toBe('nowrap');
    expect(kids[1].wrap).toBeUndefined();
  });
});
