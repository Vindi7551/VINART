/**
 * 图片嵌入工具
 *
 * 将 HTML 中的图片引用替换为 base64 data URI，
 * 生成零外部依赖、iframe 可直接渲染的 HTML。
 *
 * 处理三种情况：
 * 1. <img src="..."> → 读取文件，替换为 data URI
 * 2. <div data-image-slot="xxx"> 有对应图片 → 替换为 <img>
 * 3. <div data-image-slot="xxx"> 无对应图片 → 保留占位样式
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ImageRef {
  /** 槽位 ID */
  slotId: string;
  /** 本地图片路径 */
  localPath: string;
}

/**
 * 将 HTML 中的图片引用替换为 base64 data URI。
 *
 * @param html 源 HTML
 * @param images 已有的图片列表（slotId → localPath）
 * @returns 完全自包含的 HTML 字符串
 */
export function embedImagesInHtml(html: string, images: ImageRef[]): string {
  let result = html;
  const imageMap = new Map(images.map((img) => [img.slotId, img]));

  // 收集所有 data-image-slot 元素
  const slotPattern = /<(\w+)[^>]*data-image-slot="([^"]+)"[^>]*>/gi;
  const slotMatches: Array<{
    full: string;
    tag: string;
    slotId: string;
    index: number;
  }> = [];
  let match: RegExpExecArray | null;
  while ((match = slotPattern.exec(result)) !== null) {
    slotMatches.push({
      full: match[0],
      tag: match[1],
      slotId: match[2],
      index: match.index,
    });
  }

  // 从后往前替换（保持索引不变）
  for (let i = slotMatches.length - 1; i >= 0; i--) {
    const { full, tag, slotId, index } = slotMatches[i];
    const img = imageMap.get(slotId);

    if (img && fs.existsSync(img.localPath)) {
      const ext = path.extname(img.localPath).toLowerCase();
      const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
      const buffer = fs.readFileSync(img.localPath);
      const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;

      // 如果是 div 占位，替换为 img 标签
      if (tag.toLowerCase() === 'div') {
        // 保留原有 style 中的宽高信息
        const styleMatch = full.match(/style="([^"]*)"/);
        const styleAttrs = styleMatch
          ? styleMatch[1]
              .split(';')
              .filter((s) => s.trim())
              .filter(
                (s) =>
                  !s.trim().startsWith('background') &&
                  !s.trim().startsWith('bg'),
              )
              .join(';')
          : '';

        const replacement = `<img src="${dataUri}" data-image-slot="${slotId}" style="${styleAttrs};object-fit:cover;" alt="${slotId}" />`;
        result = result.slice(0, index) + replacement + result.slice(index + full.length);
      } else {
        // 已经是 img 标签，替换 src
        const updated = full.replace(/src="[^"]*"/, `src="${dataUri}"`);
        result = result.slice(0, index) + updated + result.slice(index + full.length);
      }
    }
    // 没有图片的槽位保持原样（占位 div 保留背景色）
  }

  return result;
}

/**
 * 从 AssetBatch 中提取已完成的图片引用。
 */
export function getCompletedImageRefs(
  assets: Array<{ slotId: string; status: string; localPath?: string }>,
): ImageRef[] {
  return assets
    .filter((a) => a.status === 'completed' && a.localPath)
    .map((a) => ({ slotId: a.slotId, localPath: a.localPath! }));
}
