/**
 * Integration tests for Chat Message Send and Retrieve API (#1943).
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { resetAllRateLimits } from '../src/api/chat/rate-limits.ts';
import { buildServer } from '../src/api/server.ts';

describe('Chat Message API (#1943)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    resetAllRateLimits();
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, 'msg-user@example.com');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  /** Helper: create a session and return its data. */
  async function createSession(agentId: string = 'test-agent'): Promise<Record<string, unknown>> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/sessions',
      headers: { 'x-user-email': 'msg-user@example.com' },
      payload: { agent_id: agentId },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as Record<string, unknown>;
  }

  // ================================================================
  // POST /api/chat/sessions/:id/messages — Send message
  // ================================================================

  describe('POST /api/chat/sessions/:id/messages', () => {
    it('sends a message to an active session', async () => {
      const session = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'msg-user@example.com' },
        payload: {
          content: 'Hello, agent!',
          idempotency_key: randomUUID(),
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body.body).toBe('Hello, agent!');
      expect(body.direction).toBe('outbound');
      expect(body.status).toBe('delivered');
      expect(body.content_type).toBe('text/plain');
      expect(body.thread_id).toBe(session.thread_id);
    });

    it('supports markdown content_type', async () => {
      const session = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'msg-user@example.com' },
        payload: {
          content: '# Hello\n\nWorld',
          content_type: 'text/markdown',
          idempotency_key: randomUUID(),
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body.content_type).toBe('text/markdown');
    });

    it('is idempotent with same idempotency_key', async () => {
      const session = await createSession();
      const idempotencyKey = randomUUID();

      const res1 = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'msg-user@example.com' },
        payload: { content: 'First send', idempotency_key: idempotencyKey },
      });
      expect(res1.statusCode).toBe(201);
      const msg1 = res1.json() as Record<string, unknown>;

      const res2 = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'msg-user@example.com' },
        payload: { content: 'Second send', idempotency_key: idempotencyKey },
      });
      expect(res2.statusCode).toBe(200); // Returns existing, not 201
      const msg2 = res2.json() as Record<string, unknown>;
      expect(msg2.id).toBe(msg1.id);
      expect(msg2.body).toBe('First send'); // Original content preserved
    });

    it('rejects missing content', async () => {
      const session = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'msg-user@example.com' },
        payload: { idempotency_key: randomUUID() },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain('content');
    });

    it('rejects content exceeding 64KB', async () => {
      const session = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'msg-user@example.com' },
        payload: {
          content: 'x'.repeat(65537),
          idempotency_key: randomUUID(),
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain('64KB');
    });

    it('rejects invalid content_type', async () => {
      const session = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'msg-user@example.com' },
        payload: {
          content: 'Hello',
          content_type: 'text/html',
          idempotency_key: randomUUID(),
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain('content_type');
    });

    it('rejects invalid idempotency_key format', async () => {
      const session = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'msg-user@example.com' },
        payload: {
          content: 'Hello',
          idempotency_key: 'not-a-uuid',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain('idempotency_key');
    });

    it('rejects sending to ended session', async () => {
      const session = await createSession();

      // End the session
      await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/end`,
        headers: { 'x-user-email': 'msg-user@example.com' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'msg-user@example.com' },
        payload: { content: 'Hello', idempotency_key: randomUUID() },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json() as { error: string };
      expect(body.error).toContain('ended');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions/00000000-0000-0000-0000-000000000000/messages',
        headers: { 'x-user-email': 'msg-user@example.com' },
        payload: { content: 'Hello', idempotency_key: randomUUID() },
      });

      expect(res.statusCode).toBe(404);
    });

    it('rejects invalid session UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions/not-uuid/messages',
        headers: { 'x-user-email': 'msg-user@example.com' },
        payload: { content: 'Hello' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('allows sending without idempotency_key', async () => {
      const session = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'msg-user@example.com' },
        payload: { content: 'Hello without key' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body.idempotency_key).toBeNull();
    });
  });

  // ================================================================
  // GET /api/chat/sessions/:id/messages — List messages
  // ================================================================

  describe('GET /api/chat/sessions/:id/messages', () => {
    it('lists messages for a session', async () => {
      const session = await createSession();

      // Send 3 messages
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: `/api/chat/sessions/${session.id}/messages`,
          headers: { 'x-user-email': 'msg-user@example.com' },
          payload: { content: `Message ${i}`, idempotency_key: randomUUID() },
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'msg-user@example.com' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { messages: Record<string, unknown>[]; next_cursor: string | null };
      expect(body.messages).toHaveLength(3);
      expect(body.next_cursor).toBeNull();

      // Should be sorted by received_at DESC
      const timestamps = body.messages.map(m => m.received_at as string);
      for (let i = 0; i < timestamps.length - 1; i++) {
        expect(new Date(timestamps[i]).getTime()).toBeGreaterThanOrEqual(
          new Date(timestamps[i + 1]).getTime(),
        );
      }
    });

    it('paginates with cursor', async () => {
      const session = await createSession();

      // Send 5 messages with small delays
      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: 'POST',
          url: `/api/chat/sessions/${session.id}/messages`,
          headers: { 'x-user-email': 'msg-user@example.com' },
          payload: { content: `Message ${i}`, idempotency_key: randomUUID() },
        });
        await new Promise(r => setTimeout(r, 10));
      }

      // First page
      const res1 = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}/messages?limit=3`,
        headers: { 'x-user-email': 'msg-user@example.com' },
      });

      const page1 = res1.json() as { messages: Record<string, unknown>[]; next_cursor: string | null };
      expect(page1.messages).toHaveLength(3);
      expect(page1.next_cursor).toBeTruthy();

      // Second page
      const res2 = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}/messages?limit=3&cursor=${encodeURIComponent(page1.next_cursor!)}`,
        headers: { 'x-user-email': 'msg-user@example.com' },
      });

      const page2 = res2.json() as { messages: Record<string, unknown>[]; next_cursor: string | null };
      expect(page2.messages).toHaveLength(2);
      expect(page2.next_cursor).toBeNull();

      // No overlap between pages
      const page1Ids = new Set(page1.messages.map(m => m.id));
      const page2Ids = new Set(page2.messages.map(m => m.id));
      for (const id of page2Ids) {
        expect(page1Ids.has(id)).toBe(false);
      }
    });

    it('returns empty list for session with no messages', async () => {
      const session = await createSession();

      const res = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'msg-user@example.com' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { messages: Record<string, unknown>[] };
      expect(body.messages).toHaveLength(0);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions/00000000-0000-0000-0000-000000000000/messages',
        headers: { 'x-user-email': 'msg-user@example.com' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for different user', async () => {
      const session = await createSession();
      await ensureTestNamespace(pool, 'other@example.com');

      const res = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}/messages`,
        headers: { 'x-user-email': 'other@example.com' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ================================================================
  // Webhook dispatch
  // ================================================================

  describe('Webhook dispatch', () => {
    it('enqueues webhook when OPENCLAW_GATEWAY_URL is set', async () => {
      // Set the env var so the webhook gets enqueued
      const original = process.env.OPENCLAW_GATEWAY_URL;
      process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com/hooks';

      try {
        const session = await createSession();

        await app.inject({
          method: 'POST',
          url: `/api/chat/sessions/${session.id}/messages`,
          headers: { 'x-user-email': 'msg-user@example.com' },
          payload: { content: 'Trigger webhook', idempotency_key: randomUUID() },
        });

        // Check webhook_outbox for the enqueued webhook
        const outbox = await pool.query(
          `SELECT kind, body FROM webhook_outbox WHERE kind = 'chat_message_received'`,
        );
        expect(outbox.rows).toHaveLength(1);
        const webhook = outbox.rows[0] as { kind: string; body: Record<string, unknown> };
        expect(webhook.kind).toBe('chat_message_received');
        const webhookBody = webhook.body as Record<string, unknown>;
        expect(webhookBody.kind).toBe('chat_message_received');
        expect(webhookBody.session_key).toBeTruthy();
        const payload = webhookBody.payload as Record<string, unknown>;
        expect(payload.session_id).toBe(session.id);
        expect(payload.content).toBe('Trigger webhook');
        expect(payload.stream_secret).toBeTruthy();
        expect(payload.streaming_callback_url).toContain('/stream');
      } finally {
        if (original === undefined) {
          delete process.env.OPENCLAW_GATEWAY_URL;
        } else {
          process.env.OPENCLAW_GATEWAY_URL = original;
        }
      }
    });
  });
});
