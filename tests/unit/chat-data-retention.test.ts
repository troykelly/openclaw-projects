/**
 * Unit tests for chat data retention (#1964).
 *
 * Tests the GDPR deletion functions with a mock pool.
 * Integration tests (with real DB) are in tests/integration/.
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect, vi } from 'vitest';
import { deleteAllChatDataForUser, deleteChatSession } from '../../src/api/chat/data-retention.ts';

function createMockClient() {
  const queries: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      // Return appropriate results based on the query
      if (sql.includes('count(*)')) {
        return Promise.resolve({ rows: [{ cnt: 3 }], rowCount: 1 });
      }
      if (sql.includes('SELECT thread_id')) {
        return Promise.resolve({ rows: [{ thread_id: 't1' }, { thread_id: 't2' }], rowCount: 2 });
      }
      return Promise.resolve({ rows: [], rowCount: 2 });
    }),
    release: vi.fn(),
  };
  return { client, queries };
}

function createMockPool(client: ReturnType<typeof createMockClient>['client']) {
  return {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
  } as any;
}

describe('Chat Data Retention (#1964)', () => {
  describe('deleteAllChatDataForUser', () => {
    it('executes deletion in a transaction', async () => {
      const { client, queries } = createMockClient();
      const pool = createMockPool(client);

      const result = await deleteAllChatDataForUser(pool, 'user@test.com');

      // Check BEGIN and COMMIT
      const sqlTexts = queries.map(q => q.sql);
      expect(sqlTexts[0]).toBe('BEGIN');
      expect(sqlTexts[sqlTexts.length - 1]).toBe('COMMIT');

      // Check result
      expect(result.sessions_deleted).toBe(3);
      expect(result.messages_deleted).toBe(3); // from the count query mock
      expect(result.activity_deleted).toBe(2); // from rowCount mock
    });

    it('deletes from all related tables', async () => {
      const { client, queries } = createMockClient();
      const pool = createMockPool(client);

      await deleteAllChatDataForUser(pool, 'user@test.com');

      const sqlTexts = queries.map(q => q.sql);

      expect(sqlTexts.some(s => s.includes('DELETE FROM chat_read_cursor'))).toBe(true);
      expect(sqlTexts.some(s => s.includes('DELETE FROM chat_session'))).toBe(true);
      expect(sqlTexts.some(s => s.includes('DELETE FROM chat_activity'))).toBe(true);
      expect(sqlTexts.some(s => s.includes('DELETE FROM notification_dedup'))).toBe(true);
      expect(sqlTexts.some(s => s.includes('DELETE FROM notification_rate'))).toBe(true);
    });

    it('rolls back on error', async () => {
      const { client } = createMockClient();
      // Make one of the DELETE queries fail
      let callCount = 0;
      client.query.mockImplementation((sql: string) => {
        callCount++;
        if (callCount === 4) { // After BEGIN, count, thread select, fail on read_cursor delete
          return Promise.reject(new Error('DB error'));
        }
        if (sql.includes('count(*)')) {
          return Promise.resolve({ rows: [{ cnt: 0 }], rowCount: 1 });
        }
        if (sql.includes('SELECT thread_id')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const pool = createMockPool(client);

      await expect(deleteAllChatDataForUser(pool, 'user@test.com')).rejects.toThrow('DB error');

      // Verify ROLLBACK was called
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('deleteChatSession', () => {
    it('returns true when session exists and is deleted', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // DELETE chat_session
          .mockResolvedValueOnce({ rows: [], rowCount: 5 }), // DELETE chat_activity
      } as any;

      const result = await deleteChatSession(pool, 'sess-123', 'user@test.com');
      expect(result).toBe(true);
    });

    it('returns false when session does not exist', async () => {
      const pool = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      } as any;

      const result = await deleteChatSession(pool, 'sess-404', 'user@test.com');
      expect(result).toBe(false);
    });

    it('cleans up activity logs after session deletion', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // DELETE chat_session
          .mockResolvedValueOnce({ rows: [], rowCount: 3 }), // DELETE chat_activity
      } as any;

      await deleteChatSession(pool, 'sess-123', 'user@test.com');

      expect(pool.query).toHaveBeenCalledTimes(2);
      const secondCall = pool.query.mock.calls[1];
      expect(secondCall[0]).toContain('DELETE FROM chat_activity');
      expect(secondCall[1]).toEqual(['sess-123']);
    });
  });
});
