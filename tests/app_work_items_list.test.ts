import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import { getAuthHeaders } from './helpers/auth.ts';

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

  it('shows login UI when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/work-items' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Sign in');
  });

  it('renders HTML containing work item title when authenticated', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'List Item' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/app/work-items',
      headers: await getAuthHeaders('app-list@example.com'),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);

    // Must be in the HTML response (embedded bootstrap data).
    expect(res.body).toContain('List Item');
  });
});
