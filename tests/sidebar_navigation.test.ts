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
 * Tests for sidebar navigation wiring (issue #129).
 * Updated for JWT auth migration (Issue #1325).
 *
 * Acceptance criteria:
 * - Clicking sidebar items navigates to the correct route
 * - Active state reflects current route
 * - Mobile nav also navigates correctly
 * - Breadcrumbs update based on current route
 */
describe('Sidebar Navigation', () => {
  const app = buildServer();
  let pool: Pool;
  let accessToken: string;

  /** Get a JWT access token by creating and consuming a magic link directly in the DB. */
  async function getAccessToken(): Promise<string> {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenSha = createHash('sha256').update(rawToken).digest('hex');
    const dbPool = createPool({ max: 1 });
    await dbPool.query(
      `INSERT INTO auth_magic_link (email, token_sha256, expires_at)
       VALUES ($1, $2, now() + interval '15 minutes')`,
      ['nav-test@example.com', tokenSha],
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

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    // Get fresh access token after each truncate
    accessToken = await getAccessToken();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('Route serving', () => {
    it('serves /app/activity route', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/activity',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('data-testid="app-frontend-shell"');
    });

    it('serves /app/work-items route', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/work-items',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('data-testid="app-frontend-shell"');
    });

    it('serves /app/timeline route', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/timeline',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('data-testid="app-frontend-shell"');
    });

    it('serves /app/contacts route', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/contacts',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('data-testid="app-frontend-shell"');
    });
  });

  describe('Bootstrap data includes route info', () => {
    it('includes route kind in bootstrap for /app/activity', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/activity',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('app-bootstrap');
      expect(res.body).toContain('"route"');
      expect(res.body).toContain('"activity"');
    });

    it('includes route kind in bootstrap for /app/timeline', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/timeline',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('app-bootstrap');
      expect(res.body).toContain('"route"');
      expect(res.body).toContain('"timeline"');
    });

    it('includes route kind in bootstrap for /app/contacts', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/contacts',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('app-bootstrap');
      expect(res.body).toContain('"route"');
      expect(res.body).toContain('"contacts"');
    });
  });
});
