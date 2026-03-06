/**
 * GitHub Rate Limit Management.
 * Issue #2203 — GitHub Rate Limit Management.
 *
 * Tracks X-RateLimit-Remaining and X-RateLimit-Reset from GitHub API responses.
 * Stores in symphony_github_rate_limit table.
 * Exports a clean API surface for consumers (#2202 etc.):
 *   - checkRateLimit(pool, namespace, resource)
 *   - reserveBudget(pool, namespace, resource, count)
 *   - recordApiCall(pool, namespace, resource, response)
 *
 * P3-3: This module owns rate limit infrastructure.
 * #2202 (GitHub Issue Sync) and other callers consume it.
 */

import type { Pool } from 'pg';
import {
  symphonyGithubRateRemaining,
  symphonyGithubApiCallsTotal,
} from './metrics.ts';

// ─── Types ───

/** Rate limit status for a resource (e.g., 'core', 'search', 'graphql'). */
export interface RateLimitStatus {
  /** Remaining API calls before rate limit resets. */
  remaining: number;
  /** Total limit for this resource. */
  limit: number;
  /** When the rate limit resets (UTC). */
  resetsAt: Date;
  /** Whether the resource is currently rate-limited (remaining <= reserve). */
  isLimited: boolean;
}

/** Parsed rate limit headers from a GitHub API response. */
export interface GitHubRateLimitHeaders {
  /** X-RateLimit-Remaining */
  remaining: number;
  /** X-RateLimit-Limit */
  limit: number;
  /** X-RateLimit-Reset (Unix epoch seconds) */
  resetEpoch: number;
  /** X-RateLimit-Resource (e.g., 'core', 'search', 'graphql') */
  resource: string;
}

/** Default minimum quota reserved for critical operations. */
const DEFAULT_RESERVE = 100;

// ─── Header Parsing ───

/**
 * Parse rate limit headers from a GitHub API response.
 * Returns null if headers are missing or invalid.
 */
export function parseRateLimitHeaders(
  headers: Record<string, string | undefined>,
): GitHubRateLimitHeaders | null {
  const remaining = headers['x-ratelimit-remaining'];
  const limit = headers['x-ratelimit-limit'];
  const reset = headers['x-ratelimit-reset'];
  const resource = headers['x-ratelimit-resource'];

  if (!remaining || !limit || !reset) {
    return null;
  }

  const parsedRemaining = parseInt(remaining, 10);
  const parsedLimit = parseInt(limit, 10);
  const parsedReset = parseInt(reset, 10);

  if (isNaN(parsedRemaining) || isNaN(parsedLimit) || isNaN(parsedReset)) {
    return null;
  }

  return {
    remaining: parsedRemaining,
    limit: parsedLimit,
    resetEpoch: parsedReset,
    resource: resource || 'core',
  };
}

// ─── Database Operations ───

/**
 * Check the current rate limit status for a resource.
 *
 * @param pool      Database connection pool.
 * @param namespace Namespace scope.
 * @param resource  GitHub API resource (e.g., 'core', 'search').
 * @param reserve   Minimum calls to reserve for critical ops. Default: 100.
 * @returns Rate limit status, or null if no data tracked yet.
 */
export async function checkRateLimit(
  pool: Pool,
  namespace: string,
  resource: string,
  reserve: number = DEFAULT_RESERVE,
): Promise<RateLimitStatus | null> {
  const result = await pool.query<{
    remaining: number;
    limit: number;
    resets_at: Date;
  }>(
    `SELECT remaining, "limit", resets_at
     FROM symphony_github_rate_limit
     WHERE namespace = $1 AND resource = $2`,
    [namespace, resource],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const now = new Date();

  // If the reset time has passed, the limit has reset
  if (row.resets_at <= now) {
    return {
      remaining: row.limit,
      limit: row.limit,
      resetsAt: row.resets_at,
      isLimited: false,
    };
  }

  return {
    remaining: row.remaining,
    limit: row.limit,
    resetsAt: row.resets_at,
    isLimited: row.remaining <= reserve,
  };
}

/**
 * Reserve API call budget. Decrements remaining count.
 * Returns true if budget was reserved, false if insufficient budget.
 *
 * @param pool      Database connection pool.
 * @param namespace Namespace scope.
 * @param resource  GitHub API resource (e.g., 'core', 'search').
 * @param count     Number of API calls to reserve.
 * @param reserve   Minimum calls to keep in reserve. Default: 100.
 * @returns True if reservation succeeded, false if rate-limited.
 */
export async function reserveBudget(
  pool: Pool,
  namespace: string,
  resource: string,
  count: number,
  reserve: number = DEFAULT_RESERVE,
): Promise<boolean> {
  // Check if we have enough budget
  const status = await checkRateLimit(pool, namespace, resource, reserve);

  if (!status) {
    // No rate limit data yet — allow the call (first call will record data)
    return true;
  }

  // If reset time has passed, allow
  if (status.resetsAt <= new Date()) {
    return true;
  }

  // Check if we have enough budget above the reserve
  if (status.remaining - count < reserve) {
    return false;
  }

  // Decrement remaining
  const result = await pool.query(
    `UPDATE symphony_github_rate_limit
     SET remaining = remaining - $1
     WHERE namespace = $2
       AND resource = $3
       AND remaining >= $1 + $4`,
    [count, namespace, resource, reserve],
  );

  if (result.rowCount === 0) {
    return false;
  }

  // Update Prometheus metric
  symphonyGithubRateRemaining.set({ namespace, resource }, status.remaining - count);

  return true;
}

/**
 * Record a GitHub API call response. Updates the rate limit tracking table
 * with the latest headers from the response.
 *
 * @param pool      Database connection pool.
 * @param namespace Namespace scope.
 * @param resource  GitHub API resource (e.g., 'core', 'search').
 * @param headers   Parsed rate limit headers from the response.
 */
export async function recordApiCall(
  pool: Pool,
  namespace: string,
  resource: string,
  headers: GitHubRateLimitHeaders,
): Promise<void> {
  const resetsAt = new Date(headers.resetEpoch * 1000);

  await pool.query(
    `INSERT INTO symphony_github_rate_limit
       (namespace, resource, remaining, "limit", resets_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (namespace, resource)
     DO UPDATE SET
       remaining = EXCLUDED.remaining,
       "limit" = EXCLUDED."limit",
       resets_at = EXCLUDED.resets_at`,
    [namespace, resource, headers.remaining, headers.limit, resetsAt],
  );

  // Update Prometheus metrics
  symphonyGithubRateRemaining.set({ namespace, resource }, headers.remaining);
  symphonyGithubApiCallsTotal.inc();
}

// ─── Polling Distribution ───

/**
 * Calculate an appropriate polling interval based on remaining rate budget.
 * Distributes polling evenly across the remaining time window.
 *
 * @param status       Current rate limit status.
 * @param reserve      Calls to keep in reserve. Default: 100.
 * @param minIntervalMs Minimum polling interval. Default: 5000ms.
 * @param maxIntervalMs Maximum polling interval. Default: 300000ms (5 min).
 * @returns Recommended polling interval in milliseconds.
 */
export function calculatePollingInterval(
  status: RateLimitStatus | null,
  reserve: number = DEFAULT_RESERVE,
  minIntervalMs: number = 5_000,
  maxIntervalMs: number = 300_000,
): number {
  if (!status) {
    // No data yet — use moderate interval
    return 30_000;
  }

  const now = Date.now();
  const resetTime = status.resetsAt.getTime();
  const remainingMs = Math.max(resetTime - now, 1_000);

  // Available calls (above reserve)
  const available = Math.max(status.remaining - reserve, 0);

  if (available <= 0) {
    // Rate-limited — wait until reset
    return Math.min(remainingMs, maxIntervalMs);
  }

  // Distribute remaining calls evenly across the time window
  const intervalMs = Math.floor(remainingMs / available);

  // Clamp to bounds
  return Math.max(minIntervalMs, Math.min(intervalMs, maxIntervalMs));
}
