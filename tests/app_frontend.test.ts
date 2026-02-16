import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';
import { getAuthHeaders } from './helpers/auth.ts';

/**
 * New frontend entrypoints.
 *
 * These tests drive the initial scaffold for issue #52.
 */
describe('/app frontend', () => {
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

  // Issue #1166: GET / serves a landing page (not a redirect)
  it('serves landing page at GET / with sign-in link when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('OpenClaw Projects');
    expect(res.body).toContain('Sign in');
  });

  it('serves landing page at GET / with dashboard link when authenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
      headers: await getAuthHeaders('app@example.com'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('Dashboard');
  });

  // Issue #1166: GET /auth redirects to /app
  it('redirects GET /auth to /app', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/app');
  });

  it('requires auth (shows login UI) when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/work-items' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('Sign in');
  });

  it('serves the app shell for list + detail pages when authenticated', async () => {
    const headers = await getAuthHeaders('app@example.com');

    const list = await app.inject({
      method: 'GET',
      url: '/app/work-items',
      headers,
    });

    expect(list.statusCode).toBe(200);
    expect(list.headers['content-type']).toMatch(/text\/html/);
    expect(list.body).toContain('data-testid="app-frontend-shell"');
    expect(list.body).toContain('id="root"');

    const detail = await app.inject({
      method: 'GET',
      url: '/app/work-items/123',
      headers,
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('data-testid="app-frontend-shell"');
  });

  // Issue #1166: Login page uses inline CSS (not broken /static/app.css reference)
  it('login page does not reference non-existent /static/app.css', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/work-items' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('href="/static/app.css"');
  });
});
