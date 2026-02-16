import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createHash, randomBytes } from 'node:crypto';
import { createPool } from '../src/db.ts';

// JWT signing requires a secret.
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';

/**
 * New frontend entrypoints.
 *
 * These tests drive the initial scaffold for issue #52.
 * Updated for JWT auth migration (Issue #1325).
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

  /** Get a JWT access token by creating and consuming a magic link directly in the DB. */
  async function getAccessToken(): Promise<string> {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenSha = createHash('sha256').update(rawToken).digest('hex');
    const dbPool = createPool({ max: 1 });
    await dbPool.query(
      `INSERT INTO auth_magic_link (email, token_sha256, expires_at)
       VALUES ($1, $2, now() + interval '15 minutes')`,
      ['app@example.com', tokenSha],
    );
    await dbPool.end();

    const consume = await app.inject({
      method: 'POST',
      url: '/api/auth/consume',
      payload: { token: rawToken },
    });

    const { accessToken } = consume.json() as { accessToken: string };
    return accessToken;
  }

  // Issue #1166: GET / serves a landing page (not a redirect)
  it('serves landing page at GET / with sign-in link when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('OpenClaw Projects');
    expect(res.body).toContain('Sign in');
  });

  it('serves landing page at GET / with dashboard link when authenticated', async () => {
    const accessToken = await getAccessToken();
    const res = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: `Bearer ${accessToken}` },
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

  it('requires auth (returns 401) when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/work-items' });
    expect(res.statusCode).toBe(401);
  });

  it('serves the app shell for list + detail pages when authenticated', async () => {
    const accessToken = await getAccessToken();

    const list = await app.inject({
      method: 'GET',
      url: '/app/work-items',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(list.statusCode).toBe(200);
    expect(list.headers['content-type']).toMatch(/text\/html/);
    expect(list.body).toContain('data-testid="app-frontend-shell"');
    expect(list.body).toContain('id="root"');

    const detail = await app.inject({
      method: 'GET',
      url: '/app/work-items/123',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('data-testid="app-frontend-shell"');
  });

  // Issue #1166: Login page uses inline CSS (not broken /static/app.css reference)
  it('login page does not reference non-existent /static/app.css', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/work-items' });
    // Even on 401 response, check the body doesn't reference old CSS
    expect(res.body).not.toContain('href="/static/app.css"');
  });
});
