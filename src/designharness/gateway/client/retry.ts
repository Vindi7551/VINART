import { GatewayError } from './error';
import { fetchWithTimeout } from './http-client';

/** 需要重试的 HTTP 状态码集合 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

interface RetryOptions {
  /** 最大重试次数，默认 2 */
  retries?: number;
  /** 请求超时时间（ms），默认 60000 */
  timeout?: number;
}

/**
 * 带重试的 fetch 封装。
 *
 * 重试策略：
 * - 5xx / 429 → 指数退避重试（1s → 4s → 8s）
 * - 4xx（非 429）→ 直接抛 GatewayError，不重试
 * - 网络错误 / 超时 → 重试
 *
 * 内部委托给 fetchWithTimeout 做纯传输。
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeout?: number },
  opts: RetryOptions = {},
): Promise<Response> {
  const { retries = 2, timeout = 60_000 } = opts;
  let lastError: GatewayError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, { ...init, timeout });

      // 可重试的状态码，且还有重试次数 → 等待后重试
      if (RETRYABLE_STATUSES.has(response.status) && attempt < retries) {
        lastError = new GatewayError(
          `Retryable error: ${response.status}`,
          response.status,
          true,
        );
        await backoff(attempt);
        continue;
      }

      return response;
    } catch (err) {
      if (err instanceof GatewayError) {
        if (!err.retryable || attempt >= retries) throw err;
        lastError = err;
      } else {
        // 非 GatewayError → 不可重试，直接抛
        throw err;
      }

      if (attempt < retries) {
        await backoff(attempt);
      }
    }
  }

  throw lastError ?? new GatewayError('Request failed');
}

/** 指数退避延迟：第 0 次 1s，第 1 次 4s，第 2 次及以后 8s */
function backoff(attempt: number): Promise<void> {
  const delays = [1000, 4000, 8000];
  const ms = delays[attempt] ?? 8000;
  return new Promise((r) => setTimeout(r, ms));
}
