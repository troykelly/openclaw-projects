import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for sidebar navigation wiring (issue #129).
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
  let sessionCookie: string;

  async function getSessionCookie(): Promise<string> {
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'nav-test@example.com' },
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

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    // Get fresh session cookie after each truncate
    sessionCookie = await getSessionCookie();
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
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('data-testid="app-frontend-shell"');
    });

    it('serves /app/work-items route', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/work-items',
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('data-testid="app-frontend-shell"');
    });

    it('serves /app/timeline route', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/timeline',
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('data-testid="app-frontend-shell"');
    });

    it('serves /app/contacts route', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/contacts',
        headers: { cookie: sessionCookie },
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
        headers: { cookie: sessionCookie },
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
        headers: { cookie: sessionCookie },
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
        headers: { cookie: sessionCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('app-bootstrap');
      expect(res.body).toContain('"route"');
      expect(res.body).toContain('"contacts"');
    });
  });
});
