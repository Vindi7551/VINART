/**
 * assemble — 制作 Subagent
 *
 * 最后一步：将 HTML 和图片组装为最终成品。
 * Node.js 环境：保存 HTML + Blink 渲染为 PNG。
 * 浏览器环境：仅返回自包含 HTML（iframe 预览即渲染）。
 */

import type { Subagent } from '../runner';
import type { BlinkRenderer } from '../../render/index';

export function createAssemble(config: {
  outputDir: string;
  renderer?: BlinkRenderer;
}): Subagent {
  const { outputDir, renderer } = config;

  return {
    name: 'assemble',

    async run(_task: string): Promise<string> {
      const isNode = typeof window === 'undefined';

      if (!isNode) {
        return '浏览器环境：无需额外组装，HTML 已在预览面板中渲染。如需导出成品图，请在服务端调用 assemble。';
      }

      try {
        const { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } = await import('fs');
        const { join, extname, basename } = await import('path');
        const { embedImagesInHtml } = await import('../../render/index');

        mkdirSync(outputDir, { recursive: true });

        // 扫描已有图片
        const images: Array<{ slotId: string; localPath: string }> = [];
        try {
          for (const file of readdirSync(outputDir)) {
            const ext = extname(file).toLowerCase();
            if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
              images.push({ slotId: basename(file, ext), localPath: join(outputDir, file) });
            }
          }
        } catch { /* 目录为空 */ }

        // 查找 HTML
        const htmlFiles = readdirSync(outputDir)
          .filter((f) => f.endsWith('.html'))
          .map((f) => ({ name: f, mtime: statSync(join(outputDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);

        if (htmlFiles.length === 0) {
          return '组装失败：找不到 HTML 文件。';
        }

        const htmlPath = join(outputDir, htmlFiles[0].name);
        let html = readFileSync(htmlPath, 'utf-8');

        // 嵌入图片
        if (images.length > 0) {
          html = embedImagesInHtml(html, images);
        }

        const assembledPath = join(outputDir, 'assembled.html');
        writeFileSync(assembledPath, html, 'utf-8');

        const lines = [`组装完成！自包含 HTML: ${assembledPath}`];

        // Blink 渲染
        if (renderer) {
          const width = 800;
          const height = 1200;
          const result = await renderer.render(
            { html: assembledPath, isFilePath: true },
            outputDir,
            { width, height, deviceScaleFactor: 2, format: 'png' },
          );
          lines.push(
            `成品图: ${result.imagePath}`,
            `分辨率: ${result.width}×${result.height}px`,
            `文件大小: ${(result.size / 1024).toFixed(1)} KB`,
          );
        }

        return lines.join('\n');
      } catch (err) {
        return `组装失败：${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
