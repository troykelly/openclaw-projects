import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Legacy /dashboard routes now redirect to /app/work-items.
 * These tests verify the redirect behavior.
 */
describe('/dashboard legacy routes', () => {
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

  it('redirects /dashboard to /app/work-items', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/app/work-items');
  });

  it('redirects /dashboard/* to /app/work-items', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/work-items' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/app/work-items');

    const res2 = await app.inject({ method: 'GET', url: '/dashboard/work-items/123' });
    expect(res2.statusCode).toBe(302);
    expect(res2.headers.location).toBe('/app/work-items');
  });
});
