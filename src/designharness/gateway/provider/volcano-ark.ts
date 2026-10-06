import { fetchWithRetry } from '../client/retry';
import { GatewayError } from '../client/error';
import type { ImageProvider } from './interface';
import type { ImageGenerateParams, ImageResult } from '../type/image';

interface VolcanoArkConfig {
  /** API 基础地址，默认 https://ark.cn-beijing.volces.com/api/v3 */
  baseURL: string;
  /** 模型 ID，如 doubao-seedream-5-0-260128 */
  model: string;
  apiKey: string;
}

/**
 * 创建火山方舟图片生成 Provider 实例。
 *
 * 适配豆包 Seedream 系列模型。火山方舟使用自有 API 格式，非 OpenAI 兼容。
 *
 * 注意事项：
 * - 生成的图片 URL 24 小时内有效，生产环境需下载转存
 * - 支持传入参考图（image 参数）做图生图或风格保持
 * - 支持组图模式（sequential_image_generation）一次生成多张
 */
export function createVolcanoArk(config: VolcanoArkConfig): ImageProvider {
  const { baseURL, model, apiKey } = config;
  const endpoint = `${baseURL}/images/generations`;

  return {
    name: `volcano-ark:${model}`,

    async generate(params: ImageGenerateParams): Promise<ImageResult> {
      // 组装请求体（火山方舟自有格式）
      const body: Record<string, unknown> = {
        model,
        prompt: params.prompt,
        size: params.size ?? '2K',
        output_format: params.format ?? 'png',
        watermark: false,
        response_format: 'url',
      };

      // 参考图：单张传字符串，多张传数组
      if (params.referenceImages?.length) {
        body.image = params.referenceImages.length === 1
          ? params.referenceImages[0]
          : params.referenceImages;
      }

      if (params.count && params.count > 1) {
        body.n = params.count;
      }

      const response = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          timeout: 120_000, // 生图超时设置更长
        },
        { retries: 1 },
      );

      const json = await response.json();

      if (!json.data?.length) {
        throw new GatewayError(
          `Image generation returned no data: ${JSON.stringify(json)}`,
          response.status,
          false,
          config.model,
        );
      }

      return {
        model: json.model ?? model,
        images: json.data.map((d: { url: string; size?: string }) => ({
          url: d.url,
          size: d.size ?? 'unknown',
        })),
        usage: {
          generatedImages: json.usage?.generated_images ?? json.data.length,
          totalTokens: json.usage?.total_tokens ?? 0,
        },
      };
    },
  };
}
