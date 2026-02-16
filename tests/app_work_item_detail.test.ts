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
 * Issue #52: drive Work Item detail page behaviour for the new `/app/*` frontend.
 *
 * NOTE: These are server-rendered expectations (Fastify inject does not execute JS).
 * Updated for JWT auth migration (Issue #1325).
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

  /** Get a JWT access token by creating and consuming a magic link directly in the DB. */
  async function getAccessToken(): Promise<string> {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenSha = createHash('sha256').update(rawToken).digest('hex');
    const dbPool = createPool({ max: 1 });
    await dbPool.query(
      `INSERT INTO auth_magic_link (email, token_sha256, expires_at)
       VALUES ($1, $2, now() + interval '15 minutes')`,
      ['app-detail@example.com', tokenSha],
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
    const res = await app.inject({ method: 'GET', url: '/app/work-items/abc' });
    expect(res.statusCode).toBe(401);
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

    const accessToken = await getAccessToken();

    const res = await app.inject({
      method: 'GET',
      url: `/app/work-items/${id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);

    // Must be in the HTML response (server-rendered / embedded bootstrap data).
    expect(res.body).toContain('Detail Item');
    expect(res.body).toContain('troy@example.com');
  });
});
