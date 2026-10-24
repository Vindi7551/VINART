/**
 * **出图参数归一化** —— 前端传什么都不可信。
 *
 * 单独放一个文件（而不是塞在 `server/index.ts` 里）是为了**能直测**：
 * `index.ts` 一 import 就会 `server.listen()`，测试没法碰；这里只有纯函数。
 *
 * - `deviceScaleFactor` 夹到 1–4 的整数（4 已经很大，再高会吃内存）；
 * - `format` 只认 `png` / `jpeg`；
 * - `quality` 夹到 1–100，且只对 JPEG 有意义；
 * - `filename` **只留 basename**、去扩展名、过滤非法字符 —— 它会拼进落盘路径；
 * - `outputDir` 空 = 版式目录（由调用方兜底），非空留给 `resolve()`。
 */
import { sanitizeRenderFilename, type RenderFormat } from '../render/options';

export interface NormalizedRenderOptions {
  deviceScaleFactor: number;
  format: RenderFormat;
  quality: number;
  outputDir: string;
  filename: string;
}

export function normalizeRenderOptions(raw: unknown): NormalizedRenderOptions {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

  const deviceScaleFactor = Math.min(4, Math.max(1, Math.round(num(o.deviceScaleFactor, 2))));
  const format: RenderFormat = o.format === 'jpeg' ? 'jpeg' : 'png';
  const quality = Math.min(100, Math.max(1, Math.round(num(o.quality, 95))));

  const rawName = typeof o.filename === 'string' ? o.filename.trim() : 'final';
  const filename = sanitizeRenderFilename(rawName);

  const outputDir = typeof o.outputDir === 'string' ? o.outputDir.trim() : '';
  return { deviceScaleFactor, format, quality, outputDir, filename };
}
