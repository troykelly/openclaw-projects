/**
 * Integration tests for project webhook ingestion (Issue #1274).
 *
 * Tests CRUD for webhooks, the public ingestion endpoint, and project events listing.
 */
import { randomBytes } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { createTestPool } from './helpers/db.js';

const TEST_EMAIL = 'webhook-test@example.com';

describe('Project Webhooks API (Issue #1274)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let pool: ReturnType<typeof createTestPool>;
  let projectId: string;

  beforeAll(async () => {
    pool = createTestPool();
    app = await buildServer();

    // Clean up
    await pool.query(`DELETE FROM project_event WHERE user_email = $1`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM project_webhook WHERE user_email = $1`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM work_item WHERE user_email = $1`, [TEST_EMAIL]);

    // Create a test project (work_item with kind 'project')
    const projectResult = await pool.query(
      `INSERT INTO work_item (title, kind, user_email)
       VALUES ('Webhook Test Project', 'project', $1)
       RETURNING id::text as id`,
      [TEST_EMAIL],
    );
    projectId = projectResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM project_event WHERE user_email = $1`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM project_webhook WHERE user_email = $1`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM work_item WHERE user_email = $1`, [TEST_EMAIL]);
    await pool.end();
    await app.close();
  });

  // ─── Schema ────────────────────────────────────────────────────────────

  describe('Schema', () => {
    it('project_webhook table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'project_webhook'
         ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('project_id');
      expect(columns).toContain('user_email');
      expect(columns).toContain('label');
      expect(columns).toContain('token');
      expect(columns).toContain('payload_mapping');
      expect(columns).toContain('is_active');
      expect(columns).toContain('last_received');
    });

    it('project_event table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'project_event'
         ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('project_id');
      expect(columns).toContain('webhook_id');
      expect(columns).toContain('event_type');
      expect(columns).toContain('summary');
      expect(columns).toContain('raw_payload');
    });
  });

  // ─── POST /api/projects/:id/webhooks ───────────────────────────────────

  describe('POST /api/projects/:id/webhooks', () => {
    it('creates a webhook and returns it with URL + token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/webhooks`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { label: 'CI Notifications' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.label).toBe('CI Notifications');
      expect(body.token).toBeDefined();
      expect(body.token.length).toBeGreaterThan(20);
      expect(body.is_active).toBe(true);
      expect(body.ingestion_url).toContain('/api/webhooks/');
    });

    it('returns 400 when label is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/webhooks`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/projects/00000000-0000-0000-0000-000000000099/webhooks',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { label: 'Test' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── GET /api/projects/:id/webhooks ────────────────────────────────────

  describe('GET /api/projects/:id/webhooks', () => {
    it('lists webhooks for a project', async () => {
      // Create a webhook first
      await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/webhooks`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { label: 'List Test Webhook' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/webhooks`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.webhooks).toBeDefined();
      expect(body.webhooks.length).toBeGreaterThanOrEqual(1);
      expect(body.webhooks[0].label).toBeDefined();
      expect(body.webhooks[0].token).toBeDefined();
    });
  });

  // ─── PATCH /api/projects/:id/webhooks/:wid ─────────────────────────────

  describe('PATCH /api/projects/:id/webhooks/:wid', () => {
    it('updates webhook label and is_active', async () => {
      // Create a webhook
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/webhooks`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { label: 'Patch Test' },
      });
      const webhookId = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${projectId}/webhooks/${webhookId}`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { label: 'Updated Label', is_active: false },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.label).toBe('Updated Label');
      expect(body.is_active).toBe(false);
    });

    it('returns 404 for non-existent webhook', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${projectId}/webhooks/00000000-0000-0000-0000-000000000099`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { label: 'Nope' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── DELETE /api/projects/:id/webhooks/:wid ────────────────────────────

  describe('DELETE /api/projects/:id/webhooks/:wid', () => {
    it('deletes a webhook and returns 204', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/webhooks`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { label: 'Delete Me' },
      });
      const webhookId = createRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${projectId}/webhooks/${webhookId}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const checkRes = await pool.query(`SELECT id FROM project_webhook WHERE id = $1`, [webhookId]);
      expect(checkRes.rows.length).toBe(0);
    });

    it('returns 404 for non-existent webhook', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${projectId}/webhooks/00000000-0000-0000-0000-000000000099`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /api/webhooks/:wid (public ingestion) ───────────────────────

  describe('POST /api/webhooks/:wid (ingestion)', () => {
    let webhookId: string;
    let webhookToken: string;

    beforeAll(async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/webhooks`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { label: 'Ingestion Test' },
      });
      const body = createRes.json();
      webhookId = body.id;
      webhookToken = body.token;
    });

    it('accepts a payload with valid bearer token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/webhooks/${webhookId}`,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${webhookToken}`,
        },
        payload: { action: 'completed', repo: 'my-repo', status: 'success' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.event_id).toBeDefined();
      expect(body.received).toBe(true);
    });

    it('returns 401 without authorization', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/webhooks/${webhookId}`,
        headers: { 'content-type': 'application/json' },
        payload: { test: true },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 with invalid token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/webhooks/${webhookId}`,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer invalid-token-here',
        },
        payload: { test: true },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for non-existent webhook', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/00000000-0000-0000-0000-000000000099',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer some-token',
        },
        payload: { test: true },
      });

      expect(res.statusCode).toBe(404);
    });

    it('rejects payloads when webhook is inactive', async () => {
      // Deactivate the webhook
      await pool.query(`UPDATE project_webhook SET is_active = false WHERE id = $1`, [webhookId]);

      const res = await app.inject({
        method: 'POST',
        url: `/api/webhooks/${webhookId}`,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${webhookToken}`,
        },
        payload: { test: true },
      });

      expect(res.statusCode).toBe(410);

      // Re-activate for other tests
      await pool.query(`UPDATE project_webhook SET is_active = true WHERE id = $1`, [webhookId]);
    });

    it('updates last_received timestamp on ingestion', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/webhooks/${webhookId}`,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${webhookToken}`,
        },
        payload: { check: 'timestamp' },
      });

      const result = await pool.query(
        `SELECT last_received FROM project_webhook WHERE id = $1`,
        [webhookId],
      );
      expect(result.rows[0].last_received).not.toBeNull();
    });
  });

  // ─── GET /api/projects/:id/events ──────────────────────────────────────

  describe('GET /api/projects/:id/events', () => {
    it('returns events for a project', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/events`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toBeDefined();
      expect(Array.isArray(body.events)).toBe(true);
    });

    it('returns events with webhook payloads', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/events`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Should have events from the ingestion tests above
      const webhookEvents = body.events.filter((e: { event_type: string }) => e.event_type === 'webhook');
      expect(webhookEvents.length).toBeGreaterThanOrEqual(1);
      expect(webhookEvents[0].raw_payload).toBeDefined();
    });

    it('supports pagination with limit and offset', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/events?limit=1`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events.length).toBeLessThanOrEqual(1);
    });

    it('supports filtering by event_type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/events?event_type=webhook`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      for (const event of body.events) {
        expect(event.event_type).toBe('webhook');
      }
    });
  });
});
