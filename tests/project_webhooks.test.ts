/**
 * Tests for ad-hoc webhook ingestion linked to projects (Issue #1274).
 * Covers schema, webhook CRUD, ingestion endpoint, and event listing.
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Project Webhooks (Issue #1274)', () => {
  const app = buildServer();
  let pool: Pool;
  let project_id: string;
  const TEST_EMAIL = 'webhook-test@example.com';

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    // Create a project (work_item with kind='project') for tests
    const result = await pool.query(
      `INSERT INTO work_item (title, kind) VALUES ('Test Project', 'project')
       RETURNING id::text as id`,
    );
    project_id = (result.rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // ── Schema ──────────────────────────────────────────────

  describe('schema', () => {
    it('project_webhook table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'project_webhook'
         ORDER BY ordinal_position`,
      );
      const cols = result.rows.map((r) => (r as { column_name: string }).column_name);
      expect(cols).toContain('id');
      expect(cols).toContain('project_id');
      expect(cols).toContain('user_email');
      expect(cols).toContain('label');
      expect(cols).toContain('token');
      expect(cols).toContain('is_active');
      expect(cols).toContain('last_received');
    });

    it('project_event table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'project_event'
         ORDER BY ordinal_position`,
      );
      const cols = result.rows.map((r) => (r as { column_name: string }).column_name);
      expect(cols).toContain('id');
      expect(cols).toContain('project_id');
      expect(cols).toContain('webhook_id');
      expect(cols).toContain('event_type');
      expect(cols).toContain('summary');
      expect(cols).toContain('raw_payload');
    });

    it('project_webhook.project_id cascades on delete', async () => {
      const result = await pool.query(
        `SELECT rc.delete_rule
         FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage kcu
           ON rc.constraint_name = kcu.constraint_name
         WHERE kcu.table_name = 'project_webhook'
           AND kcu.column_name = 'project_id'`,
      );
      expect(result.rows.length).toBe(1);
      expect((result.rows[0] as { delete_rule: string }).delete_rule).toBe('CASCADE');
    });
  });

  // ── POST /api/projects/:id/webhooks — create webhook ──

  describe('POST /api/projects/:id/webhooks', () => {
    it('creates a webhook and returns it with a token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        payload: { label: 'CI Notifications', user_email: TEST_EMAIL },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.label).toBe('CI Notifications');
      expect(body.token).toBeDefined();
      expect(body.token.length).toBeGreaterThan(20);
      expect(body.project_id).toBe(project_id);
      expect(body.is_active).toBe(true);
    });

    it('rejects without a label', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects without user_email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        payload: { label: 'Missing Email' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/user_email/);
    });

    it('accepts user_email from X-User-Email header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        headers: { 'x-user-email': TEST_EMAIL },
        payload: { label: 'Header Email' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().user_email).toBe(TEST_EMAIL);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/projects/00000000-0000-0000-0000-000000000000/webhooks',
        payload: { label: 'Test', user_email: TEST_EMAIL },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/projects/:id/webhooks — list webhooks ────

  describe('GET /api/projects/:id/webhooks', () => {
    it('returns empty array when no webhooks exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/webhooks`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns created webhooks', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        payload: { label: 'Hook A', user_email: TEST_EMAIL },
      });
      await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        payload: { label: 'Hook B', user_email: TEST_EMAIL },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/webhooks`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBe(2);
    });
  });

  // ── DELETE /api/projects/:id/webhooks/:webhook_id ─────

  describe('DELETE /api/projects/:id/webhooks/:webhook_id', () => {
    it('deletes a webhook', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        payload: { label: 'Delete Me', user_email: TEST_EMAIL },
      });
      const webhookId = createRes.json().id;

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${project_id}/webhooks/${webhookId}`,
      });

      expect(deleteRes.statusCode).toBe(204);

      // Confirm it's gone
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/webhooks`,
      });
      expect(listRes.json().length).toBe(0);
    });
  });

  // ── POST /api/webhooks/:webhook_id — ingestion ────────

  describe('POST /api/webhooks/:webhook_id (ingestion)', () => {
    it('ingests a payload with valid bearer token', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        payload: { label: 'GitHub Actions', user_email: TEST_EMAIL },
      });
      const webhook = createRes.json();

      const ingestRes = await app.inject({
        method: 'POST',
        url: `/api/webhooks/${webhook.id}`,
        headers: { authorization: `Bearer ${webhook.token}` },
        payload: {
          action: 'completed',
          status: 'success',
          repository: 'my-repo',
        },
      });

      expect(ingestRes.statusCode).toBe(201);
      const body = ingestRes.json();
      expect(body.event_type).toBe('webhook');
      expect(body.raw_payload).toBeDefined();
      expect(body.project_id).toBe(project_id);
    });

    it('rejects with invalid token', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        payload: { label: 'Auth Test', user_email: TEST_EMAIL },
      });
      const webhook = createRes.json();

      const ingestRes = await app.inject({
        method: 'POST',
        url: `/api/webhooks/${webhook.id}`,
        headers: { authorization: 'Bearer wrong-token' },
        payload: { data: 'test' },
      });

      expect(ingestRes.statusCode).toBe(401);
    });

    it('rejects with no authorization header', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        payload: { label: 'No Auth Test', user_email: TEST_EMAIL },
      });
      const webhook = createRes.json();

      const ingestRes = await app.inject({
        method: 'POST',
        url: `/api/webhooks/${webhook.id}`,
        payload: { data: 'test' },
      });

      expect(ingestRes.statusCode).toBe(401);
    });

    it('returns 404 for non-existent webhook', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/00000000-0000-0000-0000-000000000000',
        headers: { authorization: 'Bearer some-token' },
        payload: { data: 'test' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('updates last_received timestamp on ingestion', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        payload: { label: 'Timestamp Test', user_email: TEST_EMAIL },
      });
      const webhook = createRes.json();
      expect(webhook.last_received).toBeNull();

      await app.inject({
        method: 'POST',
        url: `/api/webhooks/${webhook.id}`,
        headers: { authorization: `Bearer ${webhook.token}` },
        payload: { data: 'ping' },
      });

      // Verify via list
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/webhooks`,
      });
      const updated = listRes.json().find((w: { id: string }) => w.id === webhook.id);
      expect(updated.last_received).not.toBeNull();
    });
  });

  // ── GET /api/projects/:id/events — list events ────────

  describe('GET /api/projects/:id/events', () => {
    it('returns empty array when no events exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/events`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().events).toEqual([]);
    });

    it('returns events after webhook ingestion', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        payload: { label: 'Events Test', user_email: TEST_EMAIL },
      });
      const webhook = createRes.json();

      // Ingest two events
      await app.inject({
        method: 'POST',
        url: `/api/webhooks/${webhook.id}`,
        headers: { authorization: `Bearer ${webhook.token}` },
        payload: { event: 'build_started' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/webhooks/${webhook.id}`,
        headers: { authorization: `Bearer ${webhook.token}` },
        payload: { event: 'build_completed' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/events`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events.length).toBe(2);
      expect(body.events[0].webhook_id).toBe(webhook.id);
    });

    it('supports pagination with limit and offset', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project_id}/webhooks`,
        payload: { label: 'Pagination Test', user_email: TEST_EMAIL },
      });
      const webhook = createRes.json();

      // Ingest 3 events
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: `/api/webhooks/${webhook.id}`,
          headers: { authorization: `Bearer ${webhook.token}` },
          payload: { index: i },
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/events?limit=2&offset=0`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().events.length).toBe(2);

      const res2 = await app.inject({
        method: 'GET',
        url: `/api/projects/${project_id}/events?limit=2&offset=2`,
      });

      expect(res2.statusCode).toBe(200);
      expect(res2.json().events.length).toBe(1);
    });
  });
});
