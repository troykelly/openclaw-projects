/**
 * Unit tests for host key verification handlers.
 * Issue #1854 — Host key verification RPCs.
 *
 * Tests ApproveHostKey and RejectHostKey handler logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleApproveHostKey,
  handleRejectHostKey,
} from './host-key-handlers.ts';

// Mock pool
function createMockPool() {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const mockResults = new Map<string, { rows: unknown[]; rowCount: number }>();

  const pool = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      queries.push({ text, params });
      for (const [pattern, result] of mockResults) {
        if (text.includes(pattern)) {
          return result;
        }
      }
      return { rows: [], rowCount: 0 };
    }),
    __queries: queries,
    __setResult: (pattern: string, result: { rows: unknown[]; rowCount: number }) => {
      mockResults.set(pattern, result);
    },
  };

  return pool;
}

describe('host-key-handlers', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
  });

  describe('handleApproveHostKey', () => {
    it('approves a host key and resumes session', async () => {
      pool.__setResult('SELECT id, namespace, connection_id, status', {
        rows: [{
          id: 'sess-1',
          namespace: 'default',
          connection_id: 'conn-1',
          status: 'pending_host_verification',
        }],
        rowCount: 1,
      });

      await handleApproveHostKey(
        {
          session_id: 'sess-1',
          host: 'server.example.com',
          port: 22,
          key_type: 'ssh-ed25519',
          fingerprint: 'SHA256:abc123',
          public_key: 'AAAAC3Nza...',
        },
        pool as never,
      );

      // Should have upserted the known host
      const upsertQuery = pool.__queries.find(q => q.text.includes('INSERT INTO terminal_known_host'));
      expect(upsertQuery).toBeDefined();
      expect(upsertQuery!.params).toContain('server.example.com');
      expect(upsertQuery!.params).toContain(22);
      expect(upsertQuery!.params).toContain('ssh-ed25519');
      expect(upsertQuery!.params).toContain('SHA256:abc123');

      // Should have updated session status to active
      const updateQuery = pool.__queries.find(q =>
        q.text.includes('UPDATE terminal_session') && q.text.includes("status = 'active'")
      );
      expect(updateQuery).toBeDefined();
      expect(updateQuery!.params).toContain('sess-1');
    });

    it('throws if session not found', async () => {
      await expect(
        handleApproveHostKey(
          {
            session_id: 'nonexistent',
            host: 'server.example.com',
            port: 22,
            key_type: 'ssh-ed25519',
            fingerprint: 'SHA256:abc123',
            public_key: 'AAAAC3Nza...',
          },
          pool as never,
        ),
      ).rejects.toThrow('Session not found');
    });

    it('throws if session is not pending host verification', async () => {
      pool.__setResult('SELECT id, namespace, connection_id, status', {
        rows: [{
          id: 'sess-1',
          namespace: 'default',
          connection_id: 'conn-1',
          status: 'active',
        }],
        rowCount: 1,
      });

      await expect(
        handleApproveHostKey(
          {
            session_id: 'sess-1',
            host: 'server.example.com',
            port: 22,
            key_type: 'ssh-ed25519',
            fingerprint: 'SHA256:abc123',
            public_key: 'AAAAC3Nza...',
          },
          pool as never,
        ),
      ).rejects.toThrow('not pending host verification');
    });
  });

  describe('handleRejectHostKey', () => {
    it('rejects a host key and terminates session', async () => {
      pool.__setResult('SELECT id, namespace, connection_id, status', {
        rows: [{
          id: 'sess-1',
          namespace: 'default',
          connection_id: 'conn-1',
          status: 'pending_host_verification',
        }],
        rowCount: 1,
      });

      await handleRejectHostKey(
        { session_id: 'sess-1' },
        pool as never,
      );

      // Should have updated session status to error
      const updateQuery = pool.__queries.find(q =>
        q.text.includes('UPDATE terminal_session') && q.text.includes("status = 'error'")
      );
      expect(updateQuery).toBeDefined();
      expect(updateQuery!.params).toContain('sess-1');
    });

    it('throws if session not found', async () => {
      await expect(
        handleRejectHostKey(
          { session_id: 'nonexistent' },
          pool as never,
        ),
      ).rejects.toThrow('Session not found');
    });

    it('throws if session is not pending host verification', async () => {
      pool.__setResult('SELECT id, namespace, connection_id, status', {
        rows: [{
          id: 'sess-1',
          namespace: 'default',
          connection_id: 'conn-1',
          status: 'terminated',
        }],
        rowCount: 1,
      });

      await expect(
        handleRejectHostKey(
          { session_id: 'sess-1' },
          pool as never,
        ),
      ).rejects.toThrow('not pending host verification');
    });
  });
});
