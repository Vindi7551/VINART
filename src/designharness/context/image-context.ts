import type { ImageGenerateParams } from '../gateway/type/image';

/** 生图上下文配置 */
export interface ImageContextConfig {
  /** 默认输出分辨率，默认 '2K' */
  defaultSize?: string;
  /** 默认输出格式，默认 'png' */
  defaultFormat?: 'png' | 'jpeg';
  /** 提示词最大字符数，默认 300 */
  maxPromptLength?: number;
  /** 参考图最大张数，默认 14（火山方舟限制） */
  maxReferenceImages?: number;
}

/** 组装好的生图请求参数 */
export interface ImageBuildResult {
  params: ImageGenerateParams;
  /** 校验警告（非致命问题） */
  warnings: string[];
}

/**
 * 生图上下文管理器。
 *
 * 职责：
 * 1. 填充默认参数（size、format、count）
 * 2. 校验参数合法性（prompt 长度、参考图数量）
 * 3. 参考图 URL → base64 转换（provider 不需要再处理）
 * 4. 产生警告但不阻止请求（过长截断、过多丢弃、下载失败跳过）
 */
export interface ImageContext {
  build(partial: Partial<ImageGenerateParams>): Promise<ImageBuildResult>;
}

export function createImageContext(config: ImageContextConfig = {}): ImageContext {
  const {
    defaultSize = '2K',
    defaultFormat = 'png',
    maxPromptLength = 300,
    maxReferenceImages = 14,
  } = config;

  return {
    async build(partial) {
      const warnings: string[] = [];
      let prompt = partial.prompt ?? '';
      let referenceImages = partial.referenceImages?.slice() ?? [];

      // 1. 校验 prompt 长度
      if (prompt.length > maxPromptLength) {
        prompt = prompt.slice(0, maxPromptLength);
        warnings.push(`Prompt 超过 ${maxPromptLength} 字，已截断`);
      }
      if (!prompt.trim()) {
        throw new Error('Prompt is required');
      }

      // 2. 校验参考图数量
      if (referenceImages.length > maxReferenceImages) {
        referenceImages = referenceImages.slice(0, maxReferenceImages);
        warnings.push(`参考图超过 ${maxReferenceImages} 张，已丢弃多余`);
      }

      // 3. URL → base64 转换（已是 base64 的跳过）
      const encoded: string[] = [];
      for (const url of referenceImages) {
        if (url.startsWith('data:')) {
          encoded.push(url); // 已经是 base64
          continue;
        }
        try {
          const dataUrl = await urlToBase64(url);
          encoded.push(dataUrl);
        } catch {
          warnings.push(`参考图下载失败，已跳过: ${url}`);
        }
      }

      const params: ImageGenerateParams = {
        prompt,
        size: partial.size ?? defaultSize,
        format: partial.format ?? defaultFormat,
        count: partial.count ?? 1,
        referenceImages: encoded.length > 0 ? encoded : undefined,
      };

      return { params, warnings };
    },
  };
}

/** 下载网络图片并转为 data: URL */
async function urlToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const contentType = response.headers.get('Content-Type') ?? 'image/png';
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // 手动 base64 编码（避免 btoa 对二进制数据的中文编码问题）
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return `data:${contentType};base64,${btoa(binary)}`;
}
