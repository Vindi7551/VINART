/**
 * 熔断器（Circuit Breaker）—— 经典三态机。
 *
 * 问题：provider 挂了之后，每个请求还要等它超时才知道，浪费了大量时间。
 * 方案：连续失败 N 次后直接跳过这个 provider，省掉等待时间。
 *
 * 三态流转：
 *   Closed ──(连续失败 ≥ threshold)──▶ Open
 *     ▲                                   │
 *     │                           (cooldown 结束)
 *     │                                   ▼
 *     └────────(探测成功)──── HalfOpen ◀──┘
 *          (探测失败 ──▶ Open，冷却时间翻倍)
 *
 * 空闲衰减：一段时间无请求后，失败计数自动 -1，逐步恢复正常。
 *
 * 参考：oxllm、Busbar 的熔断器实现。
 */

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerConfig {
  /** 触发熔断的连续失败次数，默认 3 */
  failureThreshold?: number;
  /** 熔断后的基础冷却时间（ms），默认 30_000 */
  baseCooldownMs?: number;
  /** 空闲衰减间隔（ms），该时间内无请求则失败计数 -1，默认 300_000（5 分钟） */
  idleDecayMs?: number;
}

interface CircuitBreaker {
  readonly name: string;
  readonly state: CircuitState;
  /** 包裹一个异步调用，自动管理熔断状态 */
  call<T>(fn: () => Promise<T>): Promise<T>;
}

export function createCircuitBreaker(
  name: string,
  config: CircuitBreakerConfig = {},
): CircuitBreaker {
  const {
    failureThreshold = 3,
    baseCooldownMs = 30_000,
    idleDecayMs = 300_000,
  } = config;

  let state: CircuitState = 'closed';
  let failureCount = 0;
  let consecutiveMultiplier = 0; // 连续熔断次数，控制冷却时间指数增长
  let cooldownUntil = 0;         // 冷却截止时间戳
  let lastRequestTime = 0;

  function transition(newState: CircuitState) {
    if (state === newState) return;
    state = newState;
  }

  function cooldownMs() {
    // 冷却时间：基础 × 2^连续熔断次数
    return baseCooldownMs * (2 ** consecutiveMultiplier);
  }

  function tryIdleDecay(now: number) {
    if (state !== 'closed') return;
    if (lastRequestTime === 0) return;
    if (failureCount === 0) return;

    // 超过 idleDecayMs 没有请求 → 失败计数 -1
    if (now - lastRequestTime >= idleDecayMs) {
      failureCount = Math.max(0, failureCount - 1);
    }
  }

  return {
    get name() { return name; },
    get state() { return state; },

    async call<T>(fn: () => Promise<T>): Promise<T> {
      const now = Date.now();

      // ── 空闲衰减 ──
      tryIdleDecay(now);
      lastRequestTime = now;

      // ── Open：检查冷却是否结束 ──
      if (state === 'open') {
        if (now < cooldownUntil) {
          throw new CircuitBreakerOpenError(
            name,
            `Circuit breaker "${name}" is open, cooldown until ${new Date(cooldownUntil).toISOString()}`,
          );
        }
        // 冷却结束 → HalfOpen，放一个探测请求
        transition('half-open');
      }

      // ── 执行请求 ──
      try {
        const result = await fn();

        // 成功 → 恢复
        if (state === 'half-open') {
          consecutiveMultiplier = 0; // 恢复后重置乘法因子
        }
        failureCount = 0;
        transition('closed');
        return result;
      } catch {
        failureCount++;

        if (state === 'half-open') {
          // HalfOpen 探测失败 → 回到 Open，增加冷却
          consecutiveMultiplier++;
          cooldownUntil = now + cooldownMs();
          transition('open');
        } else if (state === 'closed' && failureCount >= failureThreshold) {
          // Closed 连续失败达到阈值 → 熔断
          consecutiveMultiplier++;
          cooldownUntil = now + cooldownMs();
          transition('open');
        }

        throw new CircuitBreakerTrippedError(
          name,
          `Circuit breaker "${name}" tripped after ${failureCount} failures`,
        );
      }
    },
  };
}

// ── 错误类型 ──

/** 熔断器拒绝请求时抛出（Open 状态下被调用） */
export class CircuitBreakerOpenError extends Error {
  constructor(
    public readonly breakerName: string,
    message: string,
  ) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/** 熔断器因连续失败触发后抛出 */
export class CircuitBreakerTrippedError extends Error {
  constructor(
    public readonly breakerName: string,
    message: string,
  ) {
    super(message);
    this.name = 'CircuitBreakerTrippedError';
  }
}
