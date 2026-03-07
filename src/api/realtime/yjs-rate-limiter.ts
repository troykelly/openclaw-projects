/**
 * In-memory token bucket rate limiter for WebSocket Yjs messages.
 * Part of Issue #2256
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export class YjsRateLimiter {
  private buckets = new Map<string, Bucket>();
  private globalBuckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly globalLimit: number;

  constructor(limitPerSecond: number, globalLimitPerSecond?: number) {
    this.limit = limitPerSecond;
    this.globalLimit = globalLimitPerSecond ?? limitPerSecond * 2;
  }

  /** Returns true if the message is allowed for a specific client+note, false if rate-limited */
  allow(clientId: string, noteId: string): boolean {
    const key = `${clientId}:${noteId}`;
    return this.checkBucket(this.buckets, key, this.limit);
  }

  /** Returns true if the message is allowed for a connection globally, false if rate-limited */
  allowGlobal(clientId: string): boolean {
    return this.checkBucket(this.globalBuckets, clientId, this.globalLimit);
  }

  /** Remove all entries for a specific client (on disconnect) */
  cleanup(clientId: string): void {
    // Remove per-room buckets for this client
    for (const key of this.buckets.keys()) {
      if (key.startsWith(`${clientId}:`)) {
        this.buckets.delete(key);
      }
    }
    // Remove global bucket for this client
    this.globalBuckets.delete(clientId);
  }

  /** Remove all stale entries older than 5 seconds */
  cleanupStale(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.resetAt > 4000) {
        this.buckets.delete(key);
      }
    }
    for (const [key, bucket] of this.globalBuckets) {
      if (now - bucket.resetAt > 4000) {
        this.globalBuckets.delete(key);
      }
    }
  }

  /** Number of tracked entries (per-room buckets) */
  size(): number {
    return this.buckets.size;
  }

  private checkBucket(map: Map<string, Bucket>, key: string, limit: number): boolean {
    const now = Date.now();
    const bucket = map.get(key);

    if (!bucket || now >= bucket.resetAt) {
      map.set(key, { count: 1, resetAt: now + 1000 });
      return true;
    }

    if (bucket.count >= limit) {
      return false;
    }

    bucket.count++;
    return true;
  }
}
