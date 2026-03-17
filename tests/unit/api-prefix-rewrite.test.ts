/**
 * Tests verifying that Fastify's rewriteUrl strips the /api/ prefix from
 * incoming requests. This prefix arrives when the production
 * OAUTH_REDIRECT_URI includes /api/ (e.g. https://api.execdesk.ai/api/oauth/callback)
 * and Traefik forwards the request to the API service with path intact.
 *
 * All Fastify routes are registered WITHOUT the /api/ prefix, so the
 * rewriteUrl option must strip it before routing and auth hooks run.
 *
 * Issue #2565
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildServer } from '../../src/api/server.ts';

describe('/api/ prefix rewrite (Issue #2565)', () => {
  let app: ReturnType<typeof buildServer>;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('should strip /api/ prefix and route to the correct handler', async () => {
    app = buildServer({ logger: false });
    // The health endpoint is at /health — should also work at /api/health
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).not.toBe(404);
  });

  it('should handle /api/oauth/callback without 401', async () => {
    // OAuth callback is in authSkipPaths — should not return 401 even without JWT
    app = buildServer({ logger: false });
    const res = await app.inject({
      method: 'GET',
      url: '/api/oauth/callback?code=testcode&state=teststate',
    });
    // Should NOT be 401 (auth middleware should skip it)
    // It may be 400 (invalid state) or 302 (redirect) which is expected
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(404);
  });

  it('should preserve /oauth/callback without prefix (no regression)', async () => {
    app = buildServer({ logger: false });
    const res = await app.inject({
      method: 'GET',
      url: '/oauth/callback?code=testcode&state=teststate',
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(404);
  });

  it('should strip /api prefix from bare /api path', async () => {
    app = buildServer({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/api' });
    // / is the landing page — should return 200
    expect(res.statusCode).toBe(200);
  });

  it('should not rewrite paths that do not start with /api/', async () => {
    app = buildServer({ logger: false });
    // /health should work as-is, unmodified
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});
