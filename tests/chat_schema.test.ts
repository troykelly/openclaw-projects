/**
 * Integration tests for Chat schema migration (#1941).
 *
 * Epic #1940 — Agent Chat.
 * Validates enums, tables, constraints, triggers, and indexes.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';

describe('Chat Schema Migration (#1941)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // ────────────────────────────────────────────────────────────────
  // Enum types
  // ────────────────────────────────────────────────────────────────

  describe('Enum types', () => {
    it('has agent_chat in contact_endpoint_type', async () => {
      const result = await pool.query(
        `SELECT unnest(enum_range(NULL::contact_endpoint_type))::text AS val`,
      );
      const values = result.rows.map((r: { val: string }) => r.val);
      expect(values).toContain('agent_chat');
    });

    it('has chat_session_status enum with correct values', async () => {
      const result = await pool.query(
        `SELECT unnest(enum_range(NULL::chat_session_status))::text AS val`,
      );
      const values = result.rows.map((r: { val: string }) => r.val);
      expect(values).toEqual(['active', 'ended', 'expired']);
    });

    it('has chat_message_status enum with correct values', async () => {
      const result = await pool.query(
        `SELECT unnest(enum_range(NULL::chat_message_status))::text AS val`,
      );
      const values = result.rows.map((r: { val: string }) => r.val);
      expect(values).toEqual(['pending', 'streaming', 'delivered', 'failed']);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // chat_session table
  // ────────────────────────────────────────────────────────────────

  describe('chat_session table', () => {
    async function createTestSession(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
      const email = (overrides.user_email as string) ?? 'chat-test@example.com';
      await ensureTestNamespace(pool, email);

      // Create contact + endpoint + thread for FK
      const contact = await pool.query(
        `INSERT INTO contact (display_name, namespace) VALUES ('Test', 'default') RETURNING id`,
      );
      const contactId = (contact.rows[0] as { id: string }).id;

      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'agent_chat', 'chat-endpoint') RETURNING id`,
        [contactId],
      );
      const endpointId = (endpoint.rows[0] as { id: string }).id;

      const threadKey = overrides.threadKey as string ?? `chat-thread-${Date.now()}-${Math.random()}`;
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'agent_chat', $2) RETURNING id`,
        [endpointId, threadKey],
      );
      const threadId = (thread.rows[0] as { id: string }).id;

      const streamSecret = 'a'.repeat(64);
      const result = await pool.query(
        `INSERT INTO chat_session (thread_id, user_email, agent_id, namespace, stream_secret, title, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          overrides.thread_id ?? threadId,
          email,
          overrides.agent_id ?? 'test-agent',
          overrides.namespace ?? 'default',
          overrides.stream_secret ?? streamSecret,
          overrides.title ?? null,
          JSON.stringify(overrides.metadata ?? {}),
        ],
      );

      return result.rows[0] as Record<string, unknown>;
    }

    it('creates a session with defaults', async () => {
      const session = await createTestSession();
      expect(session.status).toBe('active');
      expect(session.version).toBe(1);
      expect(session.ended_at).toBeNull();
      expect(session.started_at).toBeTruthy();
      expect(session.last_activity_at).toBeTruthy();
      expect(session.metadata).toEqual({});
    });

    it('enforces thread_id uniqueness', async () => {
      const session = await createTestSession();
      await expect(
        pool.query(
          `INSERT INTO chat_session (thread_id, user_email, agent_id, stream_secret)
           VALUES ($1, $2, 'agent2', $3)`,
          [session.thread_id, session.user_email, 'b'.repeat(64)],
        ),
      ).rejects.toThrow(/unique/i);
    });

    it('rejects empty agent_id', async () => {
      await expect(createTestSession({ agent_id: '  ' })).rejects.toThrow();
    });

    it('rejects title exceeding 200 characters', async () => {
      await expect(createTestSession({ title: 'x'.repeat(201) })).rejects.toThrow();
    });

    it('rejects empty-after-trim title', async () => {
      await expect(createTestSession({ title: '   ' })).rejects.toThrow();
    });

    it('allows null title', async () => {
      const session = await createTestSession({ title: null });
      expect(session.title).toBeNull();
    });

    it('rejects stream_secret with wrong length', async () => {
      await expect(createTestSession({ stream_secret: 'tooshort' })).rejects.toThrow();
    });

    it('rejects metadata exceeding 16KB', async () => {
      const bigMeta = { data: 'x'.repeat(20000) };
      await expect(createTestSession({ metadata: bigMeta })).rejects.toThrow();
    });

    it('enforces active session has no ended_at (constraint)', async () => {
      const session = await createTestSession();
      await expect(
        pool.query(
          `UPDATE chat_session SET ended_at = now() WHERE id = $1`,
          [session.id],
        ),
      ).rejects.toThrow(); // violates chat_session_active_no_ended
    });

    it('cascades delete from user_setting', async () => {
      const session = await createTestSession();
      await pool.query(`DELETE FROM user_setting WHERE email = $1`, [session.user_email]);
      const result = await pool.query(`SELECT 1 FROM chat_session WHERE id = $1`, [session.id]);
      expect(result.rows).toHaveLength(0);
    });

    // ── Status transition trigger ──────────────────────────────────

    describe('status transition trigger', () => {
      it('allows active -> ended', async () => {
        const session = await createTestSession();
        const result = await pool.query(
          `UPDATE chat_session SET status = 'ended' WHERE id = $1 RETURNING *`,
          [session.id],
        );
        const updated = result.rows[0] as Record<string, unknown>;
        expect(updated.status).toBe('ended');
        expect(updated.ended_at).toBeTruthy();
      });

      it('allows active -> expired', async () => {
        const session = await createTestSession();
        const result = await pool.query(
          `UPDATE chat_session SET status = 'expired' WHERE id = $1 RETURNING *`,
          [session.id],
        );
        const updated = result.rows[0] as Record<string, unknown>;
        expect(updated.status).toBe('expired');
        expect(updated.ended_at).toBeTruthy();
      });

      it('rejects ended -> active', async () => {
        const session = await createTestSession();
        await pool.query(
          `UPDATE chat_session SET status = 'ended' WHERE id = $1`,
          [session.id],
        );
        await expect(
          pool.query(
            `UPDATE chat_session SET status = 'active' WHERE id = $1`,
            [session.id],
          ),
        ).rejects.toThrow(/Cannot transition/);
      });

      it('rejects ended -> expired', async () => {
        const session = await createTestSession();
        await pool.query(
          `UPDATE chat_session SET status = 'ended' WHERE id = $1`,
          [session.id],
        );
        await expect(
          pool.query(
            `UPDATE chat_session SET status = 'expired' WHERE id = $1`,
            [session.id],
          ),
        ).rejects.toThrow(/Cannot transition/);
      });

      it('auto-sets ended_at when transitioning out of active', async () => {
        const session = await createTestSession();
        const result = await pool.query(
          `UPDATE chat_session SET status = 'ended' WHERE id = $1 RETURNING ended_at`,
          [session.id],
        );
        expect((result.rows[0] as { ended_at: string }).ended_at).toBeTruthy();
      });
    });
  });

  // ────────────────────────────────────────────────────────────────
  // external_message extensions
  // ────────────────────────────────────────────────────────────────

  describe('external_message extensions', () => {
    async function createMessageWithStatus(status: string): Promise<Record<string, unknown>> {
      await ensureTestNamespace(pool, 'msg-test@example.com');

      const contact = await pool.query(
        `INSERT INTO contact (display_name, namespace) VALUES ('Msg Test', 'default') RETURNING id`,
      );
      const contactId = (contact.rows[0] as { id: string }).id;

      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'agent_chat', 'msg-ep') RETURNING id`,
        [contactId],
      );
      const endpointId = (endpoint.rows[0] as { id: string }).id;

      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'agent_chat', $2) RETURNING id`,
        [endpointId, `msg-thread-${Date.now()}-${Math.random()}`],
      );
      const threadId = (thread.rows[0] as { id: string }).id;

      const result = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, status, content_type)
         VALUES ($1, $2, 'inbound', 'hello', $3, 'text/plain')
         RETURNING *`,
        [threadId, `msg-key-${Date.now()}-${Math.random()}`, status],
      );
      return result.rows[0] as Record<string, unknown>;
    }

    it('has new columns with defaults', async () => {
      const msg = await createMessageWithStatus('delivered');
      expect(msg.status).toBe('delivered');
      expect(msg.content_type).toBe('text/plain');
      expect(msg.idempotency_key).toBeNull();
      expect(msg.agent_run_id).toBeNull();
    });

    it('updated_at trigger works on update', async () => {
      const msg = await createMessageWithStatus('pending');
      expect(msg.updated_at).toBeNull(); // Not set on INSERT — trigger is BEFORE UPDATE only

      const result = await pool.query(
        `UPDATE external_message SET body = 'updated' WHERE id = $1 RETURNING updated_at`,
        [msg.id],
      );
      expect((result.rows[0] as { updated_at: string }).updated_at).toBeTruthy();
    });

    it('rejects invalid content_type', async () => {
      await expect(createMessageWithStatus('delivered').then(async () => {
        // The create above was fine, now try invalid
        const msg = await createMessageWithStatus('delivered');
        await pool.query(
          `UPDATE external_message SET content_type = 'text/html' WHERE id = $1`,
          [msg.id],
        );
      })).rejects.toThrow();
    });

    it('allows text/markdown content_type', async () => {
      await ensureTestNamespace(pool, 'md-test@example.com');
      const contact = await pool.query(
        `INSERT INTO contact (display_name, namespace) VALUES ('MD Test', 'default') RETURNING id`,
      );
      const contactId = (contact.rows[0] as { id: string }).id;
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'agent_chat', 'md-ep') RETURNING id`,
        [contactId],
      );
      const endpointId = (endpoint.rows[0] as { id: string }).id;
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'agent_chat', $2) RETURNING id`,
        [endpointId, `md-thread-${Date.now()}`],
      );
      const threadId = (thread.rows[0] as { id: string }).id;

      const result = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, content_type)
         VALUES ($1, 'md-msg', 'inbound', '# Hello', 'text/markdown') RETURNING content_type`,
        [threadId],
      );
      expect((result.rows[0] as { content_type: string }).content_type).toBe('text/markdown');
    });

    it('enforces idempotency_key uniqueness per thread', async () => {
      await ensureTestNamespace(pool, 'idem-test@example.com');
      const contact = await pool.query(
        `INSERT INTO contact (display_name, namespace) VALUES ('Idem Test', 'default') RETURNING id`,
      );
      const contactId = (contact.rows[0] as { id: string }).id;
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'agent_chat', 'idem-ep') RETURNING id`,
        [contactId],
      );
      const endpointId = (endpoint.rows[0] as { id: string }).id;
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'agent_chat', $2) RETURNING id`,
        [endpointId, `idem-thread-${Date.now()}`],
      );
      const threadId = (thread.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, idempotency_key)
         VALUES ($1, 'idem-1', 'outbound', 'msg1', 'key-abc')`,
        [threadId],
      );

      await expect(
        pool.query(
          `INSERT INTO external_message (thread_id, external_message_key, direction, body, idempotency_key)
           VALUES ($1, 'idem-2', 'outbound', 'msg2', 'key-abc')`,
          [threadId],
        ),
      ).rejects.toThrow(/unique/i);
    });

    // ── Message status transition trigger ──────────────────────────

    describe('message status transition trigger', () => {
      it('allows pending -> streaming', async () => {
        const msg = await createMessageWithStatus('pending');
        const result = await pool.query(
          `UPDATE external_message SET status = 'streaming' WHERE id = $1 RETURNING status`,
          [msg.id],
        );
        expect((result.rows[0] as { status: string }).status).toBe('streaming');
      });

      it('allows pending -> delivered', async () => {
        const msg = await createMessageWithStatus('pending');
        const result = await pool.query(
          `UPDATE external_message SET status = 'delivered' WHERE id = $1 RETURNING status`,
          [msg.id],
        );
        expect((result.rows[0] as { status: string }).status).toBe('delivered');
      });

      it('allows pending -> failed', async () => {
        const msg = await createMessageWithStatus('pending');
        const result = await pool.query(
          `UPDATE external_message SET status = 'failed' WHERE id = $1 RETURNING status`,
          [msg.id],
        );
        expect((result.rows[0] as { status: string }).status).toBe('failed');
      });

      it('allows streaming -> delivered', async () => {
        const msg = await createMessageWithStatus('pending');
        await pool.query(
          `UPDATE external_message SET status = 'streaming' WHERE id = $1`,
          [msg.id],
        );
        const result = await pool.query(
          `UPDATE external_message SET status = 'delivered' WHERE id = $1 RETURNING status`,
          [msg.id],
        );
        expect((result.rows[0] as { status: string }).status).toBe('delivered');
      });

      it('rejects delivered -> pending', async () => {
        const msg = await createMessageWithStatus('delivered');
        await expect(
          pool.query(
            `UPDATE external_message SET status = 'pending' WHERE id = $1`,
            [msg.id],
          ),
        ).rejects.toThrow(/Cannot transition/);
      });

      it('rejects failed -> delivered', async () => {
        const msg = await createMessageWithStatus('pending');
        await pool.query(
          `UPDATE external_message SET status = 'failed' WHERE id = $1`,
          [msg.id],
        );
        await expect(
          pool.query(
            `UPDATE external_message SET status = 'delivered' WHERE id = $1`,
            [msg.id],
          ),
        ).rejects.toThrow(/Cannot transition/);
      });
    });
  });

  // ────────────────────────────────────────────────────────────────
  // chat_read_cursor table
  // ────────────────────────────────────────────────────────────────

  describe('chat_read_cursor table', () => {
    it('creates cursor with composite PK', async () => {
      await ensureTestNamespace(pool, 'cursor-test@example.com');

      const contact = await pool.query(
        `INSERT INTO contact (display_name, namespace) VALUES ('Cursor Test', 'default') RETURNING id`,
      );
      const contactId = (contact.rows[0] as { id: string }).id;
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'agent_chat', 'cursor-ep') RETURNING id`,
        [contactId],
      );
      const endpointId = (endpoint.rows[0] as { id: string }).id;
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'agent_chat', 'cursor-thread') RETURNING id`,
        [endpointId],
      );
      const threadId = (thread.rows[0] as { id: string }).id;

      const session = await pool.query(
        `INSERT INTO chat_session (thread_id, user_email, agent_id, stream_secret)
         VALUES ($1, 'cursor-test@example.com', 'agent1', $2) RETURNING id`,
        [threadId, 'a'.repeat(64)],
      );
      const sessionId = (session.rows[0] as { id: string }).id;

      const result = await pool.query(
        `INSERT INTO chat_read_cursor (user_email, session_id)
         VALUES ('cursor-test@example.com', $1) RETURNING *`,
        [sessionId],
      );
      const cursor = result.rows[0] as Record<string, unknown>;
      expect(cursor.user_email).toBe('cursor-test@example.com');
      expect(cursor.last_read_message_id).toBeNull();
      expect(cursor.last_read_at).toBeTruthy();
    });

    it('cascades delete from chat_session', async () => {
      await ensureTestNamespace(pool, 'cascade-test@example.com');

      const contact = await pool.query(
        `INSERT INTO contact (display_name, namespace) VALUES ('Cascade', 'default') RETURNING id`,
      );
      const contactId = (contact.rows[0] as { id: string }).id;
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'agent_chat', 'cascade-ep') RETURNING id`,
        [contactId],
      );
      const endpointId = (endpoint.rows[0] as { id: string }).id;
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'agent_chat', 'cascade-thread') RETURNING id`,
        [endpointId],
      );
      const threadId = (thread.rows[0] as { id: string }).id;

      const session = await pool.query(
        `INSERT INTO chat_session (thread_id, user_email, agent_id, stream_secret)
         VALUES ($1, 'cascade-test@example.com', 'agent1', $2) RETURNING id`,
        [threadId, 'a'.repeat(64)],
      );
      const sessionId = (session.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO chat_read_cursor (user_email, session_id) VALUES ('cascade-test@example.com', $1)`,
        [sessionId],
      );

      // Delete parent session (via thread cascade)
      await pool.query(`DELETE FROM external_thread WHERE id = $1`, [threadId]);

      const result = await pool.query(
        `SELECT 1 FROM chat_read_cursor WHERE session_id = $1`,
        [sessionId],
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // user_setting extensions
  // ────────────────────────────────────────────────────────────────

  describe('user_setting extensions', () => {
    it('has default_agent_id column defaulting to null', async () => {
      await ensureTestNamespace(pool, 'setting-test@example.com');
      const result = await pool.query(
        `SELECT default_agent_id FROM user_setting WHERE email = 'setting-test@example.com'`,
      );
      expect((result.rows[0] as { default_agent_id: string | null }).default_agent_id).toBeNull();
    });

    it('has chat_notification_prefs column defaulting to empty object', async () => {
      await ensureTestNamespace(pool, 'setting-pref@example.com');
      const result = await pool.query(
        `SELECT chat_notification_prefs FROM user_setting WHERE email = 'setting-pref@example.com'`,
      );
      expect((result.rows[0] as { chat_notification_prefs: Record<string, unknown> }).chat_notification_prefs).toEqual({});
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Migration rollback
  // ────────────────────────────────────────────────────────────────

  describe('migration rollback', () => {
    it('can roll back and re-apply migration 125', async () => {
      // Roll back
      await runMigrate('down', 1);
      // Re-apply
      await runMigrate('up');

      // Verify table exists after re-apply
      const result = await pool.query(
        `SELECT 1 FROM pg_tables WHERE tablename = 'chat_session' AND schemaname = 'public'`,
      );
      expect(result.rows).toHaveLength(1);
    });
  });
});
