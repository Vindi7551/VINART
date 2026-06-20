/**
 * 测试夹具 —— 所有 Agent 测试共用的模拟输入数据。
 */

import type {
  CreativeBrief,
  VisualDirection,
  CopyDeck,
  SlotSpec,
  ImageAsset,
  AssetBatch,
} from '../../src/schema/index';
import type { CreativeDirectorInput } from '../../src/agent/index';
import type { DesignerInput } from '../../src/agent/index';
import type { IllustratorInput } from '../../src/agent/index';
import type { ProductionInput } from '../../src/agent/index';

// ══════════════════════════════════
// 创意总监输入
// ══════════════════════════════════

export const mockCreativeDirectorInput: CreativeDirectorInput = {
  description: '做一张护肤精华液电商促销海报，突出"7天焕亮"卖点',
  productName: '焕亮精华液',
  productDescription: '温和焕亮配方，7天改善暗沉，适合敏感肌',
  useCase: '电商促销海报',
};

// ══════════════════════════════════
// 创意简报（模拟创意总监产出）
// ══════════════════════════════════

export const mockBrief: CreativeBrief = {
  useCase: '电商促销海报',
  productName: '焕亮精华液',
  productDescription: '温和焕亮配方，7天改善暗沉，适合敏感肌',
  targetAudience: '25-35岁都市女性，关注护肤但追求温和产品',
  keyMessage: '7天亮起来，温和不刺激',
  brandPersonality: '简约奢华',
  brandVoice: '专业克制',
  toneKeywords: ['轻盈', '纯粹', '焕亮', '温和'],
  visualStyle: '极简奢华，暖调底色',
  mood: '温暖亲切，高品质感',
  colorDirection: '暖调大地色 + 金色点缀',
  canvas: { width: 800, height: 1200 },
  mustInclude: ['产品瓶身', '品牌logo', 'CTA按钮'],
  mustAvoid: ['过度装饰', '荧光色', '复杂背景'],
};

// ══════════════════════════════════
// 视觉方向（模拟美术指导产出）
// ══════════════════════════════════

export const mockVisualDirection: VisualDirection = {
  layout: {
    zones: [
      {
        name: 'hero-header',
        proportion: '2/5',
        arrangement: '居中堆叠',
        elements: [
          { type: 'image-slot', placement: '全宽背景', frameStyle: 'hero-bg', imageContent: '柔和光影背景，暖调渐变' },
          { type: 'headline', placement: '居中偏上', note: '标题突出，独占一行' },
          { type: 'subheadline', placement: '标题下方居中', note: '字号比标题小两档' },
        ],
      },
      {
        name: 'product-showcase',
        proportion: '2/5',
        arrangement: '左右分栏',
        elements: [
          { type: 'image-slot', placement: '左侧 55%', frameStyle: 'product-frame', imageContent: '精华液瓶身特写，45度角，柔和侧光' },
          { type: 'body', placement: '右侧 45% 顶部', note: '产品卖点文字' },
          { type: 'cta', placement: '右侧底部', note: '按钮居中' },
        ],
      },
    ],
    visualFlow: '从上到下，先看产品再看文字',
    focalPoint: 'hero 区的产品主图',
  },
  colorSystem: {
    tokens: [
      { name: 'warm-gold', stops: [{ hex: '#D4A853', position: 0 }, { hex: '#F2D98B', position: 1 }], gradientAngle: 135 },
      { name: 'cream-bg', stops: [{ hex: '#FAF7F2' }] },
      { name: 'dark-text', stops: [{ hex: '#2C2420' }] },
      { name: 'soft-white', stops: [{ hex: '#FFFFFF' }] },
    ],
    assignment: {
      headline: 'warm-gold',
      subheadline: 'dark-text',
      body: 'dark-text',
      background: 'cream-bg',
      ctaBackground: 'warm-gold',
      ctaText: 'soft-white',
    },
    description: '暖调奶油基底 + 金色渐变点缀，温暖高级',
  },
  typography: {
    styles: [
      { name: 'hero-headline', fontFamily: ['serif'], fontSize: 42, fontWeight: 700, letterSpacing: '0.02em', textAlign: 'center' },
      { name: 'subtitle', fontFamily: ['system-ui'], fontSize: 18, fontWeight: 400, textAlign: 'center' },
      { name: 'body-text', fontFamily: ['system-ui'], fontSize: 14, fontWeight: 400, lineHeight: 1.8 },
      { name: 'cta-button', fontFamily: ['system-ui'], fontSize: 16, fontWeight: 600, textTransform: 'uppercase' },
    ],
    assignment: { headline: 'hero-headline', subheadline: 'subtitle', body: 'body-text', cta: 'cta-button' },
    description: '标题衬线突出品质，正文无衬线保证可读性',
  },
  frameSystem: {
    styles: [
      {
        name: 'hero-bg',
        shape: 'sharp-square',
        borderRadius: '0',
        overflow: 'hidden',
        intent: '全宽背景容器，承载柔和光影',
      },
      {
        name: 'product-frame',
        shape: 'rounded-rect',
        borderRadius: '12px',
        shadow: '0 8px 32px rgba(0,0,0,0.08)',
        overflow: 'hidden',
        intent: '产品主图容器，圆角柔和突出品质感',
      },
    ],
  },
  spacing: { baseUnit: 8, strategy: 'moderate', sectionGap: '48px', containerPadding: '48px' },
  imageTreatments: [
    { slotType: 'hero-bg', blendMode: 'soft-light', colorOverlay: 'rgba(0,0,0,0.05)', note: '背景柔和融入' },
    { slotType: 'product-hero', filterStyle: 'brightness(1.05) contrast(1.1)', note: '产品图干净还原' },
  ],
  visualElements: { shadows: '轻柔投影', borderRadius: '产品框 12px，按钮 24px', decorativeStyle: '几何光晕' },
  atmosphere: '温暖、高级、不张扬的奢华感',
};

// ══════════════════════════════════
// 文案集（模拟文案产出）
// ══════════════════════════════════

export const mockCopyDeck: CopyDeck = {
  items: [
    {
      role: 'headline',
      primary: '7天亮起来',
      alternatives: [
        { text: '焕亮新肌', flavor: 'short' },
        { text: '7天焕亮，见证肌肤新生', flavor: 'descriptive' },
      ],
      layoutHint: '建议独占一行，不折行',
    },
    {
      role: 'subheadline',
      primary: '焕亮精华 · 温和不刺激',
      alternatives: [{ text: '敏感肌也安心', flavor: 'short' }],
    },
    {
      role: 'body',
      primary: '蕴含温和焕亮成分，7天改善暗沉。专为敏感肌研发，轻盈质地，深层滋养。',
    },
    {
      role: 'cta',
      primary: '立即选购',
      alternatives: [
        { text: '了解更多', flavor: 'casual' },
        { text: '限时抢购', flavor: 'punchy' },
      ],
      layoutHint: '按钮文字，不超过 4 字',
    },
  ],
  strategy: '以"亮"和"温和"为核心锚点，建立信任感',
  toneCalibration: '专业但不冰冷，温暖有品质感',
};

// ══════════════════════════════════
// 设计师输入
// ══════════════════════════════════

export const mockDesignerInput: DesignerInput = {
  visualDirection: mockVisualDirection,
  copyDeck: mockCopyDeck,
  canvas: { width: 800, height: 1200 },
};

// ══════════════════════════════════
// 槽位规格（模拟设计师产出的一部分）
// ══════════════════════════════════

export const mockSlot: SlotSpec = {
  id: 'product-hero-1',
  slotType: 'product-hero',
  width: 440,
  height: 440,
  content: {
    subject: '焕亮精华液瓶身特写',
    background: '纯白背景',
    composition: '45度角侧拍，居中',
    lighting: '柔和侧光，左侧主光源',
  },
  visualConstraint: {
    filterStyle: 'brightness(1.05) contrast(1.1)',
    colorNotes: '保持瓶身金色标签还原，不要偏色',
  },
  priority: 'high',
};

// ══════════════════════════════════
// 素材师输入
// ══════════════════════════════════

export const mockIllustratorInput: IllustratorInput = {
  slot: mockSlot,
  brief: mockBrief,
  treatment: mockVisualDirection.imageTreatments[1],
};

// ══════════════════════════════════
// 素材产出（模拟素材师产出）
// ══════════════════════════════════

export const mockImageAsset: ImageAsset = {
  slotId: 'product-hero-1',
  slotType: 'product-hero',
  targetSize: { width: 440, height: 440 },
  status: 'completed',
  localPath: '/tmp/test-output/product-hero-1.png',
  image: { base64: '', mimeType: 'image/png', width: 440, height: 440 },
  generationMeta: {
    model: 'test-model',
    positivePrompt: '焕亮精华液瓶身特写, 纯白背景, 45度角侧拍 居中, 柔和侧光 左侧主光源...',
  },
};

export const mockAssetBatch: AssetBatch = {
  assets: [mockImageAsset],
  completedCount: 1,
  failedCount: 0,
  allCompleted: true,
};

// ══════════════════════════════════
// 制作输入
// ══════════════════════════════════

export const mockHtmlCode = `<!DOCTYPE html>
<html><head><style>:root{--color-bg:#FAF7F2}</style></head>
<body>
  <div data-vinart-type="image-slot" data-vinart-id="product-hero-1" data-image-slot="product-hero-1" style="width:440px;height:440px;background:#eee;"></div>
  <h1 data-vinart-type="headline" data-vinart-id="main-title">7天亮起来</h1>
  <p data-vinart-type="subheadline" data-vinart-id="main-subtitle">焕亮精华 · 温和不刺激</p>
  <button data-vinart-type="cta" data-vinart-id="buy-btn">立即选购</button>
</body></html>`;

export const mockProductionInput: ProductionInput = {
  htmlCode: mockHtmlCode,
  copyDeck: mockCopyDeck,
  assetBatch: mockAssetBatch,
};
