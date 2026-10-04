/**
 * Gateway 层统一入口（纯 barrel）。
 *
 * 目录结构：
 * - fallback/chat.ts   对话降级链（createChatGateway）
 * - fallback/image.ts  图片降级链（createImageGateway）
 * - client/error.ts       GatewayError
 * - client/http-client.ts  纯 HTTP 传输（fetch + 超时）
 * - client/sse-parser.ts   通用 SSE 流解析
 * - client/retry.ts        重试策略 + 指数退避
 * - provider/          协议适配器（ChatProvider / ImageProvider 接口 + 各实现）
 * - registry/            模型注册表（启动时注册所有模型）
 * - resilience/circuit-breaker.ts  熔断器（三态机）
 * - resilience/rate-limiter.ts     限流器（令牌桶）
 * - type/chat.ts       对话相关类型
 * - type/image.ts      图片生成相关类型
 */

// ── Provider 工厂 ──
export { createOpenAI } from './provider/openai';
export { createVolcanoArk } from './provider/volcano-ark';
export { createAnthropic } from './provider/anthropic';

// ── Provider 接口 ──
export type { ChatProvider, ImageProvider } from './provider/interface';

// ── Fallback / Gateway ──
export { createChatGateway } from './fallback/chat';
export type { ChatGateway } from './fallback/chat';
export { createImageGateway } from './fallback/image';
export type { ImageGateway } from './fallback/image';

// ── Registry ──
export { createRegistry } from './registry/registry';
export type { ModelRegistry } from './registry/registry';
export type { ModelEntry, ModelType, Protocol } from './registry/types';

// ── HTTP 传输 ──
export { GatewayError } from './client/error';
export { parseSSE } from './client/sse-parser';
export type { SSEEvent } from './client/sse-parser';

// ── 图片编码工具 ──
export { fileToDataUrl, bufferToDataUrl, isSupportedImagePath, SUPPORTED_IMAGE_EXTS } from './util/data-url';

// ── 治理 ──
export { createCircuitBreaker, CircuitBreakerOpenError, CircuitBreakerTrippedError } from './resilience/circuit-breaker';
export { createRateLimiter } from './resilience/rate-limiter';

// ── 类型：协议中立 ──
export type {
  ChatMessage,
  ChatRole,
  ChatChunk,
  ChatOptions,
  ContentPart,
  TextPart,
  ImagePart,
  VendorPart,
  TokenUsage,
  Attachment,
} from './type/chat';

// ── 类型：DeepSeek 专有 ──
export type {
  DeepSeekImageDetail,
  DeepSeekFilePart,
  DeepSeekFileRefPart,
  DeepSeekFileDataPart,
  DeepSeekContentPart,
  DeepSeekMessage,
} from './type/deepseek-chat';
export {
  DEEPSEEK_VISION_MODEL,
  DEEPSEEK_LEGACY_VISION_MODEL,
  DEEPSEEK_DEFAULT_IMAGE_DETAIL,
  DEEPSEEK_LIMITS,
  DEEPSEEK_IMAGE_TOKEN_COST,
} from './type/deepseek-chat';
export type { ImageGenerateParams, ImageResult } from './type/image';
