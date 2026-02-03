/**
 * Per-user rate limiting utilities.
 * Part of Epic #310, Issue #323.
 *
 * Provides user-based rate limiting that falls back to IP when unauthenticated.
 * Different endpoint categories have different rate limits.
 */

import type { FastifyRequest } from 'fastify';

/** Rate limit categories for different endpoint types */
export type RateLimitCategory = 'read' | 'write' | 'search' | 'send' | 'admin' | 'webhook';

/** Rate limit configuration */
export interface RateLimitConfig {
  /** Maximum requests allowed in the time window */
  max: number;
  /** Time window in milliseconds */
  timeWindow: number;
}

/** Default rate limits per category (requests per minute) */
const DEFAULT_LIMITS: Record<RateLimitCategory, number> = {
  read: 100,
  write: 30,
  search: 20,
  send: 10,
  admin: 5,
  webhook: 60, // Higher limit for external service webhooks
};

/** Environment variable names for category overrides */
const ENV_OVERRIDE_KEYS: Record<RateLimitCategory, string> = {
  read: 'RATE_LIMIT_READ_MAX',
  write: 'RATE_LIMIT_WRITE_MAX',
  search: 'RATE_LIMIT_SEARCH_MAX',
  send: 'RATE_LIMIT_SEND_MAX',
  admin: 'RATE_LIMIT_ADMIN_MAX',
  webhook: 'RATE_LIMIT_WEBHOOK_MAX',
};

/**
 * Type for session email extraction function.
 * This allows the rate limiter to use the existing session lookup from server.ts.
 */
export type GetSessionEmailFn = (req: FastifyRequest) => Promise<string | null>;

/**
 * Extract user ID for rate limiting purposes.
 *
 * Returns a prefixed key:
 * - "user:{email}" for authenticated users
 * - "ip:{ip}" for unauthenticated requests
 *
 * @param req - Fastify request
 * @param getSessionEmail - Function to extract session email from request
 * @returns Rate limit key
 */
export async function extractUserIdForRateLimit(
  req: FastifyRequest,
  getSessionEmail: GetSessionEmailFn
): Promise<string> {
  try {
    const email = await getSessionEmail(req);
    if (email) {
      return `user:${email}`;
    }
  } catch {
    // Fall through to IP-based limiting on session lookup error
  }

  return `ip:${req.ip}`;
}

/**
 * Determine the rate limit category for an endpoint.
 *
 * @param method - HTTP method
 * @param url - Request URL path
 * @returns Rate limit category
 */
export function getEndpointRateLimitCategory(method: string, url: string): RateLimitCategory {
  const upperMethod = method.toUpperCase();
  const path = url.split('?')[0]; // Remove query string

  // Admin endpoints
  if (path.includes('/admin/')) {
    return 'admin';
  }

  // Webhook endpoints (external services calling our API)
  if (
    path.startsWith('/api/twilio/sms') &&
    !path.includes('/send') ||
    path.startsWith('/api/postmark/') ||
    path.startsWith('/api/cloudflare/email')
  ) {
    return 'webhook';
  }

  // Message sending endpoints
  if (
    path.includes('/send') ||
    path.includes('/email/send')
  ) {
    return 'send';
  }

  // Search endpoints
  if (path.includes('/search')) {
    return 'search';
  }

  // Write operations (POST/PUT/PATCH/DELETE except webhooks and search)
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(upperMethod)) {
    return 'write';
  }

  // Default to read for GET requests
  return 'read';
}

/**
 * Get rate limit configuration for a category.
 *
 * Respects environment variable overrides.
 *
 * @param category - Rate limit category
 * @returns Rate limit configuration
 */
export function getRateLimitConfig(category: RateLimitCategory): RateLimitConfig {
  // Check for category-specific override
  const envKey = ENV_OVERRIDE_KEYS[category];
  const envValue = process.env[envKey];
  const max = envValue ? parseInt(envValue, 10) : DEFAULT_LIMITS[category];

  // Get global time window override or default to 1 minute
  const timeWindow = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);

  return { max, timeWindow };
}

/**
 * Create a key generator function for use with @fastify/rate-limit.
 *
 * This creates an async key generator that:
 * 1. Tries to identify the user by session email
 * 2. Falls back to IP address if not authenticated
 *
 * @param getSessionEmail - Function to extract session email from request
 * @returns Key generator function for rate limiting
 */
export function createRateLimitKeyGenerator(
  getSessionEmail: GetSessionEmailFn
): (req: FastifyRequest) => Promise<string> {
  return async (req: FastifyRequest): Promise<string> => {
    return extractUserIdForRateLimit(req, getSessionEmail);
  };
}

/**
 * Get route-specific rate limit configuration.
 *
 * Returns config object suitable for use in Fastify route options.
 *
 * @param category - Rate limit category
 * @param getSessionEmail - Session email extraction function
 * @returns Rate limit route configuration
 */
export function getRouteRateLimitConfig(
  category: RateLimitCategory,
  getSessionEmail: GetSessionEmailFn
): {
  max: number;
  timeWindow: number;
  keyGenerator: (req: FastifyRequest) => Promise<string>;
} {
  const { max, timeWindow } = getRateLimitConfig(category);

  return {
    max,
    timeWindow,
    keyGenerator: createRateLimitKeyGenerator(getSessionEmail),
  };
}
