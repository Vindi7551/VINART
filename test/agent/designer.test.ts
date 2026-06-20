/**
 * 设计师 Agent 测试
 */

import { describe, it, expect } from 'vitest';
import { createDesigner } from '../../src/agent/index';
import { mockChatGateway, mockChatContext } from '../mocks/gateway';
import { mockDesignerInput } from '../fixtures/index';

// ── HTML + SlotManifest 产出测试 ──

describe('设计师 Agent', () => {
  const mockHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<style>
:root {
  --color-bg: #FAF7F2;
  --color-text: #2C2420;
  --color-accent: linear-gradient(135deg, #D4A853, #F2D98B);
}
body {
  margin: 0;
  width: 800px;
  height: 1200px;
  font-family: system-ui, sans-serif;
  background: var(--color-bg);
}
.hero { position: relative; height: 480px; }
.product { display: flex; padding: 48px; gap: 32px; }
</style>
</head>
<body>
<div class="hero">
  <div data-vinart-type="image-slot" data-vinart-id="hero-bg"
       data-image-slot="hero-bg"
       style="width:800px;height:480px;background:#eee;"></div>
  <h1 class="headline" data-vinart-type="headline" data-vinart-id="main-title">7天亮起来</h1>
</div>
<section class="product">
  <div data-vinart-type="image-slot" data-vinart-id="product-hero-1"
       data-image-slot="product-hero-1"
       style="width:440px;height:440px;background:#f0f0f0;
              border-radius:12px;overflow:hidden;"></div>
  <div class="info">
    <p data-vinart-type="body" data-vinart-id="main-body">焕亮精华 · 温和不刺激</p>
    <button class="cta" data-vinart-type="cta" data-vinart-id="buy-btn">立即选购</button>
  </div>
</section>
</body></html>`;

  const mockSlotManifest = {
    slots: [
      {
        id: 'hero-bg',
        slotType: 'hero-bg',
        width: 800,
        height: 480,
        content: {
          subject: '柔和光影背景',
          background: '暖调渐变',
          composition: '全幅',
          lighting: '柔和散射光',
        },
        visualConstraint: {
          blendMode: 'soft-light',
          colorOverlay: 'rgba(0,0,0,0.05)',
        },
        priority: 'normal',
      },
      {
        id: 'product-hero-1',
        slotType: 'product-hero',
        width: 440,
        height: 440,
        content: {
          subject: '精华液瓶身特写',
          background: '纯白背景',
          composition: '45度角侧拍',
          lighting: '柔和侧光',
        },
        visualConstraint: {
          filterStyle: 'brightness(1.05) contrast(1.1)',
        },
        priority: 'high',
      },
    ],
    totalCount: 2,
  };

  const fullResponse = [
    '```html',
    mockHtml,
    '```',
    '===SLOTS===',
    '```json',
    JSON.stringify(mockSlotManifest, null, 2),
    '```',
  ].join('\n');

  it('应分离产出 HTML 和槽位清单', async () => {
    const agent = createDesigner({
      systemPrompt: '你是设计师。输出 HTML + 槽位清单。',
      gateway: mockChatGateway({ responseText: fullResponse }),
      context: mockChatContext(),
    });

    const result = await agent.run(mockDesignerInput);

    // 应包含分隔符
    expect(result).toContain('===SLOTS===');

    // 应包含 HTML 代码块
    expect(result).toContain('```html');
    expect(result).toContain('```json');

    // 应包含 data-vinart-* 标记
    expect(result).toContain('data-vinart-type="image-slot"');
    expect(result).toContain('data-vinart-id="hero-bg"');
    expect(result).toContain('data-vinart-type="headline"');
    expect(result).toContain('data-vinart-type="cta"');
    // 应包含 data-image-slot（与 data-vinart-id 一致）
    expect(result).toContain('data-image-slot="hero-bg"');
    expect(result).toContain('data-image-slot="product-hero-1"');
  });

  it('HTML 部分应包含 CSS 变量和语义化标签', async () => {
    const agent = createDesigner({
      systemPrompt: '你是设计师。',
      gateway: mockChatGateway({ responseText: fullResponse }),
      context: mockChatContext(),
    });

    const result = await agent.run(mockDesignerInput);

    expect(result).toContain(':root');
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('<style>');
    // 语义化标签
    expect(result).toContain('<body>');
  });

  it('槽位清单应可解析且包含必填字段', async () => {
    const agent = createDesigner({
      systemPrompt: '你是设计师。',
      gateway: mockChatGateway({ responseText: fullResponse }),
      context: mockChatContext(),
    });

    const result = await agent.run(mockDesignerInput);

    // 提取 JSON 部分
    const jsonMatch = result.match(/```json\s*([\s\S]*?)```/);
    expect(jsonMatch).not.toBeNull();

    const manifest = JSON.parse(jsonMatch![1]);
    expect(manifest.slots).toHaveLength(2);
    expect(manifest.totalCount).toBe(2);

    for (const slot of manifest.slots) {
      expect(slot).toHaveProperty('id');
      expect(slot).toHaveProperty('slotType');
      expect(slot).toHaveProperty('width');
      expect(slot).toHaveProperty('height');
      expect(slot).toHaveProperty('content');
      expect(slot.content).toHaveProperty('subject');
    }
  });

  it('HTML 中 data-image-slot ID 应与槽位清单一致', async () => {
    const agent = createDesigner({
      systemPrompt: '你是设计师。',
      gateway: mockChatGateway({ responseText: fullResponse }),
      context: mockChatContext(),
    });

    const result = await agent.run(mockDesignerInput);

    const jsonMatch = result.match(/```json\s*([\s\S]*?)```/);
    const manifest = JSON.parse(jsonMatch![1]);

    // 每个 slot.id 都应在 HTML 中出现
    for (const slot of manifest.slots) {
      expect(result).toContain(`data-image-slot="${slot.id}"`);
    }
  });
});
