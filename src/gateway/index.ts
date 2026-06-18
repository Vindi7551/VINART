/**
 * Gateway 层统一入口（纯 barrel）。
 *
 * 目录结构：
 * - fallback/chat.ts   对话降级链（createChatGateway）
 * - fallback/image.ts  图片降级链（createImageGateway）
 * - client/error.ts       GatewayError
 * - client/http-client.ts  纯 HTTP 传输（fetch + 超时）
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

// ── 治理 ──
export { createCircuitBreaker, CircuitBreakerOpenError, CircuitBreakerTrippedError } from './resilience/circuit-breaker';
export { createRateLimiter } from './resilience/rate-limiter';

// ── 类型 ──
export type { ChatMessage, ChatChunk, ChatOptions } from './type/chat';
export type { ImageGenerateParams, ImageResult } from './type/image';
