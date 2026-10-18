import { describe, expect, it } from 'vitest';
import { sketchPlanJsonSchema, planToIntent, type SketchPlan } from '../src/schema/plan';
import { isTranslatable, translate } from '../src/workflow/translate/translate';
import type { ImageNode, TextNode } from '../src/document/vocabulary';

const PLAN: SketchPlan = {
  canvas: { ratio: '1:1' },
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

describe('SketchPlan → DesignIntent → DesignDocument', () => {
  const intent = planToIntent(PLAN);
  const result = translate(intent);
  const doc = result.doc;

  it('没有 error 级 issue', () => {
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(isTranslatable(result)).toBe(true);
  });

  it('画布按比例解析成 px，底色默认白色', () => {
    expect(doc.canvas).toEqual({ width: 1200, height: 1200, background: '#ffffff' });
  });

  it('图层边界和 name 保留', () => {
    expect(doc.layers).toHaveLength(2);
    expect(doc.layers[0].id).toBe('layer-1');
    expect(doc.layers[0].name).toBe('产品层');
    expect(doc.layers[1].id).toBe('layer-2');
    expect(doc.layers[1].name).toBe('文字层');
  });

  it('图层内顺序 = z-order', () => {
    const [image] = doc.layers[0].elements as [ImageNode];
    expect(image.type).toBe('image');
    expect(image.rect).toEqual({ x: 300, y: 240, w: 600, h: 600 });
    expect(image.asset).toBe('@placeholder');
    expect(image.fit).toBe('contain');
  });

  it('文字用 frame（px、无 h），字号按默认比例换算', () => {
    const text = doc.layers[1].elements[0] as TextNode;
    expect(text.type).toBe('text');
    expect(text.frame).toEqual({ x: 120, y: 900, w: 960 });
    expect(text.fontSizePx).toBe(26);
    expect(text.align).toBe('center');
    expect(text.runs).toEqual([{ text: '示例标题' }]);
    // 文字不应再带 rect（doc 里只有 frame）
    expect((text as unknown as { rect?: unknown }).rect).toBeUndefined();
  });

  it('JSON Schema 是同一份草契约', () => {
    const root = sketchPlanJsonSchema as unknown as {
      required: readonly string[];
      properties: {
        layers: { items: { properties: { elements: { items: { oneOf: unknown[] } } } } };
      };
    };
    expect(root.required).toEqual(['canvas', 'layers']);
    expect(root.properties.layers.items.properties.elements.items.oneOf).toHaveLength(4);
  });
});
