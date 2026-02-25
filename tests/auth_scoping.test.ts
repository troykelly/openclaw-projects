/**
 * Tests for auth scoping and principal binding on notification, webhook, and
 * OAuth endpoints. Verifies that:
 * - Notification endpoints enforce user_email via JWT principal binding
 * - M2M tokens without user_email are rejected for notifications
 * - Webhook CRUD is owner-scoped (user can only see/delete own webhooks)
 * - OAuth authorize returns JSON { url } when Accept: application/json
 *
 * These tests temporarily enable auth to exercise the JWT code paths.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import { signTestJwt, signTestM2mJwt, getAuthHeaders, getM2mAuthHeaders } from './helpers/auth.ts';

describe('Auth scoping', () => {
  const app = buildServer();
  let pool: Pool;
  let savedAuthDisabled: string | undefined;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // ── Notification principal binding (auth enabled) ─────────────────────

  describe('Notification principal binding', () => {
    const USER_A = 'user-a@example.com';
    const USER_B = 'user-b@example.com';

    beforeEach(async () => {
      await truncateAllTables(pool);
      // Enable auth for these tests
      savedAuthDisabled = process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
      delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;

      // Create notifications for both users
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'assigned', 'A notification', 'For user A'),
                ($2, 'assigned', 'B notification', 'For user B')`,
        [USER_A, USER_B],
      );
    });

    afterEach(() => {
      // Restore auth state
      if (savedAuthDisabled !== undefined) {
        process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = savedAuthDisabled;
      } else {
        delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
      }
    });

    it('user JWT only sees own notifications', async () => {
      const headers = await getAuthHeaders(USER_A);
      const res = await app.inject({
        method: 'GET',
        url: `/api/notifications?user_email=${encodeURIComponent(USER_A)}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].title).toBe('A notification');
    });

    it('user JWT principal binding overrides query param user_email', async () => {
      // User A tries to read User B's notifications by passing B's email
      const headers = await getAuthHeaders(USER_A);
      const res = await app.inject({
        method: 'GET',
        url: `/api/notifications?user_email=${encodeURIComponent(USER_B)}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Principal binding forces user_email to A, so only A's notifications returned
      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].title).toBe('A notification');
    });

    it('user JWT unread-count is scoped to own notifications', async () => {
      const headers = await getAuthHeaders(USER_A);
      const res = await app.inject({
        method: 'GET',
        url: `/api/notifications/unread-count?user_email=${encodeURIComponent(USER_A)}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().unread_count).toBe(1);
    });

    it('M2M token without user_email is rejected for notification list', async () => {
      const headers = await getM2mAuthHeaders();
      const res = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers,
      });

      expect(res.statusCode).toBe(401);
    });

    it('M2M token with user_email can read that user notifications', async () => {
      const headers = await getM2mAuthHeaders();
      const res = await app.inject({
        method: 'GET',
        url: `/api/notifications?user_email=${encodeURIComponent(USER_B)}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].title).toBe('B notification');
    });

    it('unauthenticated request returns 401 for notifications', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/notifications?user_email=${encodeURIComponent(USER_A)}`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── Webhook ownership enforcement (auth enabled) ──────────────────────

  describe('Webhook ownership enforcement', () => {
    const OWNER = 'webhook-owner@example.com';
    const OTHER = 'other-user@example.com';
    const OWNER_NS = 'webhook-owner';
    let project_id: string;

    beforeEach(async () => {
      await truncateAllTables(pool);
      savedAuthDisabled = process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
      delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;

      // Create user_setting for OWNER (required FK for namespace_grant)
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
        [OWNER],
      );

      // Grant OWNER access to their namespace so resolveNamespaces() returns it
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home)
         VALUES ($1, $2, 'readwrite', true)
         ON CONFLICT (email, namespace) DO NOTHING`,
        [OWNER, OWNER_NS],
      );

      // Create test project in OWNER's namespace
      // (verifyWriteScope/verifyReadScope from #1811 requires namespace-scoped access)
      const result = await pool.query(
        `INSERT INTO work_item (title, kind, namespace) VALUES ('Webhook Test Project', 'project', $1)
         RETURNING id::text as id`,
        [OWNER_NS],
      );
      project_id = (result.rows[0] as { id: string }).id;
    });

    afterEach(() => {
      if (savedAuthDisabled !== undefined) {
        process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = savedAuthDisabled;
      } else {
        delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
      }
    });

    it('owner can list their own webhooks', async () => {
      const ownerHeaders = await getAuthHeaders(OWNER);

      // Create webhook as owner
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        headers: ownerHeaders,
        payload: { label: 'Owner Hook' },
      });
      expect(createRes.statusCode).toBe(201);

      // Owner can list
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/webhooks`,
        headers: ownerHeaders,
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json()).toHaveLength(1);
      expect(listRes.json()[0].label).toBe('Owner Hook');
    });

    it('other user cannot see webhooks they did not create', async () => {
      const ownerHeaders = await getAuthHeaders(OWNER);
      const otherHeaders = await getAuthHeaders(OTHER);

      // Create webhook as owner
      await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        headers: ownerHeaders,
        payload: { label: 'Owner Only' },
      });

      // Other user has no namespace access to the project (#1811) — gets 404
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/webhooks`,
        headers: otherHeaders,
      });
      expect(listRes.statusCode).toBe(404);
    });

    it('other user cannot delete webhook they did not create', async () => {
      const ownerHeaders = await getAuthHeaders(OWNER);
      const otherHeaders = await getAuthHeaders(OTHER);

      // Create webhook as owner
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        headers: ownerHeaders,
        payload: { label: 'Protected Hook' },
      });
      const webhookId = createRes.json().id;

      // Other user has no namespace access to the project (#1811) — gets 404
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${project_id}/webhooks/${webhookId}`,
        headers: otherHeaders,
      });
      expect(deleteRes.statusCode).toBe(404);

      // Owner can still see it
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/webhooks`,
        headers: ownerHeaders,
      });
      expect(listRes.json()).toHaveLength(1);
    });

    it('webhook list masks tokens', async () => {
      const ownerHeaders = await getAuthHeaders(OWNER);

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        headers: ownerHeaders,
        payload: { label: 'Token Mask Test' },
      });

      const listRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/webhooks`,
        headers: ownerHeaders,
      });

      const webhook = listRes.json()[0];
      // Token should be masked (first 8 chars + ...)
      expect(webhook.token).toMatch(/^.{8}\.\.\.$/);
    });

    it('unauthenticated webhook list returns 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/webhooks`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── OAuth authorize JSON mode ─────────────────────────────────────────

  describe('OAuth authorize JSON mode', () => {
    beforeEach(async () => {
      savedAuthDisabled = process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
      // Keep auth disabled for OAuth tests since we need the providers configured
      // but don't want to deal with real OAuth state
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
    });

    afterEach(() => {
      if (savedAuthDisabled !== undefined) {
        process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = savedAuthDisabled;
      } else {
        delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
      }
    });

    it('returns JSON { url } when Accept: application/json', async () => {
      // Only test if a provider is actually configured
      const providersRes = await app.inject({
        method: 'GET',
        url: '/api/oauth/providers',
      });

      if (providersRes.statusCode !== 200) {
        // Skip if OAuth not configured
        return;
      }

      const { providers } = providersRes.json() as { providers: Array<{ name: string; configured: boolean }> };
      const configured = providers.find((p) => p.configured);
      if (!configured) {
        // No providers configured — skip gracefully
        return;
      }

      const res = await app.inject({
        method: 'GET',
        url: `/api/oauth/authorize/${configured.name}`,
        headers: { accept: 'application/json' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.url).toBeDefined();
      expect(typeof body.url).toBe('string');
      expect(body.url).toMatch(/^https?:\/\//);
    });

    it('returns 302 redirect without Accept: application/json', async () => {
      const providersRes = await app.inject({
        method: 'GET',
        url: '/api/oauth/providers',
      });

      if (providersRes.statusCode !== 200) return;

      const { providers } = providersRes.json() as { providers: Array<{ name: string; configured: boolean }> };
      const configured = providers.find((p) => p.configured);
      if (!configured) return;

      const res = await app.inject({
        method: 'GET',
        url: `/api/oauth/authorize/${configured.name}`,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBeDefined();
    });

    it('returns 400 for unknown provider', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/oauth/authorize/unknown-provider',
        headers: { accept: 'application/json' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
