/**
 * 参考图缩放（共享模块）
 *
 * 把本地图片按最长边压成 JPEG data URL，供生图模型当 `referenceImages`。
 *
 * ⚠️ **分辨率不能压太低**：曾默认 768px，商品上的雕刻小字在参考图里读不清，
 * 生成时模型只能编造（畸形 / 截断 / "EMPF…"）。参考图是模型唯一的身份来源，
 * 宁可大一点——商品照按 2048，其它参考图按 1024。
 *
 * （2026-10-20：原来的商品抠图 `prepareProduct` 已删——商品照现在就是一张
 * 普通参考图，不再单独抠图 / 量边界。）
 */

import { readFileSync } from 'node:fs';

/** 把本地图片压成小尺寸 jpeg data URL，供参考图用 */
export async function downscaleToRef(
  page: { evaluate: <T>(fn: (arg: unknown) => T, arg: unknown) => Promise<T> },
  path: string,
  max = 1024,
): Promise<string> {
  const b64 = readFileSync(path).toString('base64');
  return page.evaluate(
    async (arg: unknown) => {
      const a = arg as { b64: string; max: number };
      const img = new Image();
      img.src = `data:image/png;base64,${a.b64}`;
      await img.decode();
      const s = Math.min(1, a.max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * s));
      const h = Math.max(1, Math.round(img.naturalHeight * s));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.9);
    },
    { b64, max },
  );
}
