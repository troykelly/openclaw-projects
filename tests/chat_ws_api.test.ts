/**
 * Integration tests for Chat WebSocket API (#1944).
 *
 * Tests the POST /api/chat/ws/ticket endpoint and WebSocket lifecycle.
 * Requires Postgres for session verification.
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { resetAllRateLimits } from '../src/api/chat/rate-limits.ts';
import { buildServer } from '../src/api/server.ts';

const TEST_EMAIL = 'ws-test@example.com';

describe('Chat WebSocket API (#1944)', () => {
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

  /** Helper: create a chat session and return its ID */
  async function createSession(agentId = 'test-agent'): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/sessions',
      headers: { 'x-user-email': TEST_EMAIL },
      payload: { agent_id: agentId },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  // ================================================================
  // POST /api/chat/ws/ticket — Generate one-time ticket
  // ================================================================

  describe('POST /api/chat/ws/ticket', () => {
    it('returns a ticket for an active session', async () => {
      const sessionId = await createSession();

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/ws/ticket',
        headers: { 'x-user-email': TEST_EMAIL },
        payload: { session_id: sessionId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { ticket: string; expires_in: number };
      expect(body.ticket).toBeTruthy();
      expect(typeof body.ticket).toBe('string');
      expect(body.expires_in).toBe(30);
    });

    it('rejects without authentication', async () => {
      // Auth is disabled in test mode, but if x-user-email is missing, getUserEmail returns null
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/ws/ticket',
        payload: { session_id: '00000000-0000-0000-0000-000000000000' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects missing session_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/ws/ticket',
        headers: { 'x-user-email': TEST_EMAIL },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid session_id format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/ws/ticket',
        headers: { 'x-user-email': TEST_EMAIL },
        payload: { session_id: 'not-a-uuid' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects session_id not owned by user', async () => {
      // Create session as different user
      await ensureTestNamespace(pool, 'other@example.com');
      const otherRes = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'other@example.com' },
        payload: { agent_id: 'test-agent' },
      });
      const otherSessionId = (otherRes.json() as { id: string }).id;

      // Try to get ticket as different user
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/ws/ticket',
        headers: { 'x-user-email': TEST_EMAIL },
        payload: { session_id: otherSessionId },
      });

      expect(res.statusCode).toBe(404);
    });

    it('rejects ticket for ended session', async () => {
      const sessionId = await createSession();

      // End the session
      await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${sessionId}/end`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/ws/ticket',
        headers: { 'x-user-email': TEST_EMAIL },
        payload: { session_id: sessionId },
      });

      expect(res.statusCode).toBe(409);
    });
  });
});
