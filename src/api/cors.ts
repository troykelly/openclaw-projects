/**
 * CORS configuration for the API server.
 * Issue #1327: Multi-origin allowlist with @fastify/cors.
 *
 * Origin allowlist is resolved from (first defined wins):
 *   1. CORS_ALLOWED_ORIGINS  (comma-separated)
 *   2. PUBLIC_BASE_URL
 *   3. http://localhost:3000  (safe default)
 *
 * Requests without an Origin header (server-to-server, curl) are always allowed.
 *
 * When `CORS_HANDLED_BY_PROXY` is truthy the @fastify/cors plugin is NOT
 * registered. In Traefik deployments the reverse proxy already injects CORS
 * headers (including on proxy-generated 502s). Letting both Traefik AND
 * Fastify set CORS headers produces duplicate `Access-Control-Allow-Origin`
 * values which browsers reject.
 */
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

/** Normalize a URL string to its origin (protocol + host), stripping paths and trailing slashes. */
function toOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** Build the allowed-origins set from environment variables. */
function getAllowedOrigins(): string[] {
  return (process.env.CORS_ALLOWED_ORIGINS || process.env.PUBLIC_BASE_URL || 'http://localhost:3000')
    .split(',')
    .map((s) => toOrigin(s.trim()))
    .filter(Boolean);
}

/**
 * Register @fastify/cors on the given Fastify instance.
 *
 * Skipped when the `CORS_HANDLED_BY_PROXY` env var is truthy (e.g. Traefik
 * deployments where the proxy already sets CORS headers).
 */
export function registerCors(app: FastifyInstance): void {
  if (process.env.CORS_HANDLED_BY_PROXY) {
    app.log.info('CORS_HANDLED_BY_PROXY is set — skipping @fastify/cors registration');
    return;
  }

  app.register(cors, {
    origin: (origin, callback) => {
      // Allow requests with no Origin header (server-to-server, curl, etc.)
      if (!origin) return callback(null, true);

      const allowed = getAllowedOrigins();
      if (allowed.includes(origin)) return callback(null, true);

      // Disallowed origin — pass false so @fastify/cors omits ACAO header
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    credentials: true,
    maxAge: 86400,
  });
}
