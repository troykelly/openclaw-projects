/**
 * Unit tests for SSH tunnel management handlers.
 * Issue #1852 — SSH tunnel RPCs.
 *
 * Tests handler logic in isolation using mocked pool and SSH manager.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleCloseTunnel,
  handleListTunnels,
  cleanupAllTunnels,
  getActiveTunnelCount,
} from './tunnel-handlers.ts';

// Mock pool with query tracking
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

describe('tunnel-handlers', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
    cleanupAllTunnels();
  });

  describe('handleCloseTunnel', () => {
    it('closes an active tunnel and updates DB', async () => {
      pool.__setResult('UPDATE terminal_tunnel SET status', {
        rows: [{ id: 'tunnel-1' }],
        rowCount: 1,
      });

      await handleCloseTunnel(
        { tunnel_id: 'tunnel-1' },
        pool as never,
      );

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE terminal_tunnel SET status'),
        ['tunnel-1'],
      );
    });

    it('throws if tunnel not found or already closed', async () => {
      await expect(
        handleCloseTunnel(
          { tunnel_id: 'nonexistent' },
          pool as never,
        ),
      ).rejects.toThrow('not found or already closed');
    });
  });

  describe('handleListTunnels', () => {
    it('lists tunnels with no filters', async () => {
      pool.__setResult('SELECT id, connection_id', {
        rows: [
          {
            id: 'tunnel-1',
            connection_id: 'conn-1',
            session_id: null,
            direction: 'local',
            bind_host: '127.0.0.1',
            bind_port: 8080,
            target_host: 'remote.host',
            target_port: 80,
            status: 'active',
            error_message: null,
          },
        ],
        rowCount: 1,
      });

      const result = await handleListTunnels(
        { namespace: '', connection_id: '' },
        pool as never,
      );

      expect(result.tunnels).toHaveLength(1);
      expect(result.tunnels[0].id).toBe('tunnel-1');
      expect(result.tunnels[0].direction).toBe('local');
      expect(result.tunnels[0].status).toBe('active');
      expect(result.tunnels[0].session_id).toBe('');
    });

    it('filters by namespace', async () => {
      pool.__setResult('SELECT id, connection_id', {
        rows: [],
        rowCount: 0,
      });

      const result = await handleListTunnels(
        { namespace: 'test-ns', connection_id: '' },
        pool as never,
      );

      expect(result.tunnels).toHaveLength(0);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('namespace = $1'),
        ['test-ns'],
      );
    });

    it('filters by connection_id', async () => {
      pool.__setResult('SELECT id, connection_id', {
        rows: [],
        rowCount: 0,
      });

      const result = await handleListTunnels(
        { namespace: '', connection_id: 'conn-1' },
        pool as never,
      );

      expect(result.tunnels).toHaveLength(0);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('connection_id = $1'),
        ['conn-1'],
      );
    });
  });

  describe('cleanupAllTunnels', () => {
    it('reports zero active tunnels after cleanup', () => {
      cleanupAllTunnels();
      expect(getActiveTunnelCount()).toBe(0);
    });
  });
});
