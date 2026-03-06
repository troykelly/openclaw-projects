/**
 * Query-token auth deprecation utilities.
 *
 * Issue #2191, Sub-item 6 — Deprecate query-token auth.
 *
 * WebSocket connections using `?token=` query parameters leak tokens via:
 * - Proxy/CDN access logs
 * - Referer headers
 * - Browser history
 *
 * This module provides deprecation headers and tracking for the migration
 * to first-message or cookie-based auth.
 */

/** HTTP header name for the deprecation notice. */
export const QUERY_TOKEN_DEPRECATION_HEADER = 'X-Deprecated-Auth-Method';

/** Whether query-token auth is deprecated. */
export function isQueryTokenDeprecated(): boolean {
  return true;
}

/**
 * Get standard deprecation headers to include in responses
 * when query-token auth is used.
 *
 * See: RFC 8594 (Sunset header), draft-ietf-httpapi-deprecation-header.
 */
export function getDeprecationHeaders(): Record<string, string> {
  return {
    Deprecation: 'true',
    Sunset: '2026-06-01T00:00:00Z',
    Link: '</docs/auth/websocket>; rel="successor-version"',
    [QUERY_TOKEN_DEPRECATION_HEADER]: 'query-token; use first-message or cookie auth instead',
  };
}

/**
 * Log a deprecation event for tracking migration progress.
 *
 * @param logger - Logger instance with warn method
 * @param sessionId - Session being attached
 * @param clientIp - Client IP for tracking
 */
export function logQueryTokenUsage(
  logger: { warn: (msg: string, ...args: unknown[]) => void },
  sessionId: string,
  clientIp?: string,
): void {
  logger.warn(
    'DEPRECATED: WebSocket auth via query param token for session %s from IP %s — migrate to first-message or cookie auth',
    sessionId,
    clientIp ?? 'unknown',
  );
}
