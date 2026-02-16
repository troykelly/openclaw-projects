import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import { createHash, randomBytes } from 'node:crypto';
import { createPool } from '../src/db.ts';

// JWT signing requires a secret.
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';

/**
 * Issue #59: bootstrap /app/work-items list data into the HTML so server-side tests can assert on it.
 * Updated for JWT auth migration (Issue #1325).
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

  /** Get a JWT access token by creating and consuming a magic link directly in the DB. */
  async function getAccessToken(): Promise<string> {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenSha = createHash('sha256').update(rawToken).digest('hex');
    const dbPool = createPool({ max: 1 });
    await dbPool.query(
      `INSERT INTO auth_magic_link (email, token_sha256, expires_at)
       VALUES ($1, $2, now() + interval '15 minutes')`,
      ['app-list@example.com', tokenSha],
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

  it('shows login UI when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/work-items' });
    expect(res.statusCode).toBe(401);
  });

  it('renders HTML containing work item title when authenticated', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'List Item' },
    });

    const accessToken = await getAccessToken();

    const res = await app.inject({
      method: 'GET',
      url: '/app/work-items',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);

    // Must be in the HTML response (embedded bootstrap data).
    expect(res.body).toContain('List Item');
  });
});
