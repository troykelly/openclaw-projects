/**
 * Auth token manager for JWT-based authentication.
 *
 * Manages in-memory access tokens with automatic refresh via HttpOnly
 * refresh token cookie. Access tokens are NEVER stored in localStorage
 * or sessionStorage — they exist only in a JavaScript variable and are
 * lost on page refresh (re-established via {@link refreshAccessToken}).
 *
 * Key features:
 * - In-memory token storage (XSS-resilient vs localStorage)
 * - Expiration check with 30-second buffer
 * - Concurrent refresh deduplication (mutex/promise pattern)
 * - Automatic session bootstrap on page load
 */

import { getApiBaseUrl } from './api-config.ts';

/** In-memory access token — the only place it is stored. */
let accessToken: string | null = null;

/** Parsed expiration timestamp (seconds since epoch) from the current token. */
let tokenExp: number | null = null;

/** Buffer in seconds before actual expiry to consider the token expired. */
const EXPIRY_BUFFER_SECONDS = 30;

/**
 * In-flight refresh promise used to deduplicate concurrent refresh calls.
 * When a refresh is in progress, subsequent callers receive the same promise.
 */
let refreshPromise: Promise<string> | null = null;

/**
 * Parse the `exp` claim from a JWT payload without verifying the signature.
 * The server is the source of truth for signature verification — the client
 * only needs to read the expiration for proactive refresh scheduling.
 */
function parseExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1])) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Get the current in-memory access token.
 *
 * @returns The JWT access token string, or null if not authenticated.
 */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Store an access token in memory and parse its expiration claim.
 *
 * @param token - JWT access token returned by the server
 */
export function setAccessToken(token: string): void {
  accessToken = token;
  tokenExp = parseExp(token);
}

/**
 * Remove the in-memory access token (logout / auth failure).
 */
export function clearAccessToken(): void {
  accessToken = null;
  tokenExp = null;
}

/**
 * Check whether the current access token is expired or will expire
 * within the {@link EXPIRY_BUFFER_SECONDS} buffer window.
 *
 * @returns true if no token is set or the token is expired/expiring
 */
export function isTokenExpired(): boolean {
  if (!accessToken || tokenExp === null) return true;
  const now = Math.floor(Date.now() / 1000);
  return now >= tokenExp - EXPIRY_BUFFER_SECONDS;
}

/**
 * Refresh the access token by calling `POST /api/auth/refresh`.
 *
 * The browser automatically sends the HttpOnly refresh token cookie
 * (via `credentials: 'include'`). On success, the new access token
 * is stored in memory and returned.
 *
 * Concurrent calls are deduplicated — only one fetch is made, and
 * all callers receive the same promise result.
 *
 * @returns The new access token string
 * @throws Error if the refresh fails (caller should clear token and redirect)
 */
export function refreshAccessToken(): Promise<string> {
  // If a refresh is already in-flight, return the existing promise
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async (): Promise<string> => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
        },
      });

      if (!res.ok) {
        clearAccessToken();
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const message = typeof body.message === 'string' ? body.message : `Refresh failed: ${res.status}`;
        throw new Error(message);
      }

      const body = (await res.json()) as { accessToken: string };
      setAccessToken(body.accessToken);
      return body.accessToken;
    } finally {
      // Clear the in-flight promise so the next call makes a fresh request
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
