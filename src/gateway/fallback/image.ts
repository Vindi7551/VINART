import type { ImageGenerateParams, ImageResult } from '../type/image';
import { GatewayError } from '../client/error';
import type { ImageProvider } from '../provider/interface';

/** 图片生成 Gateway：封装降级链条 */
export interface ImageGateway {
  generate(params: ImageGenerateParams): Promise<ImageResult>;
}

/** 创建 ImageGateway 实例，降级逻辑同 ChatGateway */
export function createImageGateway(providers: ImageProvider[]): ImageGateway {
  if (providers.length === 0) {
    throw new Error('At least one ImageProvider is required');
  }

  return {
    async generate(params: ImageGenerateParams) {
      for (const provider of providers) {
        try {
          return await provider.generate(params);
        } catch {
          // 当前 provider 失败 → 静默尝试下一个
        }
      }

      throw new GatewayError(
        `All ${providers.length} image provider(s) exhausted`,
        undefined,
        false,
        'image-gateway',
      );
    },
  };
}
