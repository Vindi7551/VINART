/**
 * 制作 Agent 测试
 */

import { describe, it, expect } from 'vitest';
import { createProductionAgent } from '../../src/agent/index';
import { mockProductionInput, mockHtmlCode } from '../fixtures/index';
import type { AssetBatch } from '../../src/schema/index';

describe('制作 Agent', () => {
  it('应回填成功的素材到 HTML 占位槽', () => {
    const production = createProductionAgent({ outputDir: '/tmp/test-output' });
    const output = production.assemble(mockProductionInput);

    expect(output.success).toBe(true);

    // 回填后应包含 <img> 标签
    expect(output.assembledHtml).toContain('<img');
    // 应保留 slot id 属性
    expect(output.assembledHtml).toContain('data-image-slot="product-hero-1"');
    // 应引用正确的本地文件
    expect(output.assembledHtml).toContain('product-hero-1.png');
    // 应设置正确的宽高
    expect(output.assembledHtml).toContain('width:440px');
    expect(output.assembledHtml).toContain('height:440px');
  });

  it('失败的素材不应影响其他槽位', () => {
    // 用包含两个槽位的 HTML
    const htmlWithTwoSlots = `<!DOCTYPE html>
<html><head><style>:root{--bg:#fff}</style></head>
<body>
  <div data-image-slot="hero-bg" style="width:800px;height:480px;background:#eee;"></div>
  <div data-image-slot="product-hero-1" style="width:440px;height:440px;background:#eee;"></div>
</body></html>`;

    const batchWithFailure: AssetBatch = {
      assets: [
        {
          slotId: 'hero-bg',
          slotType: 'hero-bg',
          targetSize: { width: 800, height: 480 },
          status: 'failed',
          failureReason: 'timeout',
        },
        {
          slotId: 'product-hero-1',
          slotType: 'product-hero',
          targetSize: { width: 440, height: 440 },
          status: 'completed',
          localPath: '/tmp/test-output/product-hero-1.png',
        },
      ],
      completedCount: 1,
      failedCount: 1,
      allCompleted: false,
    };

    const input = {
      htmlCode: htmlWithTwoSlots,
      copyDeck: mockProductionInput.copyDeck,
      assetBatch: batchWithFailure,
    };
    const production = createProductionAgent({ outputDir: '/tmp/test-output' });
    const output = production.assemble(input);

    expect(output.success).toBe(true);

    // hero-bg 占位应保留（因为是失败的素材）
    expect(output.assembledHtml).toContain('data-image-slot="hero-bg"');
    // product-hero-1 应被替换
    expect(output.assembledHtml).toContain('product-hero-1.png');
  });

  it('空素材批次不应修改 HTML', () => {
    const emptyBatch: AssetBatch = {
      assets: [],
      completedCount: 0,
      failedCount: 0,
      allCompleted: true,
    };

    const input = { ...mockProductionInput, assetBatch: emptyBatch };
    const production = createProductionAgent({ outputDir: '/tmp/test-output' });
    const output = production.assemble(input);

    expect(output.success).toBe(true);
    // HTML 保持不变（不包括 <img> 因为没有素材回填）
    expect(output.assembledHtml).toBe(mockHtmlCode);
  });

  it('回填后应保留其他 HTML 内容不变', () => {
    const production = createProductionAgent({ outputDir: '/tmp/test-output' });
    const output = production.assemble(mockProductionInput);

    // 原有文案应保留
    expect(output.assembledHtml).toContain('7天亮起来');
    expect(output.assembledHtml).toContain('焕亮精华');
    expect(output.assembledHtml).toContain('立即选购');
    // CSS 应保留
    expect(output.assembledHtml).toContain(':root');
    expect(output.assembledHtml).toContain('--color-bg');
  });
});
