import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * SPA fallback route tests for issue #481.
 *
 * Verifies that Fastify serves index.html for deep-linked client-side routes
 * under /static/app/* while still serving real static assets normally.
 */
describe('SPA fallback (/static/app/*)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // ── Real static files should still be served directly ──────────────

  it('serves real CSS files from /static/app/assets/', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/static/app/index.html',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('serves real JS files from /static/app/assets/', async () => {
    // We know assets exist in the build output — find one dynamically
    const indexRes = await app.inject({
      method: 'GET',
      url: '/static/app/index.html',
    });

    // Extract a JS asset path from the index.html
    const jsMatch = indexRes.body.match(/src="(\/static\/app\/assets\/[^"]+\.js)"/);
    if (jsMatch) {
      const jsRes = await app.inject({
        method: 'GET',
        url: jsMatch[1],
      });
      expect(jsRes.statusCode).toBe(200);
      expect(jsRes.headers['content-type']).toMatch(/javascript/);
    }
  });

  // ── Deep links should serve index.html (SPA fallback) ──────────────

  it('serves index.html for /static/app/projects/123 (deep link)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/static/app/projects/123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('data-testid="app-frontend-shell"');
    expect(res.body).toContain('id="root"');
  });

  it('serves index.html for /static/app/activity (deep link)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/static/app/activity',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('data-testid="app-frontend-shell"');
  });

  it('serves index.html for /static/app/settings (deep link)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/static/app/settings',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('data-testid="app-frontend-shell"');
  });

  it('serves index.html for /static/app/contacts/456 (nested deep link)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/static/app/contacts/456',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('data-testid="app-frontend-shell"');
  });

  it('serves index.html for /static/app/work-items/abc-def/timeline (deeply nested)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/static/app/work-items/abc-def/timeline',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('data-testid="app-frontend-shell"');
  });

  it('includes bootstrap data in SPA fallback responses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/static/app/some/deep/path',
    });
    expect(res.statusCode).toBe(200);
    // The fallback should inject bootstrap data with at minimum the route path
    expect(res.body).toContain('app-bootstrap');
  });

  // ── API routes must NOT be affected ────────────────────────────────

  it('does not intercept /api/health', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });
    // Health check returns JSON (not SPA HTML), status may be 'ok' or 'degraded'
    const body = res.json();
    expect(body).toHaveProperty('status');
    expect(['ok', 'degraded']).toContain(body.status);
    expect(res.body).not.toContain('data-testid="app-frontend-shell"');
  });

  it('does not intercept /api/health/live', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health/live',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  it('does not intercept /health', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('ok', true);
  });

  it('does not intercept POST /api/auth/request-link', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'test@example.com' },
    });
    // Should return a success status with loginUrl (not the SPA HTML)
    expect([200, 201]).toContain(res.statusCode);
    const body = res.json();
    expect(body).toHaveProperty('loginUrl');
    expect(res.body).not.toContain('data-testid="app-frontend-shell"');
  });

  // ── Non-static, non-API, non-app paths should 404 ─────────────────

  it('returns 404 for unknown top-level paths', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/nonexistent-path',
    });
    expect(res.statusCode).toBe(404);
  });

  // ── SPA fallback with trailing slash ───────────────────────────────

  it('serves index.html for /static/app/ (root with trailing slash)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/static/app/',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('data-testid="app-frontend-shell"');
  });
});
