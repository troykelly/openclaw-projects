/**
 * Unit tests for chat audit logging (#1962).
 *
 * Tests the recordChatActivity function with a mock pool.
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect, vi } from 'vitest';
import { recordChatActivity, recordChatActivitySync } from '../../src/api/chat/audit.ts';

function createMockPool() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
  };
  return { pool: pool as any, calls };
}

describe('Chat Audit Logging (#1962)', () => {
  describe('recordChatActivity', () => {
    it('inserts into chat_activity table', async () => {
      const { pool, calls } = createMockPool();

      recordChatActivity(pool, {
        namespace: 'default',
        session_id: 'sess-123',
        user_email: 'user@test.com',
        agent_id: 'agent-1',
        action: 'session_created',
      });

      // Fire-and-forget; give it a tick
      await new Promise(r => setTimeout(r, 10));

      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toContain('INSERT INTO chat_activity');
      expect(calls[0].params).toEqual([
        'default',
        'sess-123',
        'user@test.com',
        'agent-1',
        'session_created',
        null, // no detail
      ]);
    });

    it('serializes detail as JSON', async () => {
      const { pool, calls } = createMockPool();

      recordChatActivity(pool, {
        namespace: 'ns',
        action: 'message_sent',
        detail: { message_id: 'msg-1', content_type: 'text/plain' },
      });

      await new Promise(r => setTimeout(r, 10));

      expect(calls).toHaveLength(1);
      expect(calls[0].params[5]).toBe('{"message_id":"msg-1","content_type":"text/plain"}');
    });

    it('does not throw on pool error', async () => {
      const pool = {
        query: vi.fn().mockRejectedValue(new Error('DB down')),
      };

      // Should not throw
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      recordChatActivity(pool as any, {
        namespace: 'default',
        action: 'test',
      });

      await new Promise(r => setTimeout(r, 10));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Chat Audit]'),
        'DB down',
      );
      consoleSpy.mockRestore();
    });

    it('sets null for optional fields', async () => {
      const { pool, calls } = createMockPool();

      recordChatActivity(pool, {
        namespace: 'default',
        action: 'ws_connected',
      });

      await new Promise(r => setTimeout(r, 10));

      expect(calls[0].params[1]).toBeNull(); // session_id
      expect(calls[0].params[2]).toBeNull(); // user_email
      expect(calls[0].params[3]).toBeNull(); // agent_id
      expect(calls[0].params[5]).toBeNull(); // detail
    });
  });

  describe('recordChatActivitySync', () => {
    it('awaits the insert', async () => {
      const { pool, calls } = createMockPool();

      await recordChatActivitySync(pool, {
        namespace: 'default',
        action: 'session_ended',
        session_id: 'sess-456',
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].params[4]).toBe('session_ended');
    });
  });
});
