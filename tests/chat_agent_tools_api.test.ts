/**
 * Integration tests for Agent Chat Tools M2M API (#1954, #1955).
 *
 * Tests:
 * - POST /api/chat/sessions/:id/agent-message (M2M agent sends message)
 * - POST /api/notifications/agent (M2M agent sends notification)
 * - Rate limits, dedup, auth
 *
 * Requires Postgres for session, message, and notification storage.
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

const TEST_EMAIL = 'agent-tools-test@example.com';

describe('Agent Chat Tools API (#1954)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, TEST_EMAIL);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  /** Create session and return id + stream_secret. */
  async function createSession(agentId = 'test-agent'): Promise<{
    id: string;
    thread_id: string;
    stream_secret: string;
  }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/sessions',
      headers: { 'x-user-email': TEST_EMAIL },
      payload: { agent_id: agentId },
    });
    expect(res.statusCode).toBe(201);
    const session = res.json() as { id: string; thread_id: string };

    const dbResult = await pool.query(
      `SELECT stream_secret FROM chat_session WHERE id = $1`,
      [session.id],
    );
    const streamSecret = (dbResult.rows[0] as { stream_secret: string }).stream_secret;

    return { id: session.id, thread_id: session.thread_id, stream_secret: streamSecret };
  }

  // ================================================================
  // POST /api/chat/sessions/:id/agent-message
  // ================================================================

  describe('POST /api/chat/sessions/:id/agent-message', () => {
    it('sends a message to active session', async () => {
      const { id, thread_id, stream_secret } = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/agent-message`,
        headers: {
          'x-user-email': TEST_EMAIL,
          'x-stream-secret': stream_secret,
        },
        payload: {
          content: 'Hello from the agent!',
          content_type: 'text/markdown',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { ok: boolean; message_id: string };
      expect(body.ok).toBe(true);
      expect(body.message_id).toBeTruthy();

      // Verify message stored in DB
      const msgResult = await pool.query(
        `SELECT * FROM external_message WHERE id = $1`,
        [body.message_id],
      );
      expect(msgResult.rows.length).toBe(1);
      const msg = msgResult.rows[0] as Record<string, unknown>;
      expect(msg.direction).toBe('inbound');
      expect(msg.body).toBe('Hello from the agent!');
      expect(msg.content_type).toBe('text/markdown');
      expect(msg.thread_id).toBe(thread_id);
    });

    it('rejects missing stream_secret', async () => {
      const { id } = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/agent-message`,
        headers: { 'x-user-email': TEST_EMAIL },
        payload: { content: 'Hello' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects invalid stream_secret', async () => {
      const { id } = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/agent-message`,
        headers: {
          'x-user-email': TEST_EMAIL,
          'x-stream-secret': 'wrong-secret',
        },
        payload: { content: 'Hello' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects message to ended session', async () => {
      const { id, stream_secret } = await createSession();

      // End the session
      await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/end`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/agent-message`,
        headers: {
          'x-user-email': TEST_EMAIL,
          'x-stream-secret': stream_secret,
        },
        payload: { content: 'Hello' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('rejects missing content', async () => {
      const { id, stream_secret } = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/agent-message`,
        headers: {
          'x-user-email': TEST_EMAIL,
          'x-stream-secret': stream_secret,
        },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid session ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/not-a-uuid/agent-message`,
        headers: {
          'x-user-email': TEST_EMAIL,
          'x-stream-secret': 'any',
        },
        payload: { content: 'Hello' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ================================================================
  // POST /api/notifications/agent
  // ================================================================

  describe('POST /api/notifications/agent', () => {
    it('creates a notification with low urgency', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notifications/agent',
        headers: { 'x-user-email': TEST_EMAIL },
        payload: {
          message: 'Task reminder: review PR',
          urgency: 'low',
          reason_key: 'reminder:pr-review',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; notification_id: string; deduplicated: boolean };
      expect(body.ok).toBe(true);
      expect(body.notification_id).toBeTruthy();
      expect(body.deduplicated).toBe(false);

      // Verify notification stored in DB
      const notifResult = await pool.query(
        `SELECT * FROM notification WHERE id = $1`,
        [body.notification_id],
      );
      expect(notifResult.rows.length).toBe(1);
      const notif = notifResult.rows[0] as Record<string, unknown>;
      expect(notif.notification_type).toBe('agent_message');
      expect(notif.message).toBe('Task reminder: review PR');
      expect(notif.user_email).toBe(TEST_EMAIL);
    });

    it('deduplicates by reason_key', async () => {
      // First notification
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/notifications/agent',
        headers: { 'x-user-email': TEST_EMAIL },
        payload: {
          message: 'First notification',
          urgency: 'low',
          reason_key: 'dedup-test-key',
        },
      });
      expect(res1.statusCode).toBe(200);
      expect((res1.json() as { deduplicated: boolean }).deduplicated).toBe(false);

      // Second notification with same reason_key — should be deduplicated
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/notifications/agent',
        headers: { 'x-user-email': TEST_EMAIL },
        payload: {
          message: 'Duplicate notification',
          urgency: 'low',
          reason_key: 'dedup-test-key',
        },
      });
      expect(res2.statusCode).toBe(200);
      expect((res2.json() as { deduplicated: boolean }).deduplicated).toBe(true);
    });

    it('rejects missing message', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notifications/agent',
        headers: { 'x-user-email': TEST_EMAIL },
        payload: {
          urgency: 'low',
          reason_key: 'test',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid urgency', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notifications/agent',
        headers: { 'x-user-email': TEST_EMAIL },
        payload: {
          message: 'Hello',
          urgency: 'super_urgent',
          reason_key: 'test',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects missing reason_key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notifications/agent',
        headers: { 'x-user-email': TEST_EMAIL },
        payload: {
          message: 'Hello',
          urgency: 'low',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects message exceeding 500 chars', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notifications/agent',
        headers: { 'x-user-email': TEST_EMAIL },
        payload: {
          message: 'x'.repeat(501),
          urgency: 'low',
          reason_key: 'test',
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
