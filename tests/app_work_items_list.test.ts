import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

/**
 * Issue #59: bootstrap /app/work-items list data into the HTML so server-side tests can assert on it.
 */
describe('/app work items list', () => {
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
      payload: { email: 'app-list@example.com' },
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

  it('shows login UI when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/work-items' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Dashboard login');
  });

  it('renders HTML containing work item title when authenticated', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'List Item' },
    });

    const cookie = await getSessionCookie();

    const res = await app.inject({
      method: 'GET',
      url: '/app/work-items',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);

    // Must be in the HTML response (embedded bootstrap data).
    expect(res.body).toContain('List Item');
  });
});
