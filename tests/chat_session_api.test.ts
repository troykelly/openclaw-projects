/**
 * Integration tests for Chat Session CRUD API (#1942).
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { resetAllRateLimits } from '../src/api/chat/rate-limits.ts';
import { buildServer } from '../src/api/server.ts';

describe('Chat Session CRUD API (#1942)', () => {
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
    await ensureTestNamespace(pool, 'chat-user@example.com');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // ================================================================
  // POST /api/chat/sessions — Create session
  // ================================================================

  describe('POST /api/chat/sessions', () => {
    it('creates a session with required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: 'test-agent-1' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body.agent_id).toBe('test-agent-1');
      expect(body.user_email).toBe('chat-user@example.com');
      expect(body.status).toBe('active');
      expect(body.version).toBe(1);
      expect(body.title).toBeNull();
      expect(body.ended_at).toBeNull();
      expect(body.namespace).toBe('default');
      expect(body.thread_id).toBeTruthy();
      expect(body.id).toBeTruthy();
      // stream_secret should NOT be in the response (security)
      expect(body).not.toHaveProperty('stream_secret');
    });

    it('creates a session with optional title', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: 'test-agent-1', title: 'My Chat' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body.title).toBe('My Chat');
    });

    it('rejects missing agent_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain('agent_id');
    });

    it('rejects title exceeding 200 characters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: 'test-agent', title: 'x'.repeat(201) },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain('title');
    });

    it('can create multiple sessions', async () => {
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/chat/sessions',
          headers: { 'x-user-email': 'chat-user@example.com' },
          payload: { agent_id: `agent-${i}` },
        });
        expect(res.statusCode).toBe(201);
      }
    });
  });

  // ================================================================
  // GET /api/chat/sessions — List sessions
  // ================================================================

  describe('GET /api/chat/sessions', () => {
    async function createSession(agentId: string, title?: string): Promise<Record<string, unknown>> {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: agentId, title },
      });
      return res.json() as Record<string, unknown>;
    }

    it('lists sessions for the user', async () => {
      await createSession('agent-1', 'Chat 1');
      await createSession('agent-2', 'Chat 2');

      const res = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { sessions: Record<string, unknown>[]; next_cursor: string | null };
      expect(body.sessions).toHaveLength(2);
      expect(body.next_cursor).toBeNull();
    });

    it('paginates with cursor', async () => {
      // Create 3 sessions
      for (let i = 0; i < 3; i++) {
        await createSession(`agent-${i}`);
        // Small delay to ensure distinct timestamps
        await new Promise(r => setTimeout(r, 10));
      }

      // First page: limit 2
      const res1 = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions?limit=2',
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      expect(res1.statusCode).toBe(200);
      const page1 = res1.json() as { sessions: Record<string, unknown>[]; next_cursor: string | null };
      expect(page1.sessions).toHaveLength(2);
      expect(page1.next_cursor).toBeTruthy();

      // Second page
      const res2 = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions?limit=2&cursor=${encodeURIComponent(page1.next_cursor!)}`,
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      expect(res2.statusCode).toBe(200);
      const page2 = res2.json() as { sessions: Record<string, unknown>[]; next_cursor: string | null };
      expect(page2.sessions).toHaveLength(1);
      expect(page2.next_cursor).toBeNull();
    });

    it('filters by status', async () => {
      const session1 = await createSession('agent-1');
      await createSession('agent-2');

      // End session 1
      await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session1.id}/end`,
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      // Filter active only
      const res = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions?status=active',
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { sessions: Record<string, unknown>[] };
      expect(body.sessions).toHaveLength(1);
    });

    it('rejects invalid status filter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions?status=invalid',
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns empty list for different user', async () => {
      await createSession('agent-1');
      await ensureTestNamespace(pool, 'other@example.com');

      const res = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'other@example.com' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { sessions: Record<string, unknown>[] };
      expect(body.sessions).toHaveLength(0);
    });
  });

  // ================================================================
  // GET /api/chat/sessions/:id — Get session details
  // ================================================================

  describe('GET /api/chat/sessions/:id', () => {
    it('returns session details', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: 'agent-1', title: 'Test Session' },
      });
      const session = createRes.json() as Record<string, unknown>;

      const res = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}`,
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.id).toBe(session.id);
      expect(body.title).toBe('Test Session');
      expect(body.agent_id).toBe('agent-1');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions/00000000-0000-0000-0000-000000000000',
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('rejects invalid UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/chat/sessions/not-a-uuid',
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for different user', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: 'agent-1' },
      });
      const session = createRes.json() as Record<string, unknown>;
      await ensureTestNamespace(pool, 'other@example.com');

      const res = await app.inject({
        method: 'GET',
        url: `/api/chat/sessions/${session.id}`,
        headers: { 'x-user-email': 'other@example.com' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ================================================================
  // PATCH /api/chat/sessions/:id — Update title
  // ================================================================

  describe('PATCH /api/chat/sessions/:id', () => {
    it('updates session title with correct version', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: 'agent-1' },
      });
      const session = createRes.json() as Record<string, unknown>;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/chat/sessions/${session.id}`,
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { title: 'Updated Title', version: 1 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.title).toBe('Updated Title');
      expect(body.version).toBe(2);
    });

    it('rejects update with wrong version', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: 'agent-1' },
      });
      const session = createRes.json() as Record<string, unknown>;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/chat/sessions/${session.id}`,
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { title: 'New Title', version: 99 },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json() as { error: string };
      expect(body.error).toContain('conflict');
    });

    it('rejects missing version', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: 'agent-1' },
      });
      const session = createRes.json() as Record<string, unknown>;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/chat/sessions/${session.id}`,
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { title: 'New Title' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects empty title', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: 'agent-1' },
      });
      const session = createRes.json() as Record<string, unknown>;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/chat/sessions/${session.id}`,
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { title: '   ', version: 1 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('allows clearing title with null', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: 'agent-1', title: 'My Chat' },
      });
      const session = createRes.json() as Record<string, unknown>;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/chat/sessions/${session.id}`,
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { title: null, version: 1 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.title).toBeNull();
    });
  });

  // ================================================================
  // POST /api/chat/sessions/:id/end — End session
  // ================================================================

  describe('POST /api/chat/sessions/:id/end', () => {
    it('ends an active session', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: 'agent-1' },
      });
      const session = createRes.json() as Record<string, unknown>;

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/end`,
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.status).toBe('ended');
      expect(body.ended_at).toBeTruthy();
    });

    it('rejects ending already-ended session', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions',
        headers: { 'x-user-email': 'chat-user@example.com' },
        payload: { agent_id: 'agent-1' },
      });
      const session = createRes.json() as Record<string, unknown>;

      await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/end`,
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/chat/sessions/${session.id}/end`,
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions/00000000-0000-0000-0000-000000000000/end',
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('rejects invalid UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/chat/sessions/bad-id/end',
        headers: { 'x-user-email': 'chat-user@example.com' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
