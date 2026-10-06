/**
 * Gateway 层通用错误类型。
 *
 * 区别于普通 Error，携带 HTTP 状态码、是否可重试、来源 Provider 等信息。
 * 贯穿传输层、重试层、降级层使用。
 */
export class GatewayError extends Error {
  constructor(
    message: string,
    /** HTTP 状态码（如为网络错误则为 undefined） */
    public readonly status?: number,
    /** 是否为可重试的错误（5xx / 429 / 网络错误） */
    public readonly retryable: boolean = false,
    /** 出错的 Provider 名称，用于日志定位 */
    public readonly providerName: string = 'unknown',
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}
