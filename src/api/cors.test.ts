/**
 * Unit tests for CORS configuration.
 * Issue #1327: Add CORS configuration with @fastify/cors.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerCors } from './cors.ts';

/**
 * Helper: create a minimal Fastify app with CORS registered,
 * plus a dummy route so requests don't 404.
 */
async function buildCorsApp() {
  const app = Fastify();
  registerCors(app);
  app.get('/api/test', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('CORS configuration (Issue #1327)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env to known state
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.CORS_HANDLED_BY_PROXY;
  });

  afterEach(() => {
    // Restore only touched keys instead of replacing the entire env object
    for (const key of ['CORS_ALLOWED_ORIGINS', 'PUBLIC_BASE_URL', 'CORS_HANDLED_BY_PROXY']) {
      if (key in originalEnv) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  describe('preflight (OPTIONS) requests', () => {
    it('returns correct CORS headers for allowed origin', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildCorsApp();

      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/test',
        headers: {
          origin: 'https://app.example.com',
          'access-control-request-method': 'GET',
        },
      });

      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(res.headers['access-control-allow-methods']).toContain('GET');
      expect(res.headers['access-control-allow-methods']).toContain('POST');
      expect(res.headers['access-control-allow-methods']).toContain('PUT');
      expect(res.headers['access-control-allow-methods']).toContain('PATCH');
      expect(res.headers['access-control-allow-methods']).toContain('DELETE');
      expect(res.headers['access-control-allow-methods']).toContain('OPTIONS');
      expect(res.headers['access-control-allow-headers']).toContain('Authorization');
      expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
      expect(res.headers['access-control-allow-headers']).toContain('Accept');
      expect(res.headers['access-control-max-age']).toBe('86400');

      await app.close();
    });
  });

  describe('allowed origin', () => {
    it('returns Access-Control-Allow-Origin for allowed origin', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildCorsApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { origin: 'https://app.example.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');

      await app.close();
    });
  });

  describe('disallowed origin', () => {
    it('does not return Access-Control-Allow-Origin for disallowed origin', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildCorsApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { origin: 'https://evil.example.com' },
      });

      // The request still succeeds (CORS is enforced by browsers, not servers),
      // but the ACAO header must NOT be present for a disallowed origin.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();

      await app.close();
    });
  });

  describe('no origin (server-to-server / curl)', () => {
    it('allows requests with no origin header', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildCorsApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
        // No origin header
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });

      await app.close();
    });
  });

  describe('multi-origin support via CORS_ALLOWED_ORIGINS', () => {
    it('allows any origin in the comma-separated allowlist', async () => {
      process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com, https://admin.example.com';
      const app = await buildCorsApp();

      const res1 = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { origin: 'https://app.example.com' },
      });
      expect(res1.headers['access-control-allow-origin']).toBe('https://app.example.com');

      const res2 = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { origin: 'https://admin.example.com' },
      });
      expect(res2.headers['access-control-allow-origin']).toBe('https://admin.example.com');

      await app.close();
    });

    it('rejects origins not in the allowlist', async () => {
      process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com, https://admin.example.com';
      const app = await buildCorsApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { origin: 'https://evil.example.com' },
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();

      await app.close();
    });
  });

  describe('credentials support', () => {
    it('includes access-control-allow-credentials: true', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildCorsApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { origin: 'https://app.example.com' },
      });

      expect(res.headers['access-control-allow-credentials']).toBe('true');

      await app.close();
    });
  });

  describe('fallback to localhost', () => {
    it('defaults to http://localhost:3000 when no env vars set', async () => {
      delete process.env.CORS_ALLOWED_ORIGINS;
      delete process.env.PUBLIC_BASE_URL;
      const app = await buildCorsApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { origin: 'http://localhost:3000' },
      });

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');

      await app.close();
    });
  });

  describe('error responses (502, 500) include CORS headers', () => {
    it('returns CORS headers on 502 Bad Gateway responses', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = Fastify();
      registerCors(app);
      app.post('/api/fail', async (_req, reply) => reply.code(502).send({ error: 'Bad Gateway' }));
      await app.ready();

      const res = await app.inject({
        method: 'POST',
        url: '/api/fail',
        headers: { origin: 'https://app.example.com' },
        payload: {},
      });

      expect(res.statusCode).toBe(502);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(res.headers['access-control-allow-credentials']).toBe('true');

      await app.close();
    });

    it('returns CORS headers on 500 Internal Server Error responses', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = Fastify();
      registerCors(app);
      app.get('/api/error', async (_req, reply) => reply.code(500).send({ error: 'Internal Server Error' }));
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/api/error',
        headers: { origin: 'https://app.example.com' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(res.headers['access-control-allow-credentials']).toBe('true');

      await app.close();
    });
  });

  describe('Vary header', () => {
    it('includes Vary: Origin for requests with origin header', async () => {
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildCorsApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { origin: 'https://app.example.com' },
      });

      // @fastify/cors sets Vary: Origin automatically
      const vary = res.headers.vary;
      expect(vary).toBeDefined();
      expect(String(vary).toLowerCase()).toContain('origin');

      await app.close();
    });
  });

  describe('CORS_HANDLED_BY_PROXY bypass', () => {
    it('does not register @fastify/cors when CORS_HANDLED_BY_PROXY is "true"', async () => {
      process.env.CORS_HANDLED_BY_PROXY = 'true';
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildCorsApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { origin: 'https://app.example.com' },
      });

      expect(res.statusCode).toBe(200);
      // No CORS plugin registered — no ACAO header
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();

      await app.close();
    });

    it('still registers @fastify/cors when CORS_HANDLED_BY_PROXY is "false"', async () => {
      process.env.CORS_HANDLED_BY_PROXY = 'false';
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildCorsApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { origin: 'https://app.example.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');

      await app.close();
    });

    it('still registers @fastify/cors when CORS_HANDLED_BY_PROXY is not set', async () => {
      delete process.env.CORS_HANDLED_BY_PROXY;
      process.env.PUBLIC_BASE_URL = 'https://app.example.com';
      const app = await buildCorsApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { origin: 'https://app.example.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');

      await app.close();
    });
  });
});
