import * as fs from 'fs';
import * as path from 'path';
import type { ImageGateway } from '../../gateway/index';
import type { ImageAsset } from '../../schema/index';
import type { IllustratorInput } from './prompt';
import { buildPositivePrompt, buildNegativePrompt } from './prompt';

// ══════════════════════════════════════════
// 配置
// ══════════════════════════════════════════

export interface IllustratorConfig {
  /** 图片生成网关 */
  imageGateway: ImageGateway;
  /** 素材保存目录（绝对路径） */
  outputDir: string;
  /** 输出格式 */
  format?: 'png' | 'jpeg';
}

// ══════════════════════════════════════════
// 素材师 Agent
// ══════════════════════════════════════════

/**
 * 素材师 Agent。
 *
 * 不是标准的 Agent<TInput,TOutput> —— 素材师不使用 ChatSession，
 * 而是直接调用 ImageGateway 生成图片。
 *
 * 每个槽位创建一个实例，执行一次 generate()，返回 ImageAsset。
 * 编排器 fork N 个实例并行运行。
 *
 * 职责：
 * 1. 将 SlotSpec 翻译为 vision 模型的 prompt
 * 2. 调用 ImageGateway 生成图片
 * 3. 从返回 URL 下载图片 → 重命名为 {slotId}.{format} → 保存到 outputDir
 * 4. 产出 ImageAsset（含本地路径 + base64）
 */
export function createIllustrator(config: IllustratorConfig) {
  const { imageGateway, outputDir, format = 'png' } = config;

  return {
    name: 'illustrator',

    async generate(input: IllustratorInput): Promise<ImageAsset> {
      const { slot, brief, treatment } = input;

      const positivePrompt = buildPositivePrompt(slot, brief, treatment);
      const negativePrompt = buildNegativePrompt(slot, brief);
      const localPath = path.join(outputDir, `${slot.id}.${format}`);
      const mimeType = format === 'png' ? 'image/png' as const : 'image/jpeg' as const;

      const asset: ImageAsset = {
        slotId: slot.id,
        slotType: slot.slotType,
        targetSize: { width: slot.width, height: slot.height },
        status: 'failed',
        localPath,
        generationMeta: {
          model: 'unknown',
          positivePrompt,
          negativePrompt,
          durationMs: undefined,
        },
      };

      const startedAt = Date.now();

      try {
        // 1. 调用图片生成 API
        const result = await imageGateway.generate({
          prompt: positivePrompt,
          size: '2K',
          count: 1,
          format,
        });

        asset.generationMeta!.durationMs = Date.now() - startedAt;
        asset.generationMeta!.model = result.model ?? 'unknown';

        if (!result.images.length) {
          asset.failureReason = 'No images returned from gateway';
          return asset;
        }

        const imageUrl = result.images[0].url;

        // 2. 下载图片
        const response = await fetch(imageUrl);
        if (!response.ok) {
          asset.failureReason = `Download failed: HTTP ${response.status}`;
          return asset;
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        // 3. 保存到本地，命名为 {slotId}.{format}
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(localPath, buffer);

        // 4. 读 base64
        const base64 = buffer.toString('base64');
        const actualSize = result.images[0].size;
        const [actualW = slot.width, actualH = slot.height] = actualSize
          ? actualSize.split('x').map(Number)
          : [];

        asset.status = 'completed';
        asset.image = {
          base64,
          mimeType,
          sourceUrl: imageUrl,
          width: actualW,
          height: actualH,
        };
      } catch (err) {
        asset.failureReason = err instanceof Error ? err.message : 'Unknown error';
      }

      return asset;
    },
  };
}
