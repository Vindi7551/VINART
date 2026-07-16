/**
 * 制作 Agent（Production）
 *
 * 不是 LLM Agent。制作 Agent 是一个程序化步骤：
 * 1. 将素材回填到 HTML 的 data-image-slot 占位槽中
 * 2. 调用 Blink 渲染引擎生成最终成品图
 *
 * 这是管线的最后一步，产出用户看到的图片。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AssetBatch, CopyDeck } from '../../schema/index';
import type { BlinkRenderer } from '../../render/index';
import { embedImagesInHtml, getCompletedImageRefs } from '../../render/index';

// ══════════════════════════════════════════
// 配置
// ══════════════════════════════════════════

export interface ProductionConfig {
  /** 渲染输出目录 */
  outputDir: string;
  /** 输出图片格式 */
  format?: 'png' | 'jpeg';
  /** 输出图片质量（jpeg 时有效） */
  quality?: number;
  /** Blink 渲染器实例 */
  renderer?: BlinkRenderer;
}

/** 制作 Agent 输入 */
export interface ProductionInput {
  /** 设计师产出的 HTML+CSS 代码（已含文案） */
  htmlCode: string;
  /** 文案集（备用：如果 HTML 中文案需要调整） */
  copyDeck: CopyDeck;
  /** 素材批次 */
  assetBatch: AssetBatch;
  /** 画布尺寸 */
  canvas?: { width: number; height: number };
}

/** 制作 Agent 产出 */
export interface ProductionOutput {
  /** 回填素材后的最终 HTML */
  assembledHtml: string;
  /** 渲染出的成品图路径（Blink 渲染后填充） */
  renderedImagePath?: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

// ══════════════════════════════════════════
// 制作 Agent
// ══════════════════════════════════════════

/**
 * 创建制作 Agent。
 *
 * 纯程序化步骤，不涉及 LLM 调用。
 * 如果提供了 BlinkRenderer，组装完成后自动渲染为成品图。
 */
export function createProductionAgent(config: ProductionConfig) {
  const { outputDir, format = 'png', quality = 95, renderer } = config;

  return {
    name: 'production',

    /**
     * 组装：回填素材 → 保存 HTML → Blink 渲染。
     */
    async assemble(input: ProductionInput): Promise<ProductionOutput> {
      try {
        fs.mkdirSync(outputDir, { recursive: true });

        // 1. 使用 embedImagesInHtml 回填素材
        const imageRefs = getCompletedImageRefs(input.assetBatch.assets);
        let html = embedImagesInHtml(input.htmlCode, imageRefs);

        // 2. 保存组装后的 HTML
        const htmlPath = path.join(outputDir, 'index.html');
        fs.writeFileSync(htmlPath, html, 'utf-8');

        const result: ProductionOutput = {
          assembledHtml: html,
          success: true,
        };

        // 3. Blink 渲染
        if (renderer) {
          const width = input.canvas?.width ?? 800;
          const height = input.canvas?.height ?? 1200;

          const renderOutput = await renderer.render(
            { html: htmlPath, isFilePath: true },
            outputDir,
            { width, height, deviceScaleFactor: 2, format, quality },
          );

          result.renderedImagePath = renderOutput.imagePath;
        }

        return result;
      } catch (err) {
        return {
          assembledHtml: input.htmlCode,
          success: false,
          error: err instanceof Error ? err.message : 'Assembly failed',
        };
      }
    },
  };
}
