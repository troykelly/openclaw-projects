/**
 * Mock rate limit budget implementation.
 * Epic #2186, Issue #2202 — GitHub Issue Sync.
 *
 * Provides a simple in-memory implementation of the RateLimitBudget
 * interface for use until #2203 delivers the real rate limit management.
 * This mock always allows calls unless explicitly set to exhausted.
 */
import type { RateLimitBudget, RateLimitStatus } from './types.ts';

/**
 * In-memory mock of the RateLimitBudget interface.
 * Tracks remaining calls per namespace+resource pair.
 */
export class MockRateLimitBudget implements RateLimitBudget {
  private readonly state = new Map<string, RateLimitStatus>();

  private key(namespace: string, resource: string): string {
    return `${namespace}:${resource}`;
  }

  async checkRateLimit(namespace: string, resource: string): Promise<RateLimitStatus> {
    const existing = this.state.get(this.key(namespace, resource));
    if (existing) return existing;

    // Default: generous budget
    return {
      remaining: 5000,
      limit: 5000,
      resetsAt: new Date(Date.now() + 3600_000).toISOString(),
      isExhausted: false,
    };
  }

  async reserveBudget(namespace: string, resource: string, count: number): Promise<boolean> {
    const status = await this.checkRateLimit(namespace, resource);
    if (status.remaining < count) return false;

    this.state.set(this.key(namespace, resource), {
      ...status,
      remaining: status.remaining - count,
      isExhausted: status.remaining - count <= 0,
    });
    return true;
  }

  async recordApiCall(
    namespace: string,
    resource: string,
    remaining: number,
    limit: number,
    resetsAt: string,
  ): Promise<void> {
    this.state.set(this.key(namespace, resource), {
      remaining,
      limit,
      resetsAt,
      isExhausted: remaining <= 0,
    });
  }

  /**
   * Set rate limit state directly (for testing).
   * Allows tests to simulate exhausted rate limits.
   */
  setStatus(namespace: string, resource: string, status: RateLimitStatus): void {
    this.state.set(this.key(namespace, resource), status);
  }
}
