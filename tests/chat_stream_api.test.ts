/**
 * Integration tests for Agent Streaming Callback API (#1945).
 *
 * Tests POST /api/chat/sessions/:id/stream endpoint.
 * Requires Postgres for session and message storage.
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { resetAllRateLimits } from '../src/api/chat/rate-limits.ts';
import { buildServer } from '../src/api/server.ts';

const TEST_EMAIL = 'stream-test@example.com';

describe('Agent Streaming Callback API (#1945)', () => {
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
    await ensureTestNamespace(pool, TEST_EMAIL);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  /** Create session and return id + stream_secret. */
  async function createSessionWithSecret(agentId = 'test-agent'): Promise<{
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

    // Fetch stream_secret directly from DB (not exposed in API response)
    const dbResult = await pool.query(
      `SELECT stream_secret FROM chat_session WHERE id = $1`,
      [session.id],
    );
    const streamSecret = (dbResult.rows[0] as { stream_secret: string }).stream_secret;

    return { id: session.id, thread_id: session.thread_id, stream_secret: streamSecret };
  }

  // ================================================================
  // POST /api/chat/sessions/:id/stream — chunk type
  // ================================================================

  describe('chunk type', () => {
    it('accepts a valid chunk', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: {
          'x-user-email': TEST_EMAIL,
          'x-stream-secret': stream_secret,
        },
        payload: { type: 'chunk', content: 'Hello', seq: 0 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; message_id: string };
      expect(body.ok).toBe(true);
      expect(body.message_id).toBeTruthy();
    });

    it('accepts sequential chunks', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      const res1 = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: { type: 'chunk', content: 'Hello', seq: 0 },
      });
      expect(res1.statusCode).toBe(200);

      const res2 = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: { type: 'chunk', content: ' world', seq: 1 },
      });
      expect(res2.statusCode).toBe(200);
    });

    it('rejects invalid stream_secret', async () => {
      const { id } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: {
          'x-user-email': TEST_EMAIL,
          'x-stream-secret': 'wrong-secret',
        },
        payload: { type: 'chunk', content: 'Hello', seq: 0 },
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects missing stream_secret', async () => {
      const { id } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL },
        payload: { type: 'chunk', content: 'Hello', seq: 0 },
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects chunk missing content', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: { type: 'chunk', seq: 0 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid session ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/not-a-uuid/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': 'any' },
        payload: { type: 'chunk', content: 'Hello', seq: 0 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ================================================================
  // POST /api/chat/sessions/:id/stream — completed type
  // ================================================================

  describe('completed type', () => {
    it('stores final message as external_message', async () => {
      const { id, thread_id, stream_secret } = await createSessionWithSecret();

      // Send a chunk first
      await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: { type: 'chunk', content: 'Hello', seq: 0 },
      });

      // Complete the stream
      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: {
          type: 'completed',
          content: 'Hello world!',
          agent_run_id: 'run-123',
        },
      });

      expect(res.statusCode).toBe(200);
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
      expect(msg.body).toBe('Hello world!');
      expect(msg.status).toBe('delivered');
      expect(msg.agent_run_id).toBe('run-123');
      expect(msg.thread_id).toBe(thread_id);
    });

    it('accepts completion without prior chunks', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: {
          type: 'completed',
          content: 'Full response without streaming',
        },
      });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { ok: boolean }).ok).toBe(true);
    });
  });

  // ================================================================
  // Issue #1972 — content_type validation on stream completion
  // ================================================================

  describe('content_type validation (#1972)', () => {
    it('accepts text/plain content_type', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: {
          type: 'completed',
          content: 'Hello world',
          content_type: 'text/plain',
        },
      });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { ok: boolean }).ok).toBe(true);
    });

    it('accepts text/markdown content_type', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: {
          type: 'completed',
          content: '# Hello',
          content_type: 'text/markdown',
        },
      });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { ok: boolean }).ok).toBe(true);
    });

    it('accepts application/vnd.openclaw.rich-card content_type', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: {
          type: 'completed',
          content: '{"card":"data"}',
          content_type: 'application/vnd.openclaw.rich-card',
        },
      });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { ok: boolean }).ok).toBe(true);
    });

    it('defaults to text/plain when content_type is omitted', async () => {
      const { id, thread_id, stream_secret } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: {
          type: 'completed',
          content: 'Hello',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; message_id: string };

      // Verify DB record uses text/plain default
      const msgResult = await pool.query(
        `SELECT content_type FROM external_message WHERE id = $1`,
        [body.message_id],
      );
      expect(msgResult.rows.length).toBe(1);
      expect((msgResult.rows[0] as { content_type: string }).content_type).toBe('text/plain');
    });

    it('rejects arbitrary content_type with 400', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: {
          type: 'completed',
          content: 'Hello',
          content_type: 'application/x-evil-payload',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain('content_type');
    });

    it('rejects XSS-bearing content_type', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: {
          type: 'completed',
          content: 'Hello',
          content_type: 'text/html',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects content_type with injection characters', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: {
          type: 'completed',
          content: 'Hello',
          content_type: 'text/plain; charset=utf-8\r\nX-Injected: true',
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ================================================================
  // POST /api/chat/sessions/:id/stream — failed type
  // ================================================================

  describe('failed type', () => {
    it('handles stream failure', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: { type: 'failed', error: 'Agent crashed' },
      });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { ok: boolean }).ok).toBe(true);
    });

    it('handles failure after chunks', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: { type: 'chunk', content: 'partial', seq: 0 },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: { type: 'failed', error: 'Something went wrong' },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ================================================================
  // Session state validation
  // ================================================================

  describe('session state validation', () => {
    it('rejects streaming to ended session', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/end`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: { type: 'chunk', content: 'Hello', seq: 0 },
      });

      expect(res.statusCode).toBe(409);
    });

    it('rejects unknown stream type', async () => {
      const { id, stream_secret } = await createSessionWithSecret();

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${id}/stream`,
        headers: { 'x-user-email': TEST_EMAIL, 'x-stream-secret': stream_secret },
        payload: { type: 'unknown_type' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
