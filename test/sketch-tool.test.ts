import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSketchLayout, writeSketchPlan } from '../src/designharness/tools/sketch-plan';
import type { SketchPlan } from '../src/schema/plan';

const PLAN: SketchPlan = {
  canvas: { ratio: '1:1', background: '#ffffff' },
  layers: [
    {
      name: '产品层',
      elements: [
        { type: 'image', name: '产品图', rect: { x: 0.25, y: 0.2, w: 0.5, h: 0.5 } },
      ],
    },
    {
      name: '文字层',
      elements: [
        {
          type: 'text',
          name: '标题',
          rect: { x: 0.1, y: 0.75, w: 0.8 },
          align: 'center',
          placeholder: '示例标题',
        },
      ],
    },
  ],
};

const tmp = () => mkdtempSync(join(tmpdir(), 'vinart-sketch-'));

describe('writeSketchPlan', () => {
  it('写到 designs/<layout>/doc.json（草稿）', () => {
    const workDir = tmp();
    const r = writeSketchPlan(workDir, 'vocab-full', PLAN);
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);

    const p = join(workDir, 'designs', 'vocab-full', 'doc.json');
    expect(existsSync(p)).toBe(true);
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    expect(doc.canvas).toEqual({ width: 1200, height: 1200, background: '#ffffff' });
    expect(doc.layers.map((l: { name?: string }) => l.name)).toEqual(['产品层', '文字层']);
    expect(doc.layers[0].elements[0].asset).toBe('@placeholder');
    expect(doc.layers[1].elements[0].runs[0].text).toBe('示例标题');
  });

  it('非法版式名不写盘', () => {
    const workDir = tmp();
    const r = writeSketchPlan(workDir, '../evil', PLAN);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('非法版式名');
    expect(existsSync(join(workDir, 'designs'))).toBe(false);
  });

  it('translate 有 error 不写盘', () => {
    const workDir = tmp();
    const bad: SketchPlan = {
      canvas: { ratio: '1:1' },
      layers: [
        {
          name: '坏层',
          elements: [
            { type: 'text', name: '坏文字', rect: { x: 0.1, y: 0.1, w: 0 } },
          ],
        },
      ],
    };
    const r = writeSketchPlan(workDir, 'vocab-full', bad);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.level === 'error')).toBe(true);
    expect(existsSync(join(workDir, 'designs', 'vocab-full', 'doc.json'))).toBe(false);
  });

  it('plan 结构不完整不写盘', () => {
    const workDir = tmp();
    const r = writeSketchPlan(workDir, 'vocab-full', {} as SketchPlan);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('plan 结构不完整');
    expect(existsSync(join(workDir, 'designs'))).toBe(false);
  });
});

describe('resolveSketchLayout', () => {
  it('有 activeLayout 时永远用当前版式，忽略 AI 传的 layout', () => {
    expect(resolveSketchLayout('vocab-full', 'product-site')).toEqual({
      layout: 'vocab-full',
      created: false,
    });
  });

  it('没有 activeLayout 时用 AI 传的 layout 新建', () => {
    expect(resolveSketchLayout('', 'product-site')).toEqual({
      layout: 'product-site',
      created: true,
    });
    expect(resolveSketchLayout(undefined, 'product-site')).toEqual({
      layout: 'product-site',
      created: true,
    });
  });

  it('没有 activeLayout 也没有合法 layout 时返回 null', () => {
    expect(resolveSketchLayout(undefined, undefined)).toBeNull();
    expect(resolveSketchLayout('', '')).toBeNull();
    expect(resolveSketchLayout(undefined, '../evil')).toBeNull();
  });
});
