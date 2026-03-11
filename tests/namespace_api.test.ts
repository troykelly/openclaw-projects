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

async function getM2MHeadersLimited(): Promise<Record<string, string>> {
  const token = await signM2MToken('test-service-limited', ['api:read']);
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
    // Clean up auto-created user_setting rows for M2M identities (Issue #2413)
    await pool.query(`DELETE FROM namespace_grant WHERE email IN ('test-service', 'test-service-limited', 'agent-no-user-setting-row', 'agent-no-user-row')`);
    await pool.query(`DELETE FROM user_setting WHERE email IN ('test-service', 'test-service-limited', 'agent-no-user-setting-row', 'agent-no-user-row')`);
  });

  // ============================================================
  // Namespace Management API (#1473)
  // ============================================================
  describe('Namespace Management API', () => {
    describe('GET /namespaces', () => {
      it('returns 401 without auth', async () => {
        const res = await app.inject({ method: 'GET', url: '/namespaces' });
        expect(res.statusCode).toBe(401);
      });

      it('returns user namespaces for user token', async () => {
        // Setup: create user and grants
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'test-ns-one', 'readwrite', true)`,
          [TEST_EMAIL],
        );
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'test-ns-two', 'readwrite', false)`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({ method: 'GET', url: '/namespaces', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body).toHaveLength(2);
        expect(body[0].namespace).toBe('test-ns-one');
        expect(body[1].namespace).toBe('test-ns-two');
      });

      it('returns ALL namespaces for M2M token with api:full scope (#1561)', async () => {
        // Setup: create grants for M2M identity and a user
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, ['test-service']);
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-m2m-granted', 'readwrite')`,
          ['test-service'],
        );
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-user-only', 'readwrite')`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeaders();
        const res = await app.inject({ method: 'GET', url: '/namespaces', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
        const nsNames = body.map((r: { namespace: string }) => r.namespace);
        // M2M with api:full should see ALL namespaces (#1561)
        expect(nsNames).toContain('test-ns-m2m-granted');
        expect(nsNames).toContain('test-ns-user-only');
      });

      it('returns only granted namespaces for M2M token without api:full scope', async () => {
        // Setup: create grants for the limited M2M identity and a user
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, ['test-service-limited']);
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-limited-granted', 'readwrite')`,
          ['test-service-limited'],
        );
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-user-only2', 'readwrite')`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeadersLimited();
        const res = await app.inject({ method: 'GET', url: '/namespaces', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
        const nsNames = body.map((r: { namespace: string }) => r.namespace);
        expect(nsNames).toContain('test-ns-limited-granted');
        // Should NOT see the user-only namespace (no api:full scope)
        expect(nsNames).not.toContain('test-ns-user-only2');
      });

      it('returns empty list for M2M token with no grants and no api:full', async () => {
        const headers = await getM2MHeadersLimited();
        const res = await app.inject({ method: 'GET', url: '/namespaces', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body).toHaveLength(0);
      });
    });

    describe('POST /namespaces', () => {
      it('returns 400 when name is missing', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: {},
        });
        expect(res.statusCode).toBe(400);
      });

      it('returns 400 for invalid namespace name', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { name: '-invalid' },
        });
        expect(res.statusCode).toBe(400);
      });

      it('returns 400 for reserved namespace', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { name: 'system' },
        });
        expect(res.statusCode).toBe(400);
      });

      it('creates namespace with M2M token', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { name: 'test-ns-created' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({ namespace: 'test-ns-created', created: true });
      });

      it('creates readwrite grant using X-User-Email header for M2M tokens (#1567)', async () => {
        // Setup: user_setting row for the real email
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/namespaces',
          headers: {
            ...headers,
            'content-type': 'application/json',
            // X-Agent-Id is "test-service" (from getM2MHeaders), but X-User-Email is the real email
            'x-user-email': TEST_EMAIL,
          },
          payload: { name: 'test-ns-email-grant' },
        });
        expect(res.statusCode).toBe(201);

        // Verify grant was created for the email, not the agent ID
        const grant = await pool.query(
          `SELECT email, access FROM namespace_grant WHERE namespace = 'test-ns-email-grant'`,
        );
        expect(grant.rows).toHaveLength(1);
        expect(grant.rows[0].email).toBe(TEST_EMAIL);
        expect(grant.rows[0].access).toBe('readwrite');
      });

      it('auto-upserts user_setting when M2M identity has no matching row (#2413)', async () => {
        // Issue #2413: Changed from 422 error to auto-upsert so namespace_create
        // works for new users without requiring separate user provisioning.
        const token = await signM2MToken('agent-no-user-setting-row', ['api:full']);
        const headers = { authorization: `Bearer ${token}` };
        const res = await app.inject({
          method: 'POST', url: '/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { name: 'test-ns-no-grant' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({ namespace: 'test-ns-no-grant', created: true });

        // Verify user_setting was auto-created
        const userRow = await pool.query(
          `SELECT 1 FROM user_setting WHERE email = 'agent-no-user-setting-row'`,
        );
        expect(userRow.rows).toHaveLength(1);
      });

      it('creates namespace with user token and grants readwrite access', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'POST', url: '/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { name: 'test-ns-user-created' },
        });
        expect(res.statusCode).toBe(201);

        // Verify grant was created
        const grant = await pool.query(
          `SELECT access FROM namespace_grant WHERE email = $1 AND namespace = 'test-ns-user-created'`,
          [TEST_EMAIL],
        );
        expect(grant.rows[0].access).toBe('readwrite');
      });

      it('returns 409 for duplicate namespace', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-dup', 'readwrite')`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/namespaces',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { name: 'test-ns-dup' },
        });
        expect(res.statusCode).toBe(409);
      });
    });

    describe('GET /namespaces/:ns', () => {
      it('returns namespace details with member list', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'test-ns-detail', 'readwrite', true)`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({ method: 'GET', url: '/namespaces/test-ns-detail', headers });
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
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-forbidden', 'readwrite')`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL_2);
        const res = await app.inject({ method: 'GET', url: '/namespaces/test-ns-forbidden', headers });
        expect(res.statusCode).toBe(403);
      });

      it('M2M can view any namespace', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-m2m-view', 'readwrite')`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeaders();
        const res = await app.inject({ method: 'GET', url: '/namespaces/test-ns-m2m-view', headers });
        expect(res.statusCode).toBe(200);
        expect(res.json().namespace).toBe('test-ns-m2m-view');
      });

      it('returns members with defined access field for M2M token (#1883)', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'test-ns-m2m-members', 'readwrite', true)`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeaders();
        const res = await app.inject({ method: 'GET', url: '/namespaces/test-ns-m2m-members', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body.namespace).toBe('test-ns-m2m-members');
        expect(Array.isArray(body.members)).toBe(true);
        expect(body.members.length).toBeGreaterThan(0);
        // Verify each member has a defined access field (not undefined)
        for (const member of body.members) {
          expect(member.email).toBeDefined();
          expect(member.access).toBeDefined();
          expect(typeof member.access).toBe('string');
          expect(member.access.length).toBeGreaterThan(0);
        }
        expect(body.member_count).toBe(body.members.length);
      });
    });

    describe('GET /namespaces/:ns/grants', () => {
      it('lists grants for namespace', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-grants', 'readwrite')`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({ method: 'GET', url: '/namespaces/test-ns-grants/grants', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body).toHaveLength(1);
        expect(body[0].email).toBe(TEST_EMAIL);
        expect(body[0].access).toBe('readwrite');
      });
    });

    describe('POST /namespaces/:ns/grants', () => {
      it('grants access to user', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL_2]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-grant-add', 'readwrite')`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'POST', url: '/namespaces/test-ns-grant-add/grants',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL_2, access: 'readwrite' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().email).toBe(TEST_EMAIL_2);
        expect(res.json().access).toBe('readwrite');
      });

      it('returns 400 for invalid access level', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL_2]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-grant-bad', 'readwrite')`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'POST', url: '/namespaces/test-ns-grant-bad/grants',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL_2, access: 'superuser' },
        });
        expect(res.statusCode).toBe(400);
      });

      it('returns 404 for nonexistent user', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-grant-nouser', 'readwrite')`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'POST', url: '/namespaces/test-ns-grant-nouser/grants',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: 'nonexistent@example.com', access: 'readwrite' },
        });
        expect(res.statusCode).toBe(404);
      });

      it('upserts on duplicate grant', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-upsert', 'readwrite')`,
          [TEST_EMAIL],
        );
        // Issue #2364: M2M with api:full bypasses requireNamespaceAdmin — no grant row needed

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/namespaces/test-ns-upsert/grants',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL, access: 'readwrite' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().access).toBe('readwrite');

        // Verify only one grant exists
        const count = await pool.query(
          `SELECT count(*) FROM namespace_grant WHERE email = $1 AND namespace = 'test-ns-upsert'`,
          [TEST_EMAIL],
        );
        expect(parseInt(count.rows[0].count)).toBe(1);
      });
    });

    describe('PATCH /namespaces/:ns/grants/:id', () => {
      it('updates grant access level', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        const grant = await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-patch', 'readwrite') RETURNING id::text`,
          [TEST_EMAIL],
        );
        const grantId = grant.rows[0].id;
        // Issue #2364: M2M with api:full bypasses requireNamespaceAdmin — no grant row needed

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'PATCH', url: `/namespaces/test-ns-patch/grants/${grantId}`,
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { access: 'readwrite' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().access).toBe('readwrite');
      });

      it('returns 404 for nonexistent grant', async () => {
        // Issue #2364: M2M with api:full bypasses requireNamespaceAdmin — no grant row needed
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'PATCH', url: '/namespaces/test-ns-patch/grants/00000000-0000-0000-0000-000000000000',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { access: 'readwrite' },
        });
        expect(res.statusCode).toBe(404);
      });
    });

    describe('DELETE /namespaces/:ns/grants/:id', () => {
      it('deletes grant', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        const grant = await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-del', 'readwrite') RETURNING id::text`,
          [TEST_EMAIL],
        );
        const grantId = grant.rows[0].id;
        // Issue #2364: M2M with api:full bypasses requireNamespaceAdmin — no grant row needed

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'DELETE', url: `/namespaces/test-ns-del/grants/${grantId}`,
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
        // Issue #2364: M2M with api:full bypasses requireNamespaceAdmin — no grant row needed
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'DELETE', url: '/namespaces/test-ns-del/grants/00000000-0000-0000-0000-000000000000',
          headers,
        });
        expect(res.statusCode).toBe(404);
      });
    });

    // Issue #2364: M2M api:full bypass for requireNamespaceAdmin
    describe('M2M api:full bypass (Issue #2364)', () => {
      it('M2M + api:full can grant access WITHOUT a pre-existing grant row', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        // NOTE: no grant row for 'test-service' in 'test-ns-m2m-bypass'
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/namespaces/test-ns-m2m-bypass/grants',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL, access: 'readwrite' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().email).toBe(TEST_EMAIL);
      });

      it('M2M without api:full gets 403 on grant creation', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, ['test-service-limited']);
        const headers = await getM2MHeadersLimited();
        const res = await app.inject({
          method: 'POST', url: '/namespaces/test-ns-m2m-noscope/grants',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL, access: 'readwrite' },
        });
        expect(res.statusCode).toBe(403);
      });

      it('user token without grant gets 403 on grant creation', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'POST', url: '/namespaces/test-ns-user-noaccess/grants',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL, access: 'readwrite' },
        });
        expect(res.statusCode).toBe(403);
      });
    });
  });

  // ============================================================
  // Issue #2413: namespace_create auto-upserts user_setting row
  // ============================================================
  describe('namespace_create auto-upsert user_setting (Issue #2413)', () => {
    it('auto-creates user_setting for M2M identity without pre-existing row', async () => {
      // The M2M identity "test-service" has no user_setting row.
      // namespace_create should auto-upsert it so the FK constraint is satisfied.
      const headers = await getM2MHeaders();
      const res = await app.inject({
        method: 'POST', url: '/namespaces',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { name: 'test-ns-auto-upsert' },
      });
      expect(res.statusCode).toBe(201);

      // Verify user_setting was auto-created
      const userRow = await pool.query(
        `SELECT 1 FROM user_setting WHERE email = 'test-service'`,
      );
      expect(userRow.rows).toHaveLength(1);

      // Verify the grant was created
      const grant = await pool.query(
        `SELECT email, access FROM namespace_grant WHERE namespace = 'test-ns-auto-upsert'`,
      );
      expect(grant.rows).toHaveLength(1);
      expect(grant.rows[0].email).toBe('test-service');
    });

    it('auto-creates user_setting for X-User-Email header target', async () => {
      // X-User-Email points to a user that has no user_setting row.
      const headers = await getM2MHeaders();
      const res = await app.inject({
        method: 'POST', url: '/namespaces',
        headers: {
          ...headers,
          'content-type': 'application/json',
          'x-user-email': TEST_EMAIL,
        },
        payload: { name: 'test-ns-auto-upsert-email' },
      });
      expect(res.statusCode).toBe(201);

      // Verify user_setting was auto-created for the target email
      const userRow = await pool.query(
        `SELECT 1 FROM user_setting WHERE email = $1`,
        [TEST_EMAIL],
      );
      expect(userRow.rows).toHaveLength(1);

      // Verify grant was created for the target email
      const grant = await pool.query(
        `SELECT email, access FROM namespace_grant WHERE namespace = 'test-ns-auto-upsert-email'`,
      );
      expect(grant.rows).toHaveLength(1);
      expect(grant.rows[0].email).toBe(TEST_EMAIL);
    });

    it('auto-creates user_setting for user token without pre-existing row', async () => {
      // User token path: user has no user_setting row yet.
      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'POST', url: '/namespaces',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { name: 'test-ns-user-auto-upsert' },
      });
      expect(res.statusCode).toBe(201);

      // Verify user_setting was auto-created
      const userRow = await pool.query(
        `SELECT 1 FROM user_setting WHERE email = $1`,
        [TEST_EMAIL],
      );
      expect(userRow.rows).toHaveLength(1);
    });

    it('succeeds when M2M user already has user_setting row (idempotent)', async () => {
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
      const headers = await getM2MHeaders();
      const res = await app.inject({
        method: 'POST', url: '/namespaces',
        headers: {
          ...headers,
          'content-type': 'application/json',
          'x-user-email': TEST_EMAIL,
        },
        payload: { name: 'test-ns-m2m-user-ok' },
      });
      expect(res.statusCode).toBe(201);

      // Verify the grant was created
      const grant = await pool.query(
        `SELECT email, access FROM namespace_grant WHERE namespace = 'test-ns-m2m-user-ok'`,
      );
      expect(grant.rows).toHaveLength(1);
      expect(grant.rows[0].email).toBe(TEST_EMAIL);
    });
  });

  // ============================================================
  // Issue #2403: namespace_grant accepts 'role' as alias for 'access'
  // ============================================================
  describe('namespace_grant role alias (Issue #2403)', () => {
    it('accepts role param as alias for access', async () => {
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL_2]);
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-role-alias', 'readwrite')`,
        [TEST_EMAIL],
      );

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'POST', url: '/namespaces/test-ns-role-alias/grants',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { email: TEST_EMAIL_2, role: 'read' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.access).toBe('read');
      expect(body.email).toBe(TEST_EMAIL_2);
    });

    it('accepts is_default as alias for is_home', async () => {
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL_2]);
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-default-alias', 'readwrite')`,
        [TEST_EMAIL],
      );

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'POST', url: '/namespaces/test-ns-default-alias/grants',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { email: TEST_EMAIL_2, access: 'read', is_default: true },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().is_home).toBe(true);
    });

    it('prefers access over role when both provided', async () => {
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL_2]);
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-access-pref', 'readwrite')`,
        [TEST_EMAIL],
      );

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'POST', url: '/namespaces/test-ns-access-pref/grants',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { email: TEST_EMAIL_2, access: 'readwrite', role: 'read' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().access).toBe('readwrite');
    });
  });

  // ============================================================
  // Issue #2405: GET /me/grants endpoint
  // ============================================================
  describe('GET /me/grants (Issue #2405)', () => {
    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/me/grants' });
      expect(res.statusCode).toBe(401);
    });

    it('returns namespace grants for authenticated user', async () => {
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'test-ns-me-home', 'readwrite', true)`,
        [TEST_EMAIL],
      );
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'test-ns-me-other', 'read', false)`,
        [TEST_EMAIL],
      );

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({ method: 'GET', url: '/me/grants', headers });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.namespace_grants).toHaveLength(2);
      expect(body.namespace_grants[0].namespace).toBe('test-ns-me-home');
      expect(body.namespace_grants[0].is_home).toBe(true);
      expect(body.active_namespaces).toContain('test-ns-me-home');
    });

    it('returns empty grants for user with no namespace access', async () => {
      await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({ method: 'GET', url: '/me/grants', headers });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.namespace_grants).toHaveLength(0);
      expect(body.active_namespaces).toEqual(['default']);
    });
  });

  // ============================================================
  // User Provisioning API (#1474)
  // ============================================================
  describe('User Provisioning API', () => {
    describe('POST /users', () => {
      it('returns 403 for user tokens', async () => {
        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'POST', url: '/users',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: 'new-user@example.com' },
        });
        expect(res.statusCode).toBe(403);
      });

      it('returns 400 when email is missing', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/users',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: {},
        });
        expect(res.statusCode).toBe(400);
      });

      it('provisions user with auto-namespace', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/users',
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
          (g: { namespace: string; access: string }) => g.namespace === 'ns-api-test' && g.access === 'readwrite',
        );
        expect(ownerGrant).toBeDefined();
        expect(ownerGrant.is_home).toBe(true);

        // Should have member grant on 'default' namespace
        const defaultGrant = body.grants.find(
          (g: { namespace: string }) => g.namespace === 'default',
        );
        expect(defaultGrant).toBeDefined();
      });

      it('provisions user with custom namespace', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'POST', url: '/users',
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
          method: 'POST', url: '/users',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { email: TEST_EMAIL },
        });
        expect(res1.statusCode).toBe(201);

        // Second call (same email)
        const res2 = await app.inject({
          method: 'POST', url: '/users',
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

    describe('GET /users', () => {
      it('returns 403 for user tokens', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({ method: 'GET', url: '/users', headers });
        expect(res.statusCode).toBe(403);
      });

      it('lists users for M2M token', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-list', 'readwrite')`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeaders();
        const res = await app.inject({ method: 'GET', url: '/users', headers });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
        const user = body.find((u: { email: string }) => u.email === TEST_EMAIL);
        expect(user).toBeDefined();
        expect(user.grants).toBeInstanceOf(Array);
      });
    });

    describe('GET /users/:email', () => {
      it('returns user details with grants', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'test-ns-detail-user', 'readwrite', true)`,
          [TEST_EMAIL],
        );

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'GET', url: `/users/${encodeURIComponent(TEST_EMAIL)}`,
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
          method: 'GET', url: `/users/${encodeURIComponent(TEST_EMAIL_2)}`,
          headers,
        });
        expect(res.statusCode).toBe(403);
      });

      it('M2M can view any user', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'GET', url: `/users/${encodeURIComponent(TEST_EMAIL)}`,
          headers,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().email).toBe(TEST_EMAIL);
      });

      it('returns 404 for nonexistent user', async () => {
        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'GET', url: '/users/nobody@example.com',
          headers,
        });
        expect(res.statusCode).toBe(404);
      });
    });

    describe('PATCH /users/:email', () => {
      it('updates user settings', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'PATCH', url: `/users/${encodeURIComponent(TEST_EMAIL)}`,
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
          method: 'PATCH', url: `/users/${encodeURIComponent(TEST_EMAIL_2)}`,
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { theme: 'dark' },
        });
        expect(res.statusCode).toBe(403);
      });

      it('returns 400 with no updatable fields', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'PATCH', url: `/users/${encodeURIComponent(TEST_EMAIL)}`,
          headers: { ...headers, 'content-type': 'application/json' },
          payload: { invalid_field: 'value' },
        });
        expect(res.statusCode).toBe(400);
      });
    });

    describe('DELETE /users/:email', () => {
      it('returns 403 for user tokens', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);

        const headers = await getAuthHeaders(TEST_EMAIL);
        const res = await app.inject({
          method: 'DELETE', url: `/users/${encodeURIComponent(TEST_EMAIL)}`,
          headers,
        });
        expect(res.statusCode).toBe(403);
      });

      it('deletes user and cascades grants', async () => {
        await pool.query(`INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`, [TEST_EMAIL]);
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'test-ns-del-user', 'readwrite')`,
          [TEST_EMAIL],
        );

        const headers = await getM2MHeaders();
        const res = await app.inject({
          method: 'DELETE', url: `/users/${encodeURIComponent(TEST_EMAIL)}`,
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
          method: 'DELETE', url: '/users/nobody@example.com',
          headers,
        });
        expect(res.statusCode).toBe(404);
      });
    });
  });
});
