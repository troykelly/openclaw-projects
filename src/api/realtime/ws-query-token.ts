/**
 * Extract a query-string `token` from a request URL.
 *
 * In @fastify/websocket handlers, `req.query` may be `undefined` because the
 * request object is sometimes a raw `IncomingMessage` rather than a fully-parsed
 * Fastify request. Parsing directly from `req.url` is safe in all cases.
 *
 * Issue #2404
 */

import type { IncomingMessage } from 'node:http';

/**
 * Extract the `token` query parameter from a request URL.
 *
 * Works with both Fastify requests and raw Node.js IncomingMessage objects —
 * always parses from `req.url` rather than relying on `req.query`.
 *
 * @returns The token string, or `null` if absent.
 */
export function extractWsQueryToken(req: { url?: string }): string | null {
  return extractWsQueryParam(req, 'token');
}

/**
 * Extract an arbitrary query parameter from a request URL.
 *
 * Works with both Fastify requests and raw Node.js IncomingMessage objects —
 * always parses from `req.url` rather than relying on `req.query` which may
 * be `undefined` in @fastify/websocket wsHandler callbacks.
 *
 * Issue #2404, #2592
 *
 * @returns The parameter value, or `null` if absent.
 */
export function extractWsQueryParam(req: { url?: string }, name: string): string | null {
  const url = req.url;
  if (!url) return null;

  // Fast path: skip URL constructor if no query string present
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return null;

  const params = new URLSearchParams(url.slice(qIdx + 1));
  return params.get(name);
}
