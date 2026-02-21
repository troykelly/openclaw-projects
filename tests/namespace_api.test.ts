import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import { signTestJwt, getAuthHeaders } from './helpers/auth.ts';
import { signM2MToken } from '../src/api/auth/jwt.ts';

/**
 * Integration tests for Namespace Management API (#1473) and
 * User Provisioning API (#1474).
 */

const TEST_EMAIL = 'ns-api-test@example.com';
const TEST_EMAIL_2 = 'ns-api-test-2@example.com';

async function getM2MHeaders(): Promise<Record<string, string>> {
  const token = await signM2MToken('test-service', ['api:full']);
  return { authorization: `Bearer ${token}` };
}

describe('Namespace & User Provisioning API', () => {
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
    // Clean up test data in correct FK order
    await pool.query(`DELETE FROM namespace_grant WHERE email LIKE 'ns-api-test%'`);
    await pool.query(`DELETE FROM user_setting WHERE email LIKE 'ns-api-test%'`);
    // Clean up namespaces created by tests (grants without test emails)
    await pool.query(`DELETE FROM namespace_grant WHERE namespace LIKE 'test-ns-%'`);
  });

  // ============================================================
  // Namespace Management API (#1473)
  // ============================================================
  describe('Namespace Management API', () => {
    describe('GET /api/namespaces', () => {
      it('returns 401 without auth', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/namespaces' });
        expect(res.statusCode).toBe(401);
      });

      it('returns user namespaces for user token', async () => {
        // Setup: create user and grants
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role, is_default) VALUES ($1, 'test-ns-one', 'owner', true)`,
          [TEST_EMAIL],
        );
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role, is_default) VALUES ($1, 'test-ns-two', 'member', false)`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({ method: 'GET', url: '/api/namespaces', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body).toHaveLength(2);
        expect(body[0].namespace).toBe('test-ns-one');
        expect(body[1].namespace).toBe('test-ns-two');
      });

      it('returns only granted namespaces for M2M token', async () => {
        // Setup: create a grant for the M2M identity (test-service)
        // and a separate grant for a user — M2M should NOT see the user's namespace
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, ['test-service']);
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-m2m-granted', 'owner')`,
          ['test-service'],
        );
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-user-only', 'owner')`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeaders();
        const res = await app.inject({ method: 'GET', url: '/api/namespaces', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
        const nsNames = body.map((r: { namespace: string }) => r.namespace);
        // Should see its own grant
        expect(nsNames).toContain('test-ns-m2m-granted');
        // Should NOT see the user-only namespace
        expect(nsNames).not.toContain('test-ns-user-only');
      });

      it('returns empty list for M2M token with no grants', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({ method: 'GET', url: '/api/namespaces', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body).toHaveLength(0);
      });
    });

    describe('POST /api/namespaces', () => {
      it('returns 400 when name is missing', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/api/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: {},
        });
        expect(res.statusCode).toBe(400);
      });

      it('returns 400 for invalid namespace name', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/api/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { name: '-invalid' },
        });
        expect(res.statusCode).toBe(400);
      });

      it('returns 400 for reserved namespace', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/api/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { name: 'system' },
        });
        expect(res.statusCode).toBe(400);
      });

      it('creates namespace with M2M token', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/api/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { name: 'test-ns-created' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({ namespace: 'test-ns-created', created: true });
      });

      it('creates namespace with user token and grants owner role', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'POST', url: '/api/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { name: 'test-ns-user-created' },
        });
        expect(res.statusCode).toBe(201);

        // Verify grant was created
        const grant = await pool.query(
          `SELECT role FROM namespace_grant WHERE email = $1 AND namespace = 'test-ns-user-created'`,
          [TEST_EMAIL],
        );
        expect(grant.rows[0].role).toBe('owner');
      });

      it('returns 409 for duplicate namespace', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-dup', 'owner')`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/api/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { name: 'test-ns-dup' },
        });
        expect(res.statusCode).toBe(409);
      });
    });

    describe('GET /api/namespaces/:ns', () => {
      it('returns namespace details with member list', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role, is_default) VALUES ($1, 'test-ns-detail', 'owner', true)`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({ method: 'GET', url: '/api/namespaces/test-ns-detail', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body.namespace).toBe('test-ns-detail');
        expect(body.members).toHaveLength(1);
        expect(body.members[0].email).toBe(TEST_EMAIL);
        expect(body.member_count).toBe(1);
      });

      it('returns 403 for user without access', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL_2]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-forbidden', 'owner')`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL_2);
        const res = await app.inject({ method: 'GET', url: '/api/namespaces/test-ns-forbidden', headers });
        expect(res.statusCode).toBe(403);
      });

      it('M2M can view any namespace', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-m2m-view', 'owner')`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeaders();
        const res = await app.inject({ method: 'GET', url: '/api/namespaces/test-ns-m2m-view', headers });
        expect(res.statusCode).toBe(200);
        expect(res.json().namespace).toBe('test-ns-m2m-view');
      });
    });

    describe('GET /api/namespaces/:ns/grants', () => {
      it('lists grants for namespace', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-grants', 'owner')`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({ method: 'GET', url: '/api/namespaces/test-ns-grants/grants', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body).toHaveLength(1);
        expect(body[0].email).toBe(TEST_EMAIL);
        expect(body[0].role).toBe('owner');
      });
    });

    describe('POST /api/namespaces/:ns/grants', () => {
      it('grants access to user', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL_2]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-grant-add', 'owner')`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'POST', url: '/api/namespaces/test-ns-grant-add/grants',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL_2, role: 'member' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().email).toBe(TEST_EMAIL_2);
        expect(res.json().role).toBe('member');
      });

      it('returns 400 for invalid role', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL_2]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-grant-bad', 'owner')`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'POST', url: '/api/namespaces/test-ns-grant-bad/grants',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL_2, role: 'superuser' },
        });
        expect(res.statusCode).toBe(400);
      });

      it('returns 404 for nonexistent user', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-grant-nouser', 'owner')`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'POST', url: '/api/namespaces/test-ns-grant-nouser/grants',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: 'nonexistent@example.com', role: 'member' },
        });
        expect(res.statusCode).toBe(404);
      });

      it('upserts on duplicate grant', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-upsert', 'member')`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/api/namespaces/test-ns-upsert/grants',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL, role: 'admin' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().role).toBe('admin');

        // Verify only one grant exists
        const count = await pool.query(
          `SELECT count(*) FROM namespace_grant WHERE email = $1 AND namespace = 'test-ns-upsert'`,
          [TEST_EMAIL],
        );
        expect(parseInt(count.rows[0].count)).toBe(1);
      });
    });

    describe('PATCH /api/namespaces/:ns/grants/:id', () => {
      it('updates grant role', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        const grant = await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-patch', 'member') RETURNING id::text`,
          [TEST_EMAIL],
        );
        const grantId = grant.rows[0].id;

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'PATCH', url: `/api/namespaces/test-ns-patch/grants/${grantId}`,
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { role: 'admin' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().role).toBe('admin');
      });

      it('returns 404 for nonexistent grant', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'PATCH', url: '/api/namespaces/test-ns-patch/grants/00000000-0000-0000-0000-000000000000',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { role: 'admin' },
        });
        expect(res.statusCode).toBe(404);
      });
    });

    describe('DELETE /api/namespaces/:ns/grants/:id', () => {
      it('deletes grant', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        const grant = await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-del', 'member') RETURNING id::text`,
          [TEST_EMAIL],
        );
        const grantId = grant.rows[0].id;

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'DELETE', url: `/api/namespaces/test-ns-del/grants/${grantId}`,
          headers,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().deleted).toBe(true);

        // Verify deleted
        const check = await pool.query(
          `SELECT 1 FROM namespace_grant WHERE id = $1`,
          [grantId],
        );
        expect(check.rows).toHaveLength(0);
      });

      it('returns 404 for nonexistent grant', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'DELETE', url: '/api/namespaces/test-ns-del/grants/00000000-0000-0000-0000-000000000000',
          headers,
        });
        expect(res.statusCode).toBe(404);
      });
    });
  });

  // ============================================================
  // User Provisioning API (#1474)
  // ============================================================
  describe('User Provisioning API', () => {
    describe('POST /api/users', () => {
      it('returns 403 for user tokens', async () => {
        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'POST', url: '/api/users',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: 'new-user@example.com' },
        });
        expect(res.statusCode).toBe(403);
      });

      it('returns 400 when email is missing', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/api/users',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: {},
        });
        expect(res.statusCode).toBe(400);
      });

      it('provisions user with auto-namespace', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/api/users',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL },
        });
        expect(res.statusCode).toBe(201);

        const body = res.json();
        expect(body.email).toBe(TEST_EMAIL);
        expect(body.default_namespace).toBe('ns-api-test');
        expect(body.grants).toBeInstanceOf(Array);
        expect(body.grants.length).toBeGreaterThanOrEqual(2); // personal + default

        // Should have owner grant on personal namespace
        const ownerGrant = body.grants.find(
          (g: { namespace: string; role: string }) => g.namespace === 'ns-api-test' && g.role === 'owner',
        );
        expect(ownerGrant).toBeDefined();
        expect(ownerGrant.is_default).toBe(true);

        // Should have member grant on 'default' namespace
        const defaultGrant = body.grants.find(
          (g: { namespace: string }) => g.namespace === 'default',
        );
        expect(defaultGrant).toBeDefined();
      });

      it('provisions user with custom namespace', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/api/users',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL, namespace: 'test-ns-custom' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().default_namespace).toBe('test-ns-custom');
      });

      it('is idempotent for existing user', async () => {
        const headers = await getM2MHeaders();

        // First call
        const res1 = await app.inject({
          method: 'POST', url: '/api/users',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL },
        });
        expect(res1.statusCode).toBe(201);

        // Second call (same email)
        const res2 = await app.inject({
          method: 'POST', url: '/api/users',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL },
        });
        expect(res2.statusCode).toBe(201);

        // Should still have same grants
        const grants = await pool.query(
          `SELECT count(*) FROM namespace_grant WHERE email = $1`,
          [TEST_EMAIL],
        );
        expect(parseInt(grants.rows[0].count)).toBeGreaterThanOrEqual(2);
      });
    });

    describe('GET /api/users', () => {
      it('returns 403 for user tokens', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({ method: 'GET', url: '/api/users', headers });
        expect(res.statusCode).toBe(403);
      });

      it('lists users for M2M token', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-list', 'owner')`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeaders();
        const res = await app.inject({ method: 'GET', url: '/api/users', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
        const user = body.find((u: { email: string }) => u.email === TEST_EMAIL);
        expect(user).toBeDefined();
        expect(user.grants).toBeInstanceOf(Array);
      });
    });

    describe('GET /api/users/:email', () => {
      it('returns user details with grants', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role, is_default) VALUES ($1, 'test-ns-detail-user', 'owner', true)`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'GET', url: `/api/users/${encodeURIComponent(TEST_EMAIL)}`,
          headers,
        });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body.email).toBe(TEST_EMAIL);
        expect(body.grants).toBeInstanceOf(Array);
        expect(body.grants.length).toBeGreaterThanOrEqual(1);
      });

      it('returns 403 when user views another user profile', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL_2]);

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'GET', url: `/api/users/${encodeURIComponent(TEST_EMAIL_2)}`,
          headers,
        });
        expect(res.statusCode).toBe(403);
      });

      it('M2M can view any user', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'GET', url: `/api/users/${encodeURIComponent(TEST_EMAIL)}`,
          headers,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().email).toBe(TEST_EMAIL);
      });

      it('returns 404 for nonexistent user', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'GET', url: '/api/users/nobody@example.com',
          headers,
        });
        expect(res.statusCode).toBe(404);
      });
    });

    describe('PATCH /api/users/:email', () => {
      it('updates user settings', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'PATCH', url: `/api/users/${encodeURIComponent(TEST_EMAIL)}`,
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { theme: 'dark', timezone: 'America/New_York' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().theme).toBe('dark');
        expect(res.json().timezone).toBe('America/New_York');
      });

      it('returns 403 when user updates another user', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL_2]);

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'PATCH', url: `/api/users/${encodeURIComponent(TEST_EMAIL_2)}`,
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { theme: 'dark' },
        });
        expect(res.statusCode).toBe(403);
      });

      it('returns 400 with no updatable fields', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'PATCH', url: `/api/users/${encodeURIComponent(TEST_EMAIL)}`,
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { invalid_field: 'value' },
        });
        expect(res.statusCode).toBe(400);
      });
    });

    describe('DELETE /api/users/:email', () => {
      it('returns 403 for user tokens', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'DELETE', url: `/api/users/${encodeURIComponent(TEST_EMAIL)}`,
          headers,
        });
        expect(res.statusCode).toBe(403);
      });

      it('deletes user and cascades grants', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, role) VALUES ($1, 'test-ns-del-user', 'owner')`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'DELETE', url: `/api/users/${encodeURIComponent(TEST_EMAIL)}`,
          headers,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().deleted).toBe(true);

        // Verify user and grants are gone
        const userCheck = await pool.query(`SELECT 1 FROM user_setting WHERE email = $1`, [TEST_EMAIL]);
        expect(userCheck.rows).toHaveLength(0);

        const grantCheck = await pool.query(`SELECT 1 FROM namespace_grant WHERE email = $1`, [TEST_EMAIL]);
        expect(grantCheck.rows).toHaveLength(0);
      });

      it('returns 404 for nonexistent user', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'DELETE', url: '/api/users/nobody@example.com',
          headers,
        });
        expect(res.statusCode).toBe(404);
      });
    });
  });
});
