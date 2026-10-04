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
      // 收集每个 provider 的失败原因。
      // ⚠️ 不能只抛"全部失败"——那会把真正的原因（如内容审核拦截、
      // 参数不合法、额度不足）全部吞掉，排查时只能瞎猜。
      // 实测踩过：生图报 "All 1 image provider(s) exhausted"，
      // 真实原因是 InputTextSensitiveContentDetected，被这层降级封装藏了。
      const failures: string[] = [];

      for (const provider of providers) {
        try {
          return await provider.generate(params);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push(`${provider.name}: ${msg}`);
        }
      }

      throw new GatewayError(
        `全部 ${providers.length} 个生图 provider 都失败：\n` +
          failures.map((f) => `  - ${f}`).join('\n'),
        undefined,
        false,
        'image-gateway',
      );
    },
  };
}
