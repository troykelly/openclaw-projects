import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

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

  async function getSessionCookie(): Promise<string> {
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'app@example.com' },
    });
    const { loginUrl } = request.json() as { loginUrl: string };
    const token = new URL(loginUrl).searchParams.get('token');

    const consume = await app.inject({
      method: 'GET',
      url: `/api/auth/consume?token=${token}`,
      headers: { accept: 'application/json' },
    });

    const setCookie = consume.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    return cookieHeader.split(';')[0];
  }

  it('requires auth (shows login UI) when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/work-items' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('Sign in');
  });

  it('serves the app shell for list + detail pages when authenticated', async () => {
    const sessionCookie = await getSessionCookie();

    const list = await app.inject({
      method: 'GET',
      url: '/app/work-items',
      headers: { cookie: sessionCookie },
    });

    expect(list.statusCode).toBe(200);
    expect(list.headers['content-type']).toMatch(/text\/html/);
    expect(list.body).toContain('data-testid="app-frontend-shell"');
    expect(list.body).toContain('id="root"');

    const detail = await app.inject({
      method: 'GET',
      url: '/app/work-items/123',
      headers: { cookie: sessionCookie },
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('data-testid="app-frontend-shell"');
  });
});
