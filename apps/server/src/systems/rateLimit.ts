/**
 * Token bucket per key: up to `burst` actions at once, then one more every
 * `refillMs`. Used for chat and reactions.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly burst: number,
    private readonly refillMs: number,
  ) {}

  /** True if `key` may act now (and uses up one token). */
  allow(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.burst, updatedAt: now };
    b.tokens = Math.min(this.burst, b.tokens + (now - b.updatedAt) / this.refillMs);
    b.updatedAt = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  forget(key: string): void {
    this.buckets.delete(key);
  }
}
