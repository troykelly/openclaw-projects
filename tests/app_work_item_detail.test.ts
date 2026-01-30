import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

/**
 * Issue #52: drive Work Item detail page behaviour for the new `/app/*` frontend.
 *
 * NOTE: These are server-rendered expectations (Fastify inject does not execute JS).
 */
describe('/app work item detail', () => {
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
      payload: { email: 'app-detail@example.com' },
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
    const res = await app.inject({ method: 'GET', url: '/app/work-items/abc' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Dashboard login');
  });

  it('renders work item detail HTML containing title and a participant when authenticated', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Detail Item' },
    });
    const { id } = created.json() as { id: string };

    await app.inject({
      method: 'POST',
      url: `/api/work-items/${id}/participants`,
      payload: { participant: 'troy@example.com', role: 'watcher' },
    });

    const cookie = await getSessionCookie();

    const res = await app.inject({
      method: 'GET',
      url: `/app/work-items/${id}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);

    // Must be in the HTML response (server-rendered / embedded bootstrap data).
    expect(res.body).toContain('Detail Item');
    expect(res.body).toContain('troy@example.com');
  });
});
