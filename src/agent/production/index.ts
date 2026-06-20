/**
 * 制作 Agent（Production）
 *
 * 不是 LLM Agent。制作 Agent 是一个程序化步骤：
 * 1. 将素材回填到 HTML 的 data-image-slot 占位槽中
 * 2. 调用 Blink 渲染引擎生成最终成品图
 *
 * 这是管线的最后一步，产出用户看到的图片。
 */

import type { AssetBatch, CopyDeck } from '../../schema/index';

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
}

/** 制作 Agent 输入 */
export interface ProductionInput {
  /** 设计师产出的 HTML+CSS 代码（已含文案） */
  htmlCode: string;
  /** 文案集（备用：如果 HTML 中文案需要调整） */
  copyDeck: CopyDeck;
  /** 素材批次 */
  assetBatch: AssetBatch;
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
 * Blink 渲染的具体实现由 render 层提供，此处只定义接口。
 */
export function createProductionAgent(_config: ProductionConfig) {
  return {
    name: 'production',

    /**
     * 组装：回填素材 → 准备渲染。
     *
     * 1. 遍历 assetBatch 中的每个成功的 ImageAsset
     * 2. 在 HTML 中找到对应的 data-image-slot="slotId"
     * 3. 将占位 div 替换为 <img src="localPath">
     * 4. 保存最终 HTML
     * 5. 调用 Blink 渲染（TODO：对接 render 层）
     */
    assemble(input: ProductionInput): ProductionOutput {
      try {
        let html = input.htmlCode;

        // 回填素材
        for (const asset of input.assetBatch.assets) {
          if (asset.status !== 'completed' || !asset.localPath) {
            continue;
          }

          // 查找 data-image-slot="slotId" 的占位元素，替换为 img 标签
          const slotPattern = new RegExp(
            `<[^>]*data-image-slot="${escapeRegExp(asset.slotId)}"[^>]*>[\\s\\S]*?<\\/[^>]+>`,
            'gi',
          );

          const replacement = `<img src="${asset.localPath}"
            data-image-slot="${asset.slotId}"
            alt="${asset.slotType}"
            style="width:${asset.targetSize.width}px;height:${asset.targetSize.height}px;object-fit:cover;" />`;

          html = html.replace(slotPattern, replacement);
        }

        // 保存组装后的 HTML（TODO: 实际写文件 + Blink 渲染）
        // const htmlPath = `${outputDir}/index.html`;

        return {
          assembledHtml: html,
          success: true,
          // TODO: Blink 渲染
          // renderedImagePath = await renderBlink(htmlPath, outputDir, format)
        };
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

/** 转义正则特殊字符 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
