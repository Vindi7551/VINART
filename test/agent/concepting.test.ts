/**
 * 概念阶段配对（美术指导 + 文案）测试
 */

import { describe, it, expect } from 'vitest';
import { createConceptingPair } from '../../src/agent/index';
import { mockChatGateway, mockChatContext } from '../mocks/gateway';
import { mockBrief } from '../fixtures/index';

// ── 收敛测试 ──

describe('概念阶段配对', () => {
  it('双方产出 [已确定] 时应提前收敛', async () => {
    // 模拟第一轮就双方确认的响应
    const round1Response = [
      '【美术指导】',
      '{ "layout": {}, "colorSystem": {}, "typography": {}, "frameSystem": {}, "spacing": {}, "imageTreatments": [], "visualElements": {}, "atmosphere": "test" }',
      '[已确定]',
      '',
      '【文案】',
      '{ "items": [], "strategy": "test", "toneCalibration": "test" }',
      '[已确定]',
    ].join('\n');

    const pair = createConceptingPair({
      gateway: mockChatGateway({ responseText: round1Response }),
      context: mockChatContext(),
      maxRounds: 5,
    });

    const result = await pair.run(mockBrief);

    // 应只跑了 1 轮就收敛
    expect(result.roundsUsed).toBe(1);
    expect(result.forcedConvergence).toBe(false);
    expect(result.visualDirectionRaw).toContain('layout');
    expect(result.copyDeckRaw).toContain('items');
  });

  it('未 [已确定] 时应跑到 maxRounds', async () => {
    // 模拟永远不确认的响应
    const noConfirmResponse = [
      '【美术指导】',
      '{ "layout": {}, "atmosphere": "still adjusting" }',
      '',
      '【文案】',
      '{ "items": [], "strategy": "needs work", "toneCalibration": "test" }',
    ].join('\n');

    const pair = createConceptingPair({
      gateway: mockChatGateway({ responseText: noConfirmResponse }),
      context: mockChatContext(),
      maxRounds: 3,
    });

    const result = await pair.run(mockBrief);

    // 应跑满 3 轮
    expect(result.roundsUsed).toBe(3);
    expect(result.forcedConvergence).toBe(true);
  });

  it('maxRounds 默认值应为 5', async () => {
    const noConfirm = [
      '【美术指导】',
      '{ "atmosphere": "wip" }',
      '',
      '【文案】',
      '{ "items": [] }',
    ].join('\n');

    const pair = createConceptingPair({
      gateway: mockChatGateway({ responseText: noConfirm }),
      context: mockChatContext(),
      // 不传 maxRounds，应默认 5
    });

    const result = await pair.run(mockBrief);
    expect(result.roundsUsed).toBe(5);
  });

  it('美术指导产出应包含视觉方向关键字段', async () => {
    const artDirOutput = JSON.stringify({
      layout: { zones: [], visualFlow: 'top-down', focalPoint: 'hero' },
      colorSystem: { tokens: [], assignment: {}, description: 'warm' },
      typography: { styles: [], assignment: {}, description: 'clean' },
      frameSystem: { styles: [] },
      spacing: { baseUnit: 8, strategy: 'moderate' },
      imageTreatments: [],
      visualElements: {},
      atmosphere: '温暖高级',
    });

    const response = [
      '【美术指导】',
      artDirOutput,
      '[已确定]',
      '',
      '【文案】',
      JSON.stringify({ items: [], strategy: 'test', toneCalibration: 'test' }),
      '[已确定]',
    ].join('\n');

    const pair = createConceptingPair({
      gateway: mockChatGateway({ responseText: response }),
      context: mockChatContext(),
    });

    const result = await pair.run(mockBrief);

    // 美术指导产出应包含所有 VisualDirection 顶层字段
    const visualDir = JSON.parse(result.visualDirectionRaw);
    expect(visualDir).toHaveProperty('layout');
    expect(visualDir).toHaveProperty('colorSystem');
    expect(visualDir).toHaveProperty('typography');
    expect(visualDir).toHaveProperty('frameSystem');
    expect(visualDir).toHaveProperty('spacing');
    expect(visualDir).toHaveProperty('atmosphere');
  });

  it('文案产出应包含 CopyDeck 关键字段', async () => {
    const copyDeck = JSON.stringify({
      items: [
        { role: 'headline', primary: '测试标题', alternatives: [] },
      ],
      strategy: '测试策略',
      toneCalibration: '测试语气',
    });

    const response = [
      '【美术指导】',
      JSON.stringify({ atmosphere: 'test', layout: {}, colorSystem: {}, typography: {}, frameSystem: {}, spacing: {}, imageTreatments: [], visualElements: {} }),
      '[已确定]',
      '',
      '【文案】',
      copyDeck,
      '[已确定]',
    ].join('\n');

    const pair = createConceptingPair({
      gateway: mockChatGateway({ responseText: response }),
      context: mockChatContext(),
    });

    const result = await pair.run(mockBrief);

    const parsed = JSON.parse(result.copyDeckRaw);
    expect(parsed).toHaveProperty('items');
    expect(parsed).toHaveProperty('strategy');
    expect(parsed).toHaveProperty('toneCalibration');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].role).toBe('headline');
  });
});
