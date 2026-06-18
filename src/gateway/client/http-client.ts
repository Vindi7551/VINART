import { GatewayError } from './error';

/**
 * 纯 HTTP 传输：fetch + AbortController 超时控制。
 *
 * 不做重试、不做错误分类——那些是 retry.ts 的职责。
 * 调用方通过 AbortController signal 或 timeout 参数控制超时。
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeout?: number },
): Promise<Response> {
  const { timeout = 60_000, ...fetchInit } = init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchInit,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new GatewayError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        false,
      );
    }

    return response;
  } catch (err) {
    clearTimeout(timer);

    if (err instanceof GatewayError) throw err;

    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new GatewayError(`Request timed out after ${timeout}ms`, undefined, true);
    }

    if (err instanceof TypeError) {
      throw new GatewayError(`Network error: ${err.message}`, undefined, true);
    }

    throw err;
  }
}
