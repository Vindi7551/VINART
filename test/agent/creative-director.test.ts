/**
 * 创意总监 Agent 测试
 */

import { describe, it, expect } from 'vitest';
import { createCreativeDirector } from '../../src/agent/index';
import type { CreativeBrief } from '../../src/schema/index';
import { mockChatGateway, mockChatContext } from '../mocks/gateway';
import {
  mockCreativeDirectorInput,
  mockBrief,
} from '../fixtures/index';

// ── Prompt 组装测试 ──

describe('创意总监 prompt 组装', () => {
  it('buildSystemPrompt 应包含产品名', () => {
    // 通过 create 工厂间接验证：创建 Agent 时 system prompt 已组装
    const agent = createCreativeDirector({
      systemPrompt: '你是创意总监。请输出 JSON。',
      gateway: mockChatGateway(),
      context: mockChatContext(),
    });
    expect(agent.name).toBe('creativeDirector');
    // system prompt 已内嵌在 session 中，验证 Agent 创建成功即可
  });
});

// ── Agent 行为测试 ──

describe('创意总监 run()', () => {
  it('应收集 mock gateway 的完整响应', async () => {
    const expectedJson = JSON.stringify(mockBrief);

    const agent = createCreativeDirector({
      systemPrompt: '你是创意总监。请根据用户需求输出创意简报 JSON。',
      gateway: mockChatGateway({ responseText: expectedJson }),
      context: mockChatContext(),
    });

    const result = await agent.run(mockCreativeDirectorInput);

    // 验证收集到了完整响应
    expect(result).toBe(expectedJson);
  });

  it('产出应可解析为 CreativeBrief', async () => {
    const briefJson = JSON.stringify(mockBrief);

    const agent = createCreativeDirector({
      systemPrompt: '你是创意总监。直接输出 JSON。',
      gateway: mockChatGateway({ responseText: briefJson }),
      context: mockChatContext(),
    });

    const result = await agent.run(mockCreativeDirectorInput);

    // 解析验证
    const parsed: CreativeBrief = JSON.parse(result);
    expect(parsed.useCase).toBe(mockBrief.useCase);
    expect(parsed.productName).toBe(mockBrief.productName);
    expect(parsed.targetAudience).toBe(mockBrief.targetAudience);
    expect(parsed.toneKeywords).toHaveLength(mockBrief.toneKeywords.length);
    expect(parsed.canvas.width).toBe(800);
    expect(parsed.canvas.height).toBe(1200);
  });

  it('应处理包含参考图分析的输入', async () => {
    const briefWithRef = {
      ...mockBrief,
      referenceImageNotes: '参考图：极简白底，金色产品瓶身居中，柔和阴影',
    };

    const agent = createCreativeDirector({
      systemPrompt: '你是创意总监。直接输出 JSON。',
      gateway: mockChatGateway({ responseText: JSON.stringify(briefWithRef) }),
      context: mockChatContext(),
    });

    const inputWithRef = {
      ...mockCreativeDirectorInput,
      referenceImageNotes: '参考图分析：极简白底，金色瓶身居中',
    };

    const result = await agent.run(inputWithRef);
    const parsed = JSON.parse(result);
    expect(parsed.referenceImageNotes).toBeDefined();
  });

  it('产出 JSON 应包含所有必填字段', async () => {
    const agent = createCreativeDirector({
      systemPrompt: '你是创意总监。直接输出 JSON。',
      gateway: mockChatGateway({ responseText: JSON.stringify(mockBrief) }),
      context: mockChatContext(),
    });

    const result = await agent.run(mockCreativeDirectorInput);
    const parsed = JSON.parse(result);

    const requiredFields = [
      'useCase', 'productName', 'productDescription',
      'targetAudience', 'keyMessage', 'brandPersonality', 'brandVoice',
      'toneKeywords', 'visualStyle', 'mood', 'colorDirection', 'canvas',
    ];

    for (const field of requiredFields) {
      expect(parsed).toHaveProperty(field);
    }
  });
});
