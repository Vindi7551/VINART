/**
 * 素材师 Agent 测试
 */

import { describe, it, expect } from 'vitest';
import { createIllustrator, buildPositivePrompt, buildNegativePrompt } from '../../src/agent/index';
import { mockImageGateway } from '../mocks/gateway';
import { mockIllustratorInput, mockSlot, mockBrief } from '../fixtures/index';

// ── Prompt 构建测试 ──

describe('素材师 prompt 构建', () => {
  it('正向 prompt 应包含主体、背景、构图、光影', () => {
    const prompt = buildPositivePrompt(mockSlot, mockBrief);

    expect(prompt).toContain('焕亮精华液瓶身特写');
    expect(prompt).toContain('纯白背景');
    expect(prompt).toContain('45度角侧拍');
    expect(prompt).toContain('柔和侧光');
  });

  it('正向 prompt 应包含风格和氛围关键词', () => {
    const prompt = buildPositivePrompt(mockSlot, mockBrief);

    expect(prompt).toContain(mockBrief.visualStyle);
    expect(prompt).toContain(mockBrief.mood);
    expect(prompt).toContain(mockBrief.colorDirection);
  });

  it('正向 prompt 应包含质量词', () => {
    const prompt = buildPositivePrompt(mockSlot, mockBrief);

    expect(prompt).toContain('high quality');
    expect(prompt).toContain('detailed');
  });

  it('正向 prompt 应包含目标尺寸', () => {
    const prompt = buildPositivePrompt(mockSlot, mockBrief);

    expect(prompt).toContain('440x440');
  });

  it('负向 prompt 应包含通用排除项', () => {
    const negative = buildNegativePrompt(mockSlot, mockBrief);

    expect(negative).toContain('blurry');
    expect(negative).toContain('low quality');
    expect(negative).toContain('watermark');
    expect(negative).toContain('text');
    expect(negative).toContain('logo');
  });

  it('负向 prompt 应包含 brief.mustAvoid', () => {
    const briefWithAvoid = {
      ...mockBrief,
      mustAvoid: ['荧光色', '复杂背景', '过度装饰'],
    };
    const negative = buildNegativePrompt(mockSlot, briefWithAvoid);

    expect(negative).toContain('荧光色');
    expect(negative).toContain('复杂背景');
  });

  it('有 ImageTreatment 时正向 prompt 应包含滤镜信息', () => {
    // 使用带 treatment 的输入
    const prompt = buildPositivePrompt(
      mockSlot,
      mockBrief,
      mockIllustratorInput.treatment,
    );

    // treatment.filterStyle 内容应出现在 prompt 中
    expect(prompt).toContain('brightness');
  });
});

// ── Agent 行为测试 ──

describe('素材师 generate()', () => {
  it('成功生成时应返回 completed 状态', async () => {
    const illustrator = createIllustrator({
      imageGateway: mockImageGateway({
        imageUrl: 'https://mock.example.com/product-hero-1.png',
        imageSize: '440x440',
      }),
      outputDir: '/tmp/test-output',
    });

    const result = await illustrator.generate(mockIllustratorInput);

    expect(result.status).toBe('completed');
    expect(result.slotId).toBe('product-hero-1');
    expect(result.generationMeta).toBeDefined();
    expect(result.generationMeta?.positivePrompt).toContain('焕亮精华液');
    expect(result.generationMeta?.negativePrompt).toContain('blurry');
  });

  it('应记录生成元信息', async () => {
    const illustrator = createIllustrator({
      imageGateway: mockImageGateway(),
      outputDir: '/tmp/test-output',
    });

    const result = await illustrator.generate(mockIllustratorInput);

    expect(result.generationMeta).toBeDefined();
    expect(result.generationMeta?.positivePrompt).toBeTruthy();
    expect(result.generationMeta?.negativePrompt).toBeTruthy();
    expect(result.generationMeta?.durationMs).toBeDefined();
  });

  it('localPath 应按 {slotId}.{format} 命名', async () => {
    const illustrator = createIllustrator({
      imageGateway: mockImageGateway(),
      outputDir: '/tmp/test-output',
      format: 'png',
    });

    const result = await illustrator.generate(mockIllustratorInput);

    expect(result.localPath).toBe('/tmp/test-output/product-hero-1.png');
  });

  it('gateway 返回空图片列表时应失败', async () => {
    const illustrator = createIllustrator({
      imageGateway: {
        async generate() {
          return { images: [], usage: { generatedImages: 0, totalTokens: 0 } };
        },
      } as any,
      outputDir: '/tmp/test-output',
    });

    const result = await illustrator.generate(mockIllustratorInput);

    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('No images');
  });

  it('gateway 抛出异常时应返回失败状态', async () => {
    const illustrator = createIllustrator({
      imageGateway: {
        async generate() {
          throw new Error('API rate limit exceeded');
        },
      } as any,
      outputDir: '/tmp/test-output',
    });

    const result = await illustrator.generate(mockIllustratorInput);

    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('API rate limit');
  });
});
