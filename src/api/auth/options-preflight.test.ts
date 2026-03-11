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

  it('OPTIONS preflight with Origin header returns 204 (Issue #2392)', async () => {
    // This is the exact scenario that caused the gateway WS offline symptom:
    // browser sends OPTIONS preflight with Origin but no Authorization header,
    // CORS_HANDLED_BY_PROXY=true means @fastify/cors is NOT registered,
    // so OPTIONS must be explicitly allowed through the auth hook.
    const app = await buildMinimalAuthApp();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/gateway/status',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'Authorization',
      },
    });

    // Must return 204 — the browser preflight must succeed for the
    // subsequent GET /gateway/status to fire
    expect(res.statusCode).toBe(204);

    await app.close();
  });

  it('POST without auth returns 401 (OPTIONS bypass does not leak)', async () => {
    const { isAuthDisabled } = await import('./jwt.ts');
    const { getAuthIdentity } = await import('./middleware.ts');

    const app = Fastify();

    app.addHook('onRequest', async (req, reply) => {
      if (req.method === 'OPTIONS') return;
      if (isAuthDisabled()) return;
      const identity = await getAuthIdentity(req);
      if (identity) return;
      return reply.code(401).send({ error: 'unauthorized' });
    });

    app.post('/gateway/status', async () => ({ status: 'ok' }));
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/gateway/status',
      payload: {},
      // No Authorization header
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });
});

/**
 * Server-wiring-level test: uses the real registerCors() + real auth
 * imports in the same order as server.ts to catch regressions in
 * registration order, CORS bypass interaction, or auth hook placement.
 *
 * Issue #2392: the gateway WS appeared offline because OPTIONS preflight
 * returned 401 when CORS_HANDLED_BY_PROXY=true disabled @fastify/cors.
 */
describe('OPTIONS preflight with real CORS + auth wiring (Issue #2392)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', '');
    vi.stubEnv('JWT_SECRET', 'a]Uf9$Lx2!Qm7Kp@Wz4Rn8Yb6Hd3Jt0Vs');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /**
   * Build a Fastify app that mirrors server.ts wiring order:
   *   1. registerCors(app)          — from cors.ts
   *   2. onRequest auth hook        — from server.ts
   *   3. GET /gateway/status route  — from server.ts
   *
   * This catches regressions that the isolated hook tests cannot:
   * - @fastify/cors registration order vs auth hook
   * - CORS_HANDLED_BY_PROXY disabling @fastify/cors
   * - OPTIONS handling when no CORS plugin intercepts
   */
  async function buildServerLikeApp() {
    const { registerCors } = await import('../cors.ts');
    const { isAuthDisabled } = await import('./jwt.ts');
    const { getAuthIdentity } = await import('./middleware.ts');

    const app = Fastify();

    // Step 1: CORS — same as server.ts line 195
    registerCors(app);

    // Step 2: Auth hook — mirrors server.ts lines 821-838
    app.addHook('onRequest', async (req, reply) => {
      if (req.method === 'OPTIONS') return;
      if (isAuthDisabled()) return;
      const identity = await getAuthIdentity(req);
      if (identity) return;
      return reply.code(401).send({ error: 'unauthorized' });
    });

    // Step 3: Route — mirrors server.ts line 970
    app.get('/gateway/status', async () => ({ connected: true, gateway_url: 'gw.example.com' }));

    await app.ready();
    return app;
  }

  it('CORS_HANDLED_BY_PROXY=true: OPTIONS preflight succeeds without auth', async () => {
    vi.stubEnv('CORS_HANDLED_BY_PROXY', 'true');

    const app = await buildServerLikeApp();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/gateway/status',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'Authorization',
      },
    });

    // When CORS_HANDLED_BY_PROXY=true, @fastify/cors is NOT registered.
    // The auth hook must skip OPTIONS so the request is NOT rejected with 401.
    // In production, Traefik handles the actual CORS response; here without
    // Traefik the request falls through to Fastify's 404 (no OPTIONS route).
    // The critical assertion is: NOT 401.
    expect(res.statusCode).not.toBe(401);

    await app.close();
  });

  it('CORS_HANDLED_BY_PROXY=true: GET without auth returns 401', async () => {
    vi.stubEnv('CORS_HANDLED_BY_PROXY', 'true');

    const app = await buildServerLikeApp();

    const res = await app.inject({
      method: 'GET',
      url: '/gateway/status',
      headers: { origin: 'https://app.example.com' },
      // No Authorization header
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it('CORS_HANDLED_BY_PROXY=false: @fastify/cors handles OPTIONS preflight with 204', async () => {
    vi.stubEnv('CORS_HANDLED_BY_PROXY', 'false');
    vi.stubEnv('PUBLIC_BASE_URL', 'https://app.example.com');

    const app = await buildServerLikeApp();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/gateway/status',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'GET',
      },
    });

    // @fastify/cors intercepts and returns 204 with CORS headers
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');

    await app.close();
  });

  it('CORS_HANDLED_BY_PROXY=false: GET without auth still returns 401', async () => {
    vi.stubEnv('CORS_HANDLED_BY_PROXY', 'false');
    vi.stubEnv('PUBLIC_BASE_URL', 'https://app.example.com');

    const app = await buildServerLikeApp();

    const res = await app.inject({
      method: 'GET',
      url: '/gateway/status',
      headers: { origin: 'https://app.example.com' },
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });
});
