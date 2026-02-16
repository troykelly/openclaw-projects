/**
 * API base URL derivation from hostname.
 *
 * Convention-based URL resolution for cross-origin API requests:
 * - localhost / 127.0.0.1 / [::1]: same-origin (empty string, nginx proxy)
 * - Production: derive `${protocol}//api.${domain}` (strips `www.` prefix)
 * - Build-time override via `VITE_API_URL` env var takes precedence
 */

/** Returns true when the hostname is a loopback address. */
function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  );
}

/**
 * Derive the HTTP(S) API base URL from the current browser location.
 *
 * Priority:
 * 1. `VITE_API_URL` build-time override (if non-empty)
 * 2. Loopback hostnames → empty string (same-origin proxy)
 * 3. Production → `${protocol}//api.${domain}` (www. stripped)
 *
 * @returns Absolute base URL (no trailing slash) or empty string for same-origin
 */
export function getApiBaseUrl(): string {
  const override = import.meta.env.VITE_API_URL;
  if (override) {
    return override.replace(/\/+$/, '');
  }

  const { hostname, protocol } = window.location;

  if (isLoopback(hostname)) {
    return '';
  }

  const domain = hostname.replace(/^www\./, '');
  return `${protocol}//api.${domain}`;
}

/**
 * Derive the WebSocket base URL from the current browser location.
 *
 * Converts `https:` → `wss:` and `http:` → `ws:`.
 * For loopback addresses, returns empty string (same-origin upgrade).
 *
 * @returns Absolute WebSocket base URL or empty string for same-origin
 */
export function getWsBaseUrl(): string {
  const apiUrl = getApiBaseUrl();
  if (!apiUrl) {
    return '';
  }

  return apiUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}
