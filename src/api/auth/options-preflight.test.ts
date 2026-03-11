/**
 * Unit tests for OPTIONS preflight request handling in the auth hook.
 * Issue #2387: OPTIONS /gateway/status returned 401 when CORS_HANDLED_BY_PROXY=true
 * because the auth hook rejected requests without a Bearer token.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';

describe('OPTIONS preflight bypass in auth hook (Issue #2387)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    // Ensure auth is NOT disabled so the hook actually runs
    vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', '');
    vi.stubEnv('JWT_SECRET', 'a]Uf9$Lx2!Qm7Kp@Wz4Rn8Yb6Hd3Jt0Vs');
    // Simulate the proxy-handled CORS scenario
    vi.stubEnv('CORS_HANDLED_BY_PROXY', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /**
   * Build a minimal Fastify app with ONLY the auth hook (not the full server)
   * to isolate the OPTIONS preflight behaviour.
   */
  async function buildMinimalAuthApp() {
    const { isAuthDisabled } = await import('./jwt.ts');
    const { getAuthIdentity } = await import('./middleware.ts');

    const app = Fastify();

    app.addHook('onRequest', async (req, reply) => {
      const url = req.url.split('?')[0];

      // Skip CORS preflight requests — they carry no Bearer token and are
      // handled upstream (Traefik when CORS_HANDLED_BY_PROXY=true, or
      // @fastify/cors when Fastify handles CORS directly). (#2387)
      if (req.method === 'OPTIONS') return;

      if (isAuthDisabled()) return;

      const identity = await getAuthIdentity(req);
      if (identity) return;

      return reply.code(401).send({ error: 'unauthorized' });
    });

    // Register a test route at /gateway/status
    app.get('/gateway/status', async () => ({ status: 'ok' }));
    // Fastify needs explicit OPTIONS route or it auto-handles
    app.options('/gateway/status', async (_req, reply) => reply.code(204).send());

    await app.ready();
    return app;
  }

  it('OPTIONS request to /gateway/status returns 204 (not 401)', async () => {
    const app = await buildMinimalAuthApp();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/gateway/status',
      // No Authorization header — just like a browser preflight
    });

    expect(res.statusCode).toBe(204);
    expect(res.statusCode).not.toBe(401);

    await app.close();
  });

  it('GET request to /gateway/status without auth still returns 401', async () => {
    const app = await buildMinimalAuthApp();

    const res = await app.inject({
      method: 'GET',
      url: '/gateway/status',
      // No Authorization header
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it('OPTIONS request to any API path returns non-401', async () => {
    const app = await buildMinimalAuthApp();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/chat/sessions',
    });

    // Should not be 401 — OPTIONS should be allowed through
    expect(res.statusCode).not.toBe(401);

    await app.close();
  });
});
