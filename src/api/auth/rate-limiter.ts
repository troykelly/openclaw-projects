/**
 * Auth endpoint rate limiting configuration.
 * Issue #1339, Epic #1322 (JWT Auth).
 *
 * Provides per-endpoint rate limit configuration for auth routes, leveraging
 * @fastify/rate-limit's per-route override mechanism. Rate limit state is
 * stored in-memory (no Redis dependency).
 *
 * @module auth/rate-limiter
 */
import type { FastifyRequest } from 'fastify';

/** Rate limit configuration for a single auth endpoint. */
export interface AuthRateLimitConfig {
  /** Maximum requests allowed in the time window. */
  max: number;
  /** Time window as a string (e.g., '15 minutes', '1 minute'). */
  timeWindow: string;
  /** Custom key generator for the rate limit bucket. */
  keyGenerator: (req: FastifyRequest) => string;
}

/**
 * Extracts the client IP from a Fastify request.
 * Uses req.ip which respects trustProxy settings.
 */
function getClientIp(req: FastifyRequest): string {
  return req.ip;
}

/**
 * Rate limit config for POST /api/auth/request-link.
 * 5 requests per 15 minutes, keyed by IP + email.
 */
export function requestLinkRateLimit(): AuthRateLimitConfig {
  return {
    max: 5,
    timeWindow: '15 minutes',
    keyGenerator: (req: FastifyRequest): string => {
      const body = req.body as { email?: string } | null;
      const email = body?.email?.trim().toLowerCase() ?? 'unknown';
      return `auth:request-link:${getClientIp(req)}:${email}`;
    },
  };
}

/**
 * Rate limit config for POST /api/auth/consume.
 * 10 requests per 15 minutes, keyed by IP.
 */
export function consumeRateLimit(): AuthRateLimitConfig {
  return {
    max: 10,
    timeWindow: '15 minutes',
    keyGenerator: (req: FastifyRequest): string => {
      return `auth:consume:${getClientIp(req)}`;
    },
  };
}

/**
 * Rate limit config for POST /api/auth/refresh.
 * 30 requests per 1 minute, keyed by IP.
 */
export function refreshRateLimit(): AuthRateLimitConfig {
  return {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest): string => {
      return `auth:refresh:${getClientIp(req)}`;
    },
  };
}

/**
 * Rate limit config for POST /api/auth/revoke.
 * 10 requests per 1 minute, keyed by IP.
 */
export function revokeRateLimit(): AuthRateLimitConfig {
  return {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest): string => {
      return `auth:revoke:${getClientIp(req)}`;
    },
  };
}

/**
 * Rate limit config for POST /api/auth/exchange.
 * 10 requests per 1 minute, keyed by IP.
 */
export function exchangeRateLimit(): AuthRateLimitConfig {
  return {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest): string => {
      return `auth:exchange:${getClientIp(req)}`;
    },
  };
}
