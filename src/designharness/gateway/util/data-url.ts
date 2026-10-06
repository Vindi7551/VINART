/**
 * 图片编码工具：本地文件 / Buffer → base64 data URL。
 *
 * 为什么需要它：
 * 视觉模型要求图片以 data URL 或公网 URL 的形式传入。项目里的图片在本地磁盘，
 * 所以必须先编码成 `data:image/png;base64,<B64>` 才能塞进 messages。
 *
 * 实测成本参考（1024×1024 PNG，1.96 MB）：
 *   原始文件      1.96 MB
 *   base64 后     2.61 MB   ← 膨胀约 33%
 *   data URL 全长 2.74 MB   ← 计入 48 MiB 请求体上限
 *   视觉 token    ≈ 930（detail: 'original'）
 *
 * 若同一张图要在多个请求里反复引用，改用 Files API 上传成 file_id 更划算
 * （省掉每次约 2.6 MB 的传输，但 token 成本不变）。
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

/** 扩展名 → MIME。注意：服务端按文件字节判断格式，此处 MIME 仅用于拼 data URL */
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** 模型支持的图片格式（与服务端一致） */
export const SUPPORTED_IMAGE_EXTS = Object.keys(MIME_BY_EXT);

/** Buffer → data URL */
export function bufferToDataUrl(buf: Buffer | Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
}

/**
 * 本地图片文件 → data URL。
 *
 * @param filePath 绝对路径
 * @throws 扩展名不在支持列表时抛错（避免把非图片当图片发出去）
 */
export function fileToDataUrl(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new Error(
      `不支持的图片格式 "${ext}"，支持：${SUPPORTED_IMAGE_EXTS.join(' / ')}（文件：${filePath}）`,
    );
  }
  return bufferToDataUrl(readFileSync(filePath), mime);
}

/** 该扩展名是否是可发送的图片 */
export function isSupportedImagePath(filePath: string): boolean {
  return extname(filePath).toLowerCase() in MIME_BY_EXT;
}
