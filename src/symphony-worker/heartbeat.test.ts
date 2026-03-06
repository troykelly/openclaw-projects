/**
 * Unit tests for symphony worker heartbeat.
 * Issue #2195 — Symphony Worker Process Skeleton.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateOrchestratorId, writeHeartbeat, HeartbeatManager } from './heartbeat.ts';

// Mock pool for unit tests
function createMockPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
}

describe('generateOrchestratorId', () => {
  it('generates a non-empty string', () => {
    const id = generateOrchestratorId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('includes hostname and pid', () => {
    const id = generateOrchestratorId();
    expect(id).toContain(String(process.pid));
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateOrchestratorId()));
    expect(ids.size).toBe(10);
  });
});

describe('writeHeartbeat', () => {
  it('executes upsert query with correct parameters', async () => {
    const pool = createMockPool();
    await writeHeartbeat(pool as never, 'test-ns', 'orch-1', 3);

    expect(pool.query).toHaveBeenCalledOnce();
    const [query, params] = pool.query.mock.calls[0];
    expect(query).toContain('INSERT INTO symphony_orchestrator_heartbeat');
    expect(query).toContain('ON CONFLICT (orchestrator_id)');
    expect(params[0]).toBe('test-ns');
    expect(params[1]).toBe('orch-1');
    expect(params[2]).toBe(3);
  });

  it('throws on query failure', async () => {
    const pool = createMockPool();
    pool.query.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      writeHeartbeat(pool as never, 'test-ns', 'orch-1', 0),
    ).rejects.toThrow('connection lost');
  });
});

describe('HeartbeatManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes an immediate heartbeat on start', async () => {
    const pool = createMockPool();
    const manager = new HeartbeatManager({
      pool: pool as never,
      namespace: 'test-ns',
      orchestratorId: 'orch-1',
      intervalMs: 60_000,
      activeRunsGetter: () => 0,
    });

    await manager.start();
    expect(pool.query).toHaveBeenCalledOnce();
    manager.stop();
  });

  it('stops cleanly without errors', async () => {
    const pool = createMockPool();
    const manager = new HeartbeatManager({
      pool: pool as never,
      namespace: 'test-ns',
      orchestratorId: 'orch-1',
      intervalMs: 60_000,
      activeRunsGetter: () => 0,
    });

    await manager.start();
    manager.stop();
    // No lingering timers
  });

  it('uses the activeRunsGetter to report current active runs', async () => {
    const pool = createMockPool();
    let runs = 5;
    const manager = new HeartbeatManager({
      pool: pool as never,
      namespace: 'test-ns',
      orchestratorId: 'orch-1',
      intervalMs: 60_000,
      activeRunsGetter: () => runs,
    });

    await manager.start();
    const params = pool.query.mock.calls[0][1];
    expect(params[2]).toBe(5);
    manager.stop();
  });
});
