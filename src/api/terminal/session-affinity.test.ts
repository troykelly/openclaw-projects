/**
 * Tests for session affinity utilities.
 * Issue #2124 — No session affinity routing for HA deployments.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getSessionWorkerId,
  parseWorkerRegistry,
  resolveWorkerGrpcUrl,
  isMultiWorkerMode,
} from './session-affinity.ts';
import type pg from 'pg';

describe('session-affinity', () => {
  afterEach(() => {
    delete process.env.TMUX_WORKER_REGISTRY;
    delete process.env.TMUX_WORKER_GRPC_URL;
  });

  describe('getSessionWorkerId', () => {
    it('returns worker_id for an existing session', async () => {
      const pool = {
        query: vi.fn().mockResolvedValue({
          rows: [{ worker_id: 'worker-abc' }],
        }),
      } as unknown as pg.Pool;

      const result = await getSessionWorkerId(pool, 'session-123');
      expect(result).toBe('worker-abc');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT worker_id'),
        ['session-123'],
      );
    });

    it('returns null for a non-existent session', async () => {
      const pool = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      } as unknown as pg.Pool;

      const result = await getSessionWorkerId(pool, 'no-such-session');
      expect(result).toBeNull();
    });
  });

  describe('parseWorkerRegistry', () => {
    it('parses a single entry', () => {
      process.env.TMUX_WORKER_REGISTRY = 'worker-1=grpc-host-1:50051';
      const registry = parseWorkerRegistry();
      expect(registry.size).toBe(1);
      expect(registry.get('worker-1')).toBe('grpc-host-1:50051');
    });

    it('parses multiple comma-separated entries', () => {
      process.env.TMUX_WORKER_REGISTRY =
        'worker-1=host1:50051,worker-2=host2:50052,worker-3=host3:50053';
      const registry = parseWorkerRegistry();
      expect(registry.size).toBe(3);
      expect(registry.get('worker-1')).toBe('host1:50051');
      expect(registry.get('worker-2')).toBe('host2:50052');
      expect(registry.get('worker-3')).toBe('host3:50053');
    });

    it('handles whitespace in entries', () => {
      process.env.TMUX_WORKER_REGISTRY = ' worker-1 = host1:50051 , worker-2 = host2:50052 ';
      const registry = parseWorkerRegistry();
      expect(registry.size).toBe(2);
      expect(registry.get('worker-1')).toBe('host1:50051');
      expect(registry.get('worker-2')).toBe('host2:50052');
    });

    it('returns empty map when env var is not set', () => {
      delete process.env.TMUX_WORKER_REGISTRY;
      const registry = parseWorkerRegistry();
      expect(registry.size).toBe(0);
    });

    it('returns empty map when env var is empty', () => {
      process.env.TMUX_WORKER_REGISTRY = '';
      const registry = parseWorkerRegistry();
      expect(registry.size).toBe(0);
    });

    it('skips malformed entries without =', () => {
      process.env.TMUX_WORKER_REGISTRY = 'worker-1=host1:50051,bad-entry,worker-2=host2:50052';
      const registry = parseWorkerRegistry();
      expect(registry.size).toBe(2);
    });

    it('skips entries with empty key', () => {
      process.env.TMUX_WORKER_REGISTRY = '=host1:50051,worker-2=host2:50052';
      const registry = parseWorkerRegistry();
      expect(registry.size).toBe(1);
      expect(registry.get('worker-2')).toBe('host2:50052');
    });
  });

  describe('resolveWorkerGrpcUrl', () => {
    it('returns URL from registry when worker is registered', () => {
      const registry = new Map([
        ['worker-1', 'host1:50051'],
        ['worker-2', 'host2:50052'],
      ]);
      expect(resolveWorkerGrpcUrl('worker-1', registry)).toBe('host1:50051');
      expect(resolveWorkerGrpcUrl('worker-2', registry)).toBe('host2:50052');
    });

    it('falls back to TMUX_WORKER_GRPC_URL when worker is not in registry', () => {
      process.env.TMUX_WORKER_GRPC_URL = 'default-host:50051';
      const registry = new Map<string, string>();
      expect(resolveWorkerGrpcUrl('unknown-worker', registry)).toBe('default-host:50051');
    });

    it('falls back to localhost:50051 when nothing is configured', () => {
      delete process.env.TMUX_WORKER_GRPC_URL;
      const registry = new Map<string, string>();
      expect(resolveWorkerGrpcUrl('unknown-worker', registry)).toBe('localhost:50051');
    });

    it('uses TMUX_WORKER_REGISTRY from env when registry param not provided', () => {
      process.env.TMUX_WORKER_REGISTRY = 'worker-a=remotehost:50051';
      expect(resolveWorkerGrpcUrl('worker-a')).toBe('remotehost:50051');
    });
  });

  describe('isMultiWorkerMode', () => {
    it('returns true when worker registry is configured', () => {
      process.env.TMUX_WORKER_REGISTRY = 'worker-1=host1:50051';
      expect(isMultiWorkerMode()).toBe(true);
    });

    it('returns false when worker registry is empty', () => {
      process.env.TMUX_WORKER_REGISTRY = '';
      expect(isMultiWorkerMode()).toBe(false);
    });

    it('returns false when worker registry is not set', () => {
      delete process.env.TMUX_WORKER_REGISTRY;
      expect(isMultiWorkerMode()).toBe(false);
    });
  });
});
