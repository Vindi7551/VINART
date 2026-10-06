/**
 * 限流器（Rate Limiter）—— 令牌桶算法（Token Bucket）。
 *
 * 问题：并发请求太多，直接触发 provider 的 429 限流，全部被拒。
 * 方案：控制请求速率，超出配额时排队或拒绝，防止被对方限流。
 *
 * 算法：桶里最多有 maxTokens 个令牌，按 refillInterval 间隔补充 refillRate 个。
 *       每次请求消耗 1 个令牌。桶空 → 拒绝或等待。
 *
 * 典型用法：
 *   // 每分钟最多 10 次生图
 *   const limiter = createRateLimiter({ maxTokens: 10, refillRate: 10, refillInterval: 60_000 });
 *   if (limiter.tryConsume()) { ... }  // 非阻塞
 *   await limiter.waitAndConsume();     // 阻塞等待
 */

interface RateLimiterConfig {
  /** 桶容量（最大突发请求数） */
  maxTokens: number;
  /** 每个 refillInterval 补充的令牌数，默认等于 maxTokens */
  refillRate?: number;
  /** 补充间隔（ms），默认 60_000 */
  refillInterval?: number;
}

interface RateLimiter {
  /** 当前桶里的令牌数 */
  readonly availableTokens: number;
  /** 尝试消费 1 个令牌，成功返回 true，桶空返回 false */
  tryConsume(): boolean;
  /** 等待直到有令牌可用，然后消费（非精确定时，适合非实时场景） */
  waitAndConsume(): Promise<void>;
}

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const { maxTokens, refillRate = maxTokens, refillInterval = 60_000 } = config;

  let tokens = maxTokens;
  let lastRefill = Date.now();

  function refill() {
    const now = Date.now();
    const elapsed = now - lastRefill;

    if (elapsed >= refillInterval) {
      // 补充令牌
      const cycles = Math.floor(elapsed / refillInterval);
      tokens = Math.min(maxTokens, tokens + refillRate * cycles);
      lastRefill += cycles * refillInterval;
    }
  }

  function tryConsume(): boolean {
    refill();
    if (tokens > 0) {
      tokens--;
      return true;
    }
    return false;
  }

  async function waitAndConsume(): Promise<void> {
    // 每 500ms 轮询一次直到有令牌
    while (!tryConsume()) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return {
    get availableTokens() {
      refill();
      return tokens;
    },
    tryConsume,
    waitAndConsume,
  };
}
