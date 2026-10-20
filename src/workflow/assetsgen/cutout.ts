/**
 * 商品素材预处理（共享模块）
 *
 * 职责：
 *   1. 用 Chromium canvas **实测**商品照片里主体的真实边界框——不靠猜尺寸
 *   2. 按阈值法抠白底，得到带 alpha 的抠图
 *   3. 裁一块刻字区（供细节特写用）
 *   4. 产出一份压小的参考图（供生图模型当 referenceImages）
 *
 * 为什么必须实测边界：照片四周有白边，设计规格里的"商品占画布宽 X%"指的是
 * **商品本身**。不先量出边界就缩放，比例必然错。
 * （实测踩过：原以为照片是 1024×1024，实际 1254×1254、主体占宽 98.1%。）
 *
 * 阈值法为什么够用：商品照是**纯白背景 + 深色木板/黑支架**，
 * min(r,g,b) 低于 225 即为实体，高于 248 即为背景，中间线性过渡保边缘。
 * 这比 `mix-blend-mode: multiply` 正确——后者只变暗不遮挡，背景会透出来。
 */

import { readFileSync } from 'node:fs';

export interface ProductProbe {
  /** 原图尺寸 */
  natural: { W: number; H: number };
  /** 主体边界框 */
  bbox: { minX: number; minY: number; maxX: number; maxY: number; bw: number; bh: number };
  /** 刻字裁切区 */
  engraving: { ex: number; ey: number; ez: number };
  /** 抠图 alpha 分布，用于判断阈值是否合适 */
  alpha: { transparent: number; opaque: number; partial: number };
  /** 带 alpha 的完整抠图（含支架） */
  cut: string;
  /** 刻字区方形裁切（也带 alpha） */
  engravingCut: string;
  /** 白底 flatten 后压小的 jpeg，供生图模型当参考图 */
  ref: string;
}

/**
 * 量边界 + 抠图 + 裁刻字区 + 压参考图。全部在浏览器里用 canvas 完成，零额外依赖。
 *
 * @param page Playwright 的 Page
 * @param productPath 商品照片路径
 * @param refMax 参考图最长边上限
 */
export async function prepareProduct(
  // 用结构类型避免把 playwright 的类型依赖带进来
  page: { evaluate: <T>(fn: (arg: unknown) => T, arg: unknown) => Promise<T> },
  productPath: string,
  refMax = 768,
): Promise<ProductProbe> {
  const b64 = readFileSync(productPath).toString('base64');

  return page.evaluate(
    async (arg: unknown) => {
      const a = arg as { b64: string; max: number };
      const img = new Image();
      img.src = `data:image/png;base64,${a.b64}`;
      await img.decode();

      const full = document.createElement('canvas');
      full.width = img.naturalWidth;
      full.height = img.naturalHeight;
      const fctx = full.getContext('2d')!;
      fctx.drawImage(img, 0, 0);
      const W = full.width;
      const H = full.height;
      const px = fctx.getImageData(0, 0, W, H).data;

      // ── 1. 找非白像素的边界框 ──
      // 阈值 225：跳过商品照自带的柔和投影，否则投影会被算进主体，缩放比例偏小
      const TH = 225;
      let minX = W, minY = H, maxX = -1, maxY = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (px[i] < TH || px[i + 1] < TH || px[i + 2] < TH) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;

      const OPAQUE_AT = 225;
      const CLEAR_AT = 248;

      /** 对一块 canvas 做白底抠图，返回 alpha 统计 */
      const keyOut = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
        const id = ctx.getImageData(0, 0, w, h);
        const d = id.data;
        let transparent = 0, opaque = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mn = Math.min(d[i], d[i + 1], d[i + 2]);
          const alpha =
            mn <= OPAQUE_AT ? 255
            : mn >= CLEAR_AT ? 0
            : Math.round(255 * (1 - (mn - OPAQUE_AT) / (CLEAR_AT - OPAQUE_AT)));
          d[i + 3] = alpha;
          if (alpha === 0) transparent++;
          else if (alpha === 255) opaque++;
        }
        ctx.putImageData(id, 0, 0);
        const total = w * h;
        return { transparent: transparent / total, opaque: opaque / total, partial: 1 - (transparent + opaque) / total };
      };

      // ── 2. 抠图（主体本体）──
      const cut = document.createElement('canvas');
      cut.width = bw;
      cut.height = bh;
      const cctx = cut.getContext('2d')!;
      cctx.drawImage(img, minX, minY, bw, bh, 0, 0, bw, bh);
      const alpha = keyOut(cctx, bw, bh);

      // ── 3. 刻字区 ──
      // 目标通常是雕刻的母题部分，位于主体高度的上段。
      // 取 0.08 起、0.44 高：实测能覆盖 KLASSIKER 与 40，不会裁到下半部分的说明文案。
      const ez = Math.round(bh * 0.44);
      const ex = Math.round(minX + bw / 2 - ez / 2);
      const ey = Math.round(minY + bh * 0.08);
      const emb = document.createElement('canvas');
      emb.width = ez;
      emb.height = ez;
      const ectx = emb.getContext('2d')!;
      ectx.drawImage(img, ex, ey, ez, ez, 0, 0, ez, ez);
      keyOut(ectx, ez, ez);

      // ── 4. 压小的参考图（白底 flatten，避免透明区被模型误读）──
      const s = Math.min(1, a.max / Math.max(W, H));
      const rw = Math.max(1, Math.round(W * s));
      const rh = Math.max(1, Math.round(H * s));
      const rc = document.createElement('canvas');
      rc.width = rw;
      rc.height = rh;
      const rctx = rc.getContext('2d')!;
      rctx.fillStyle = '#fff';
      rctx.fillRect(0, 0, rw, rh);
      rctx.drawImage(img, 0, 0, rw, rh);

      return {
        natural: { W, H },
        bbox: { minX, minY, maxX, maxY, bw, bh },
        engraving: { ex, ey, ez },
        alpha,
        cut: cut.toDataURL('image/png'),
        engravingCut: emb.toDataURL('image/png'),
        ref: rc.toDataURL('image/jpeg', 0.9),
      } satisfies ProductProbe;
    },
    { b64, max: refMax },
  );
}

/** 把 data URL 写成文件 */
export function dataUrlToBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

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

