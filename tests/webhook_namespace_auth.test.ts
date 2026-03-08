/**
 * Tests for Issue #2267: Replace getSessionEmail gatekeeper with
 * verifyWriteScope/verifyReadScope as primary auth for project webhooks.
 *
 * Validates:
 * - M2M callers can create/list/delete webhooks without email
 * - Session users retain existing behavior (owner-scoped)
 * - Namespace access denial returns 404
 * - user_email is nullable (NULL for M2M callers)
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';
import { signTestJwt, signTestM2mJwt } from './helpers/auth.ts';

describe('Project Webhooks Namespace Auth (#2267)', () => {
  const app = buildServer();
  let pool: Pool;
  let project_id: string;
  const TEST_EMAIL = 'webhook-ns-test@example.com';

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    // Create user_setting for session-based tests
    await pool.query(
      `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [TEST_EMAIL],
    );
    // Create namespace grant for user token tests
    await pool.query(
      `INSERT INTO namespace_grant (email, namespace, access, is_home)
       VALUES ($1, 'default', 'readwrite', true)
       ON CONFLICT DO NOTHING`,
      [TEST_EMAIL],
    );
    // Create a project in default namespace
    const result = await pool.query(
      `INSERT INTO work_item (title, kind, namespace) VALUES ('Test Project', 'project', 'default')
       RETURNING id::text as id`,
    );
    project_id = (result.rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // ── M2M webhook create ──

  describe('POST /projects/:id/webhooks (M2M)', () => {
    it('M2M caller can create webhook without email — user_email is NULL', async () => {
      const m2mToken = await signTestM2mJwt('test-agent');
      const res = await app.inject({
        method: 'POST',
        url: `/projects/${project_id}/webhooks`,
        headers: {
          authorization: `Bearer ${m2mToken}`,
          'x-namespace': 'default',
        },
        payload: { label: 'M2M Webhook' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.label).toBe('M2M Webhook');
      expect(body.token).toBeDefined();
      expect(body.user_email).toBeNull();
    });

    it('M2M caller denied when project not in accessible namespace', async () => {
      const m2mToken = await signTestM2mJwt('test-agent');
      // Create project in a different namespace
      const otherProject = await pool.query(
        `INSERT INTO work_item (title, kind, namespace) VALUES ('Other Project', 'project', 'secret-ns')
         RETURNING id::text as id`,
      );
      const otherProjectId = (otherProject.rows[0] as { id: string }).id;
      const res = await app.inject({
        method: 'POST',
        url: `/projects/${otherProjectId}/webhooks`,
        headers: {
          authorization: `Bearer ${m2mToken}`,
          'x-namespace': 'default',
        },
        payload: { label: 'Should Fail' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── M2M webhook list ──

  describe('GET /projects/:id/webhooks (M2M)', () => {
    it('M2M caller sees all webhooks for the project (not owner-scoped)', async () => {
      // Create webhooks from two different users
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ('alice@example.com') ON CONFLICT (email) DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO project_webhook (project_id, user_email, label, token)
         VALUES ($1, 'alice@example.com', 'Alice Hook', 'tok-alice')`,
        [project_id],
      );
      await pool.query(
        `INSERT INTO project_webhook (project_id, user_email, label, token)
         VALUES ($1, NULL, 'M2M Hook', 'tok-m2m')`,
        [project_id],
      );

      const m2mToken = await signTestM2mJwt('test-agent');
      const res = await app.inject({
        method: 'GET',
        url: `/projects/${project_id}/webhooks`,
        headers: {
          authorization: `Bearer ${m2mToken}`,
          'x-namespace': 'default',
        },
      });
      expect(res.statusCode).toBe(200);
      const webhooks = res.json();
      expect(webhooks.length).toBe(2);
    });
  });

  // ── M2M webhook delete ──

  describe('DELETE /projects/:id/webhooks/:webhook_id (M2M)', () => {
    it('M2M caller can delete any webhook in an accessible project', async () => {
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ('alice@example.com') ON CONFLICT (email) DO NOTHING`,
      );
      const insertResult = await pool.query(
        `INSERT INTO project_webhook (project_id, user_email, label, token)
         VALUES ($1, 'alice@example.com', 'Delete Me', 'tok-del')
         RETURNING id::text as id`,
        [project_id],
      );
      const webhookId = (insertResult.rows[0] as { id: string }).id;

      const m2mToken = await signTestM2mJwt('test-agent');
      const res = await app.inject({
        method: 'DELETE',
        url: `/projects/${project_id}/webhooks/${webhookId}`,
        headers: {
          authorization: `Bearer ${m2mToken}`,
          'x-namespace': 'default',
        },
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── Session user unchanged ──

  describe('Session user behavior unchanged', () => {
    it('session user creates webhook with their own email', async () => {
      const userToken = await signTestJwt(TEST_EMAIL);
      const res = await app.inject({
        method: 'POST',
        url: `/projects/${project_id}/webhooks`,
        headers: { authorization: `Bearer ${userToken}` },
        payload: { label: 'User Webhook' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().user_email).toBe(TEST_EMAIL);
    });

    it('session user only sees their own webhooks', async () => {
      // Insert a webhook from another user
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ('other@example.com') ON CONFLICT (email) DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO project_webhook (project_id, user_email, label, token)
         VALUES ($1, 'other@example.com', 'Other Hook', 'tok-other')`,
        [project_id],
      );
      // Insert webhook from test user
      await pool.query(
        `INSERT INTO project_webhook (project_id, user_email, label, token)
         VALUES ($1, $2, 'My Hook', 'tok-mine')`,
        [project_id, TEST_EMAIL],
      );

      const userToken = await signTestJwt(TEST_EMAIL);
      const res = await app.inject({
        method: 'GET',
        url: `/projects/${project_id}/webhooks`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(200);
      const webhooks = res.json();
      expect(webhooks.length).toBe(1);
      expect(webhooks[0].user_email).toBe(TEST_EMAIL);
    });

    it('session user cannot delete another user\'s webhook', async () => {
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ('other@example.com') ON CONFLICT (email) DO NOTHING`,
      );
      const insertResult = await pool.query(
        `INSERT INTO project_webhook (project_id, user_email, label, token)
         VALUES ($1, 'other@example.com', 'Others Hook', 'tok-others')
         RETURNING id::text as id`,
        [project_id],
      );
      const webhookId = (insertResult.rows[0] as { id: string }).id;

      const userToken = await signTestJwt(TEST_EMAIL);
      const res = await app.inject({
        method: 'DELETE',
        url: `/projects/${project_id}/webhooks/${webhookId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
