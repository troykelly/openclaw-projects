/**
 * Unit tests for symphony worker recovery sweep.
 * Issue #2195 — Symphony Worker Process Skeleton.
 */

import { describe, it, expect, vi } from 'vitest';
import { recoverOrphanedRuns, recoverySweep } from './recovery.ts';

// Mock pool for unit tests
function createMockPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
}

describe('recoverOrphanedRuns', () => {
  it('returns empty array when no orphaned runs exist', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const results = await recoverOrphanedRuns(pool as never, 'test-ns', 'stale-orch-1');
    expect(results).toEqual([]);
  });

  it('transitions claiming runs to failed', async () => {
    const pool = createMockPool();
    // First query: find orphaned runs
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'run-1', status: 'claiming' }],
      rowCount: 1,
    });
    // Second query: update run
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    // Third query: release claims
    pool.query.mockResolvedValueOnce({ rowCount: 1 });

    const results = await recoverOrphanedRuns(pool as never, 'test-ns', 'stale-orch-1');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      runId: 'run-1',
      previousStatus: 'claiming',
      newStatus: 'failed',
    });
  });

  it('transitions executing runs to timed_out', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'run-2', status: 'executing' }],
      rowCount: 1,
    });
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    pool.query.mockResolvedValueOnce({ rowCount: 1 });

    const results = await recoverOrphanedRuns(pool as never, 'test-ns', 'stale-orch-1');
    expect(results).toHaveLength(1);
    expect(results[0].newStatus).toBe('timed_out');
  });

  it('transitions provisioning runs to failed', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'run-3', status: 'provisioning' }],
      rowCount: 1,
    });
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    pool.query.mockResolvedValueOnce({ rowCount: 1 });

    const results = await recoverOrphanedRuns(pool as never, 'test-ns', 'stale-orch-1');
    expect(results[0].newStatus).toBe('failed');
  });

  it('handles multiple orphaned runs', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 'run-a', status: 'claiming' },
        { id: 'run-b', status: 'executing' },
        { id: 'run-c', status: 'paused' },
      ],
      rowCount: 3,
    });
    // Each run: update + release = 2 queries
    pool.query.mockResolvedValue({ rowCount: 1 });

    const results = await recoverOrphanedRuns(pool as never, 'test-ns', 'stale-orch-1');
    expect(results).toHaveLength(3);
    expect(results[0].newStatus).toBe('failed');
    expect(results[1].newStatus).toBe('timed_out');
    expect(results[2].newStatus).toBe('timed_out');
  });

  it('releases active claims for the stale orchestrator', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'run-1', status: 'claimed' }],
      rowCount: 1,
    });
    pool.query.mockResolvedValueOnce({ rowCount: 1 }); // update run
    pool.query.mockResolvedValueOnce({ rowCount: 1 }); // release claims

    await recoverOrphanedRuns(pool as never, 'test-ns', 'stale-orch-1');

    // Third call should release claims
    const releaseCall = pool.query.mock.calls[2];
    expect(releaseCall[0]).toContain('UPDATE symphony_claim');
    expect(releaseCall[0]).toContain("status = 'released'");
    expect(releaseCall[1][0]).toBe('stale-orch-1');
  });
});

describe('recoverySweep', () => {
  it('returns empty array when no stale orchestrators exist', async () => {
    const pool = createMockPool();
    // findStaleOrchestrators returns empty
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const results = await recoverySweep(pool as never, 'test-ns');
    expect(results).toEqual([]);
  });

  it('recovers runs from multiple stale orchestrators', async () => {
    const pool = createMockPool();
    // findStaleOrchestrators
    pool.query.mockResolvedValueOnce({
      rows: [
        { orchestrator_id: 'stale-1' },
        { orchestrator_id: 'stale-2' },
      ],
      rowCount: 2,
    });

    // Stale-1: one orphaned run
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'run-1', status: 'executing' }],
      rowCount: 1,
    });
    pool.query.mockResolvedValueOnce({ rowCount: 1 }); // update run
    pool.query.mockResolvedValueOnce({ rowCount: 1 }); // release claims
    pool.query.mockResolvedValueOnce({ rowCount: 1 }); // removeHeartbeat

    // Stale-2: no orphaned runs
    pool.query.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    });
    pool.query.mockResolvedValueOnce({ rowCount: 1 }); // removeHeartbeat

    const results = await recoverySweep(pool as never, 'test-ns');
    expect(results).toHaveLength(1);
    expect(results[0].runId).toBe('run-1');
  });
});
