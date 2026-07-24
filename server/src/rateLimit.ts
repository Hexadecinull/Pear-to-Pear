/**
 * Minimal in-memory token bucket, keyed by IP. Only guards connection
 * *establishment* (new WebSocket handshakes and bond attempts) — it has
 * nothing to do with transfer throughput, which is governed separately by
 * the flow-control window in relay.ts.
 *
 * State lives in memory only and is never persisted. It resets on
 * restart, which is fine: this is abuse mitigation, not an accounting
 * system.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(
    private readonly maxPerMinute: number,
    private readonly cleanupIntervalMs = 5 * 60 * 1000,
  ) {
    const timer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    timer.unref?.();
  }

  /** Returns true if the request under `key` should be allowed. */
  allow(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.maxPerMinute, lastRefill: now };

    const elapsedMs = now - bucket.lastRefill;
    const refill = (elapsedMs / 60_000) * this.maxPerMinute;
    bucket.tokens = Math.min(this.maxPerMinute, bucket.tokens + refill);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }

    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > this.cleanupIntervalMs) {
        this.buckets.delete(key);
      }
    }
  }
}
