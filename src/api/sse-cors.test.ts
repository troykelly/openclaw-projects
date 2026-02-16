/**
 * Unit tests for SSE endpoint CORS headers.
 * Issue #1340: Remove wildcard Access-Control-Allow-Origin from SSE endpoint.
 *
 * The SSE endpoint uses reply.raw.writeHead() which bypasses Fastify's
 * response pipeline. We must ensure CORS headers from @fastify/cors are
 * propagated to the raw response.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from './cors.ts';

/**
 * Build a minimal Fastify app with CORS + an SSE endpoint that mirrors
 * the pattern used in server.ts (reply.raw.writeHead with SSE headers).
 *
 * The `writeHeadHeaders` parameter controls what gets passed to writeHead,
 * simulating the before/after state of the fix.
 */
async function buildSseApp(options?: {
  /** If true, manually set wildcard CORS (pre-fix behavior). */
  manualWildcardCors?: boolean;
  /** If true, propagate Fastify reply headers to raw writeHead (post-fix behavior). */
  propagateCorsHeaders?: boolean;
}) {
  const app = Fastify();
  registerCors(app);

  app.get('/api/events', async (_req, reply) => {
    const sseHeaders: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    };

    if (options?.manualWildcardCors) {
      sseHeaders['Access-Control-Allow-Origin'] = '*';
    }

    if (options?.propagateCorsHeaders) {
      // Post-fix behavior: merge Fastify reply headers (set by @fastify/cors)
      const replyHeaders = reply.getHeaders();
      for (const [key, value] of Object.entries(replyHeaders)) {
        if (value !== undefined) {
          sseHeaders[key] = String(value);
        }
      }
    }

    reply.raw.writeHead(200, sseHeaders);
    reply.raw.write(
      `data: ${JSON.stringify({ event: 'connection:established' })}\n\n`,
    );
    reply.raw.end();
  });

  await app.ready();
  return app;
}

describe('SSE endpoint CORS headers (Issue #1340)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.PUBLIC_BASE_URL;
  });

  afterEach(() => {
    for (const key of ['CORS_ALLOWED_ORIGINS', 'PUBLIC_BASE_URL']) {
      if (key in originalEnv) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  describe('pre-fix behavior (manual wildcard)', () => {
    it('returns wildcard origin which is incompatible with credentials', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildSseApp({ manualWildcardCors: true });

      const res = await app.inject({
        method: 'GET',
        url: '/api/events',
        headers: { origin: 'https://app.example.com' },
      });

      // This is the broken behavior we are fixing
      expect(res.headers['access-control-allow-origin']).toBe('*');

      await app.close();
    });
  });

  describe('post-fix behavior (propagate CORS headers)', () => {
    it('returns specific origin from @fastify/cors, not wildcard', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildSseApp({ propagateCorsHeaders: true });

      const res = await app.inject({
        method: 'GET',
        url: '/api/events',
        headers: { origin: 'https://app.example.com' },
      });

      expect(res.headers['access-control-allow-origin']).toBe(
        'https://app.example.com',
      );
      expect(res.headers['access-control-allow-origin']).not.toBe('*');

      await app.close();
    });

    it('includes access-control-allow-credentials: true', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildSseApp({ propagateCorsHeaders: true });

      const res = await app.inject({
        method: 'GET',
        url: '/api/events',
        headers: { origin: 'https://app.example.com' },
      });

      expect(res.headers['access-control-allow-credentials']).toBe('true');

      await app.close();
    });

    it('includes Vary: Origin header', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildSseApp({ propagateCorsHeaders: true });

      const res = await app.inject({
        method: 'GET',
        url: '/api/events',
        headers: { origin: 'https://app.example.com' },
      });

      expect(String(res.headers.vary ?? '').toLowerCase()).toContain('origin');

      await app.close();
    });

    it('omits CORS headers for disallowed origin', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildSseApp({ propagateCorsHeaders: true });

      const res = await app.inject({
        method: 'GET',
        url: '/api/events',
        headers: { origin: 'https://evil.example.com' },
      });

      // Should NOT have wildcard or the evil origin
      expect(res.headers['access-control-allow-origin']).toBeUndefined();

      await app.close();
    });

    it('still returns SSE content-type header', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildSseApp({ propagateCorsHeaders: true });

      const res = await app.inject({
        method: 'GET',
        url: '/api/events',
        headers: { origin: 'https://app.example.com' },
      });

      expect(res.headers['content-type']).toBe('text/event-stream');

      await app.close();
    });
  });
});
