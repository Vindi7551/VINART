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
      // ⚠️ 必须把响应体带出来。
      // 很多 API 把真正的原因放在 body 里——内容审核拦截、参数不合法、
      // 模型名写错、额度不足——只看 status/statusText 是完全看不出来的。
      // 实测踩过：生图一直报 "HTTP 400: Bad Request"，真实原因是
      // {"error":{"code":"InputTextSensitiveContentDetected",...}}，被这里丢掉了。
      let detail = '';
      try {
        const text = await response.text();
        if (text) {
          try {
            const j = JSON.parse(text) as {
              error?: { message?: string; code?: string };
              message?: string;
            };
            detail = j.error?.message ?? j.error?.code ?? j.message ?? text.slice(0, 600);
          } catch {
            // 不是 JSON（可能是 HTML 错误页）→ 截断保留
            detail = text.slice(0, 600);
          }
        }
      } catch {
        // 读 body 本身失败时不能让它再抛错，否则会盖掉原始状态码信息
      }

      throw new GatewayError(
        `HTTP ${response.status}: ${response.statusText}${detail ? ` — ${detail}` : ''}`,
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
