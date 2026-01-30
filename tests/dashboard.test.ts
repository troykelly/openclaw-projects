import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

describe('/dashboard UI', () => {
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

  it('shows login UI when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('Dashboard login');

    // UI foundation: shared app shell + stylesheet is always present.
    expect(res.body).toContain('href="/static/app.css"');
    expect(res.body).toContain('data-testid="app-shell"');

    const res2 = await app.inject({ method: 'GET', url: '/dashboard/work-items' });
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toContain('Dashboard login');
  });

  it('shows dashboard when authenticated', async () => {
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'dash@example.com' },
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
    const sessionCookie = cookieHeader.split(';')[0];

    const dash = await app.inject({
      method: 'GET',
      url: '/dashboard',
      headers: { cookie: sessionCookie },
    });

    expect(dash.statusCode).toBe(200);
    expect(dash.body).toContain('href="/static/app.css"');
    expect(dash.body).toContain('data-testid="app-shell"');
    expect(dash.body).toContain('Dashboard');
    expect(dash.body).toContain('Logged in as');

    const list = await app.inject({
      method: 'GET',
      url: '/dashboard/work-items',
      headers: { cookie: sessionCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain('Work items');

    const newPage = await app.inject({
      method: 'GET',
      url: '/dashboard/work-items/new',
      headers: { cookie: sessionCookie },
    });
    expect(newPage.statusCode).toBe(200);
    expect(newPage.body).toContain('New work item');

    const created = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Dash item' },
    });
    const { id } = created.json() as { id: string };

    const item = await app.inject({
      method: 'GET',
      url: `/dashboard/work-items/${id}`,
      headers: { cookie: sessionCookie },
    });
    expect(item.statusCode).toBe(200);
    expect(item.body).toContain('Dependencies');
    expect(item.body).toContain('Participants');
  });
});
