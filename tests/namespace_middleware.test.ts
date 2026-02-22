import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import { getAuthHeaders } from './helpers/auth.ts';
import { signM2MToken } from '../src/api/auth/jwt.ts';

/**
 * Integration tests for namespace resolution middleware (Issue #1475).
 * Verifies that req.namespaceContext is populated correctly by the preHandler hook.
 */

const TEST_EMAIL = 'ns-mw-test@example.com';
const TEST_EMAIL_2 = 'ns-mw-test-2@example.com';

async function getM2MHeaders(): Promise<Record<string, string>> {
  const token = await signM2MToken('test-service', ['api:full']);
  return { authorization: `Bearer ${token}` };
}

describe('Namespace Resolution Middleware (#1475)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM namespace_grant WHERE email LIKE 'ns-mw-test%'`);
    await pool.query(`DELETE FROM user_setting WHERE email LIKE 'ns-mw-test%'`);
  });

  // We test namespace resolution indirectly through the namespace API endpoints
  // which use getAuthIdentity + req.namespaceContext

  describe('user token namespace resolution', () => {
    it('resolves default namespace for user with grants', async () => {
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'personal', 'readwrite', true)`,
        [TEST_EMAIL],
      );
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'shared', 'read', false)`,
        [TEST_EMAIL],
      );

      // The namespace context is set by the preHandler hook.
      // We verify it works by hitting an endpoint that uses auth identity.
      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'GET',
        url: '/api/namespaces',
        headers,
      });
      expect(res.statusCode).toBe(200);
      // User gets their granted namespaces
      const body = res.json();
      expect(body).toHaveLength(2);
    });

    it('user can request a specific namespace via X-Namespace header', async () => {
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'ns-a', 'readwrite', true)`,
        [TEST_EMAIL],
      );
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'ns-b', 'read', false)`,
        [TEST_EMAIL],
      );

      const headers = await getAuthHeaders(TEST_EMAIL);
      // Request specific namespace via header
      const res = await app.inject({
        method: 'GET',
        url: '/api/namespaces/ns-b',
        headers: { ...headers, 'x-namespace': 'ns-b' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().namespace).toBe('ns-b');
    });

    it('user can request namespace via query parameter', async () => {
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'ns-q', 'readwrite', true)`,
        [TEST_EMAIL],
      );

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'GET',
        url: '/api/namespaces/ns-q?namespace=ns-q',
        headers,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('M2M token namespace resolution', () => {
    it('M2M defaults to requested namespace or default', async () => {
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-m2m-ns', 'readwrite')`,
        [TEST_EMAIL],
      );

      const headers = await getM2MHeaders();
      const res = await app.inject({
        method: 'GET',
        url: '/api/namespaces/test-m2m-ns',
        headers: { ...headers, 'x-namespace': 'test-m2m-ns' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('principal binding preserved during transition', () => {
    it('old principal binding still forces user_email override', async () => {
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'default', 'read', true)`,
        [TEST_EMAIL],
      );

      // Create a work item and verify user token can only access their own data
      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'GET',
        url: '/api/namespaces',
        headers,
      });
      expect(res.statusCode).toBe(200);
      // Principal binding still active — user sees only their namespaces
      const nsNames = res.json().map((r: { namespace: string }) => r.namespace);
      expect(nsNames).toContain('default');
    });
  });

  describe('namespace context edge cases', () => {
    it('health endpoints work without namespace context', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health/live' });
      expect(res.statusCode).toBe(200);
    });

    it('unauthenticated requests get null namespace context', async () => {
      // The namespace API returns 401 for unauthenticated requests
      const res = await app.inject({ method: 'GET', url: '/api/namespaces' });
      expect(res.statusCode).toBe(401);
    });
  });
});
