// ── 图片生成相关类型 ──

/** 图片生成请求参数 */
export interface ImageGenerateParams {
  /** 生图提示词，中文或英文，≤300 汉字 */
  prompt: string;
  /** 参考图 URL 列表，用于图生图或保持风格一致（火山方舟最多 14 张） */
  referenceImages?: string[];
  /** 输出分辨率：2K / 3K / 4K 或具体像素如 2048x2048 */
  size?: string;
  /** 生成张数，默认 1 */
  count?: number;
  /** 输出格式，默认 png */
  format?: 'png' | 'jpeg';
}

/** 图片生成返回结果 */
export interface ImageResult {
  images: { url: string; size: string }[];
  usage: { generatedImages: number; totalTokens: number };
}
