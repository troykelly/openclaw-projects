/**
 * In-memory identity resolution cache with TTL (#1580).
 *
 * Caches the mapping: email → { contactId, userId, grants } for 60 seconds.
 * This avoids redundant DB queries on every authenticated request.
 */

const DEFAULT_TTL_MS = 60_000; // 60 seconds

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class IdentityCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Remove expired entries. Call periodically to prevent memory leaks. */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }
}
