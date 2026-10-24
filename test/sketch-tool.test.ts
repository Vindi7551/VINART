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

  it('版式已存在时不覆盖（只新建）', () => {
    const workDir = tmp();
    expect(writeSketchPlan(workDir, 'vocab-full', PLAN).ok).toBe(true);
    const second = writeSketchPlan(workDir, 'vocab-full', PLAN);
    expect(second.ok).toBe(false);
    expect(second.error).toContain('版式已存在');
  });

  it('clip / mask / polygon 能进 doc', () => {
    const workDir = tmp();
    const plan: SketchPlan = {
      canvas: { ratio: '1:1' },
      layers: [
        {
          name: '斜切',
          elements: [
            {
              type: 'image',
              name: 'photo',
              rect: { x: 0, y: 0, w: 0.6, h: 1 },
              clip: 'polygon(0 0, 100% 0, 70% 100%, 0 100%)',
              mask: 'linear-gradient(#000, transparent)',
            },
            {
              type: 'shape',
              kind: 'polygon',
              name: 'cut',
              rect: { x: 0.6, y: 0, w: 0.4, h: 1 },
              points: [
                [0, 0],
                [1, 0],
                [0, 1],
              ],
            },
          ],
        },
      ],
    };
    const r = writeSketchPlan(workDir, 'clip-test', plan);
    expect(r.ok).toBe(true);
    const doc = JSON.parse(readFileSync(join(workDir, 'designs', 'clip-test', 'doc.json'), 'utf8'));
    expect(doc.layers[0].elements[0].clip).toContain('polygon');
    expect(doc.layers[0].elements[0].mask).toContain('linear-gradient');
    expect(doc.layers[0].elements[1].kind).toBe('polygon');
    expect(doc.layers[0].elements[1].points).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
  });
});

describe('resolveSketchLayout', () => {
  it('AI 传的合法名字 → 新建（恒为 created: true）', () => {
    expect(resolveSketchLayout('product-site')).toEqual({
      layout: 'product-site',
      created: true,
    });
  });

  it('没传 / 非法名字 → null（不再从 activeLayout 兜底）', () => {
    expect(resolveSketchLayout(undefined)).toBeNull();
    expect(resolveSketchLayout('')).toBeNull();
    expect(resolveSketchLayout('../evil')).toBeNull();
  });
});
