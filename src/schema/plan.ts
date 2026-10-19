/**
 * 草图契约 —— `SketchPlan`（AI 的受限输入）+ `planToIntent()`（补默认值 → 完整 `DesignIntent`）。
 *
 * 2026-10-18 新建。**这里不写 px、不写 fill/font，也不碰文档模型**：
 * AI 只决定“要多少东西、怎么摆”，位置统一用 0–1；
 * 默认样式/字号/占位图在这里补，然后交给已有的 `translate()` 换成 px。
 *
 * 分层：
 *
 *   SketchPlan（AI 工具的参数）
 *        │ planToIntent()
 *        ▼
 *   DesignIntent（完整词汇的 0–1 版）
 *        │ translate()
 *        ▼
 *   DesignDocument（px）
 *        │ emitDocument()
 *        ▼
 *   HTML / PNG
 *
 * ⚠️ **group 不进草图**：AI 只写 layer，`planToIntent` 内部用顶层 group 保留图层边界，
 *    再由 `translate` 的 `wrapIntoLayers` 折回 `Layer[]`。AI 看不到 group。
 */

import type { Canvas, ImageNode, TextNode } from '../document/vocabulary';
import type {
  DesignIntent,
  IntentGroupNode,
  IntentImageNode,
  IntentLayer,
  IntentShapeNode,
  IntentSvgNode,
  IntentTextNode,
} from './intent';

// ══════════════════════════════════════════════════════════════════════
// ① 草图（0–1，AI 可见）
// ══════════════════════════════════════════════════════════════════════

export const SKETCH_RATIOS = ['1:1', '4:5', '3:4', '16:9', '9:16'] as const;
export type SketchRatio = (typeof SKETCH_RATIOS)[number];

/** 画布比例。真实 px 由 `planToIntent` 按固定基准解析（AI 不写宽高） */
export interface SketchCanvas {
  ratio: SketchRatio;
  /** 画布底色；缺省白色。`'transparent'` 也合法 */
  background?: string;
}

/** 文字的盒子：**没有 h** —— 高度是排版结果 */
export interface SketchTextRect {
  x: number;
  y: number;
  w: number;
}

/** 图片 / svg / 形状的盒子：有 h */
export interface SketchBoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SketchLayer {
  /** 图层显示名；`Layer.name` 用它，不强制角色 */
  name: string;
  elements: SketchElement[];
}

interface SketchElementBase {
  /** 元素显示名/自由角色标签 —— 翻译器**不解析**，只展示 */
  name: string;
}

export interface SketchText extends SketchElementBase {
  type: 'text';
  rect: SketchTextRect;
  align?: TextNode['align'];
  /**
   * 换行。**默认 `normal`**（在 `rect.w` 里断行）；标题/标签要单行才写 `nowrap`。
   *
   * ⚠️ 单行装不下时靠 `fit.ts` 缩字号，而它**目前零生产调用** ⇒ `nowrap` 的长标题
   *    会直接冲出框。计划里只有"确实要单行"的短标题才该写它。
   */
  wrap?: 'nowrap' | 'normal';
  /** 字号比例（0–1，相对画布宽）；不写默认 0.022。由模型自由给，不做枚举 */
  fontScale?: number;
  /** 可读占位文案；缺省用内置示例 */
  placeholder?: string;
}

export interface SketchImage extends SketchElementBase {
  type: 'image';
  rect: SketchBoxRect;
  /** 缺省是内置占位图 `@placeholder` */
  asset?: string;
  fit?: ImageNode['fit'];
}

export interface SketchSvg extends SketchElementBase {
  type: 'svg';
  rect: SketchBoxRect;
  /** 缺省是内置占位图 `@placeholder` */
  asset?: string;
}

export interface SketchShape extends SketchElementBase {
  type: 'shape';
  kind: 'rect' | 'ellipse';
  rect: SketchBoxRect;
}

export type SketchElement = SketchText | SketchImage | SketchSvg | SketchShape;

export interface SketchPlan {
  canvas: SketchCanvas;
  layers: SketchLayer[];
}

// ══════════════════════════════════════════════════════════════════════
// ② 默认值（先给一个最小可用版；以后由模板/设计 token 接管）
// ══════════════════════════════════════════════════════════════════════

/** 比例 → 基准画布（px）。AI 只选比例，不写宽高 */
const SKETCH_CANVASES: Record<SketchRatio, { width: number; height: number }> = {
  '1:1': { width: 1200, height: 1200 },
  '4:5': { width: 1080, height: 1350 },
  '3:4': { width: 1080, height: 1440 },
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
};

/** 草图的默认字号：画布宽的 2.2%（1200 画布 ≈ 26px）—— 后面由模板/模型覆盖 */
const DEFAULT_TEXT_FONT_SCALE = 0.022;
const DEFAULT_TEXT_FILL = '#111111';
const DEFAULT_FONT_FAMILY = 'Georgia, "Times New Roman", serif';
const DEFAULT_SHAPE_FILL = '#E5E7EB';
const DEFAULT_PLACEHOLDER_TEXT = '示例文字';

/** 内置占位图 id —— 见 `docs/PENDING-HARNESS-DOC-CONTEXT.md` §10 */
export const PLACEHOLDER_ASSET = '@placeholder';

// ══════════════════════════════════════════════════════════════════════
// ③ plan → intent
// ══════════════════════════════════════════════════════════════════════

export function planToIntent(plan: SketchPlan): DesignIntent {
  const { width: W, height: H } = SKETCH_CANVASES[plan.canvas.ratio];
  const canvas: Canvas = {
    width: W,
    height: H,
    background: plan.canvas.background ?? '#ffffff',
  };

  const layers: IntentLayer[] = plan.layers.map((layer, li) => {
    const children: IntentLayer[] = layer.elements.map((el, ei) => {
      const id = `el-${li + 1}-${ei + 1}`;
      const { x, y, w } = el.rect;
      // 文字没有 h；图片/svg/shape 有
      const h = 'h' in el.rect ? el.rect.h : 0;

      switch (el.type) {
        case 'text': {
          // 文字位置是 frame（0–1，无 h）；不产出 rect。
          const text: IntentTextNode = {
            id,
            type: 'text',
            name: el.name,
            frame: { x, y, w },
            align: el.align ?? 'left',
            ...(el.wrap ? { wrap: el.wrap } : {}),
            fill: DEFAULT_TEXT_FILL,
            fontFamily: DEFAULT_FONT_FAMILY,
            fontScale: el.fontScale ?? DEFAULT_TEXT_FONT_SCALE,
            runs: [{ text: el.placeholder?.trim() || DEFAULT_PLACEHOLDER_TEXT }],
          };
          return text;
        }
        case 'image': {
          const asset = el.asset?.trim() || PLACEHOLDER_ASSET;
          const image: IntentImageNode = {
            id,
            type: 'image',
            name: el.name,
            rect: { x, y, w, h },
            asset,
            // 占位图不裁切（contain）；真实素材默认 cover
            fit: el.fit ?? (asset === PLACEHOLDER_ASSET ? 'contain' : 'cover'),
          };
          return image;
        }
        case 'svg': {
          const svg: IntentSvgNode = {
            id,
            type: 'svg',
            name: el.name,
            rect: { x, y, w, h },
            asset: el.asset?.trim() || PLACEHOLDER_ASSET,
          };
          return svg;
        }
        case 'shape': {
          const shape: IntentShapeNode = {
            id,
            type: 'shape',
            kind: el.kind,
            name: el.name,
            rect: { x, y, w, h },
            fill: DEFAULT_SHAPE_FILL,
          };
          return shape;
        }
      }
    });

    // 用一个顶层 group 保留图层边界与 name；translate 的 wrapIntoLayers 会把它折回 Layer。
    const group: IntentGroupNode = {
      type: 'group',
      id: `layer-${li + 1}`,
      name: layer.name,
      children,
    };
    return group;
  });

  return { canvas, layers };
}

// ══════════════════════════════════════════════════════════════════════
// ④ AI 工具的 JSON Schema
// ══════════════════════════════════════════════════════════════════════

const TEXT_RECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'w'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number' },
  },
} as const;

const BOX_RECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'w', 'h'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number' },
    h: { type: 'number' },
  },
} as const;

const ELEMENT_BASE = {
  name: { type: 'string' },
} as const;

/**
 * `AgentTool.parameters` 用的 JSON Schema。
 *
 * ⚠️ 它是**草图契约的唯一一份**：`designharness/tools/sketch-plan.ts` 直接 import，
 * 不要手抄第二份。字段变更先改这里。
 */
export const sketchPlanJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['canvas', 'layers'],
  properties: {
    canvas: {
      type: 'object',
      additionalProperties: false,
      required: ['ratio'],
      properties: {
        ratio: { type: 'string', enum: SKETCH_RATIOS },
        background: { type: 'string' },
      },
    },
    layers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'elements'],
        properties: {
          name: { type: 'string' },
          elements: {
            type: 'array',
            items: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'name', 'rect'],
                  properties: {
                    type: { const: 'text' },
                    ...ELEMENT_BASE,
                    rect: TEXT_RECT_SCHEMA,
                    align: {
                      type: 'string',
                      enum: ['left', 'center', 'right', 'justify'],
                    },
                    wrap: {
                      type: 'string',
                      enum: ['normal', 'nowrap'],
                      description: '可选：换行。默认 normal（在 rect.w 内换行）；标题/标签要单行写 nowrap',
                    },
                    fontScale: {
                      type: 'number',
                      description: '可选：字号相对画布宽（0-1）；不写默认 0.022',
                    },
                    placeholder: { type: 'string' },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'name', 'rect'],
                  properties: {
                    type: { const: 'image' },
                    ...ELEMENT_BASE,
                    rect: BOX_RECT_SCHEMA,
                    asset: { type: 'string' },
                    fit: {
                      type: 'string',
                      enum: ['cover', 'contain', 'fill', 'none', 'scale-down'],
                    },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'name', 'rect'],
                  properties: {
                    type: { const: 'svg' },
                    ...ELEMENT_BASE,
                    rect: BOX_RECT_SCHEMA,
                    asset: { type: 'string' },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'kind', 'name', 'rect'],
                  properties: {
                    type: { const: 'shape' },
                    kind: { type: 'string', enum: ['rect', 'ellipse'] },
                    ...ELEMENT_BASE,
                    rect: BOX_RECT_SCHEMA,
                  },
                },
              ],
            },
          },
        },
      },
    },
  },
} as const;
