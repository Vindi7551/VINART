/**
 * generate_image — 素材师 Subagent
 *
 * 为指定槽位生成图片。非 LLM Agent，直接调用 ImageGateway。
 * 在 Node.js 环境保存文件到磁盘，浏览器环境仅返回 base64。
 */

import type { ImageGateway } from '../../gateway/index';
import type { Subagent } from '../runner';

export function createGenerateImage(config: {
  imageGateway: ImageGateway;
  outputDir: string;
  format?: 'png' | 'jpeg';
}): Subagent {
  const { imageGateway, outputDir, format = 'png' } = config;

  return {
    name: 'generate_image',

    async run(task: string): Promise<string> {
      const positivePrompt = [
        task,
        'high quality, detailed, professional product photography',
      ].join(', ');

      try {
        const result = await imageGateway.generate({
          prompt: positivePrompt,
          size: '2k',
          count: 1,
          format,
        });

        if (!result.images.length) {
          return '生成失败：API 未返回图片';
        }

        const imageUrl = result.images[0].url;
        const response = await fetch(imageUrl);
        if (!response.ok) {
          return `下载图片失败：HTTP ${response.status}`;
        }

        const buffer = await response.arrayBuffer();
        const base64 = btoa(
          Array.from(new Uint8Array(buffer))
            .map((b) => String.fromCharCode(b))
            .join(''),
        );

        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const dataUri = `data:${mime};base64,${base64}`;

        // 尝试保存到磁盘（Node.js 环境）
        if (typeof window === 'undefined') {
          try {
            const { mkdirSync, writeFileSync } = await import('fs');
            const { join } = await import('path');
            mkdirSync(outputDir, { recursive: true });
            const filename = `img-${Date.now()}.${format}`;
            const localPath = join(outputDir, filename);
            writeFileSync(localPath, Buffer.from(buffer));
            return [
              `图片已生成！`,
              `本地路径: ${localPath}`,
              `格式: ${format}, 大小: ${(buffer.byteLength / 1024).toFixed(1)} KB`,
              `Data URI (前 150 字符): ${dataUri.slice(0, 150)}...`,
            ].join('\n');
          } catch {
            // 回退到 data URI
          }
        }

        return [
          `图片已生成！`,
          `格式: ${format}, 大小: ${(buffer.byteLength / 1024).toFixed(1)} KB`,
          `Data URI: ${dataUri}`,
        ].join('\n');
      } catch (err) {
        return `生成失败：${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
