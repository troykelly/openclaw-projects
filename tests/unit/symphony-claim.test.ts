/**
 * Symphony Claim & Concurrency Control — Unit Tests
 *
 * Tests:
 * - Claim lock prevents double-claiming
 * - Advisory lock serializes host capacity checks
 * - Four-level concurrency correctly limits dispatch
 * - Candidate sorting by priority/age/identifier
 * - Idempotency key support for claim retries
 * - Claim lease renewal and expiration
 * - Advisory lock ordering is deterministic
 *
 * Issue #2197
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SymphonyClaimManager, CLAIM_TIMEOUT_SECONDS } from '../../src/symphony/claim.js';
import { RunState } from '../../src/symphony/states.js';
import type { Pool, PoolClient, QueryResult } from 'pg';

/** Helper to create a mock pool/client that tracks advisory lock calls. */
function createMockPool() {
  const queryResults: Array<Partial<QueryResult>> = [];
  let queryCallIndex = 0;
  const advisoryLockCalls: number[] = [];

  const mockQuery = vi.fn(async (sql: string, params?: unknown[]) => {
    // Track advisory lock acquisitions
    if (typeof sql === 'string' && sql.includes('pg_advisory_xact_lock')) {
      const lockId = (params as number[])?.[0];
      if (lockId !== undefined) advisoryLockCalls.push(lockId);
    }

    const result = queryResults[queryCallIndex] ?? { rows: [], rowCount: 0 };
    queryCallIndex++;
    return result as QueryResult;
  });

  const mockClient = {
    query: mockQuery,
    release: vi.fn(),
  } as unknown as PoolClient;

  const mockPool = {
    query: mockQuery,
    connect: vi.fn(async () => mockClient),
  } as unknown as Pool;

  return {
    pool: mockPool,
    client: mockClient,
    query: mockQuery,
    advisoryLockCalls,
    pushResult: (result: Partial<QueryResult>) => {
      queryResults.push(result);
    },
    resetCallIndex: () => {
      queryCallIndex = 0;
    },
  };
}

describe('SymphonyClaimManager', () => {
  let mock: ReturnType<typeof createMockPool>;
  let cm: SymphonyClaimManager;

  beforeEach(() => {
    mock = createMockPool();
    cm = new SymphonyClaimManager(mock.pool);
    vi.clearAllMocks();
  });

  describe('CLAIM_TIMEOUT_SECONDS', () => {
    it('is 60 seconds', () => {
      expect(CLAIM_TIMEOUT_SECONDS).toBe(60);
    });
  });

  describe('claimWorkItem', () => {
    const baseOptions = {
      orchestratorId: 'orch-1',
      hostId: 'host-uuid-1',
      projectId: 'project-uuid-1',
      namespace: 'test-ns',
      limits: { maxConcurrentAgents: 10 },
    };

    it('succeeds when all concurrency levels pass', async () => {
      // BEGIN
      mock.pushResult({ rows: [] });
      // Advisory lock: global
      mock.pushResult({ rows: [] });
      // Advisory lock: project
      mock.pushResult({ rows: [] });
      // Advisory lock: host
      mock.pushResult({ rows: [] });
      // Check existing active claim (none found)
      mock.pushResult({ rows: [] });
      // Global count
      mock.pushResult({ rows: [{ count: '3' }] });
      // Project concurrency config (no config = no limit)
      mock.pushResult({ rows: [] });
      // Host concurrency limit
      mock.pushResult({ rows: [{ max_concurrent_sessions: 5 }] });
      // Host active count
      mock.pushResult({ rows: [{ count: '2' }] });
      // Get next epoch
      mock.pushResult({ rows: [{ next_epoch: 1 }] });
      // INSERT claim
      mock.pushResult({ rows: [{ id: 'claim-1', claim_epoch: 1 }] });
      // COMMIT
      mock.pushResult({ rows: [] });

      const result = await cm.claimWorkItem('work-item-1', baseOptions);
      expect(result.success).toBe(true);
      expect(result.claimId).toBe('claim-1');
      expect(result.claimEpoch).toBe(1);
    });

    it('rejects when global concurrency limit reached', async () => {
      // BEGIN
      mock.pushResult({ rows: [] });
      // Advisory locks
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      // No existing claim
      mock.pushResult({ rows: [] });
      // Global count = limit
      mock.pushResult({ rows: [{ count: '10' }] });
      // ROLLBACK
      mock.pushResult({ rows: [] });

      const result = await cm.claimWorkItem('work-item-1', baseOptions);
      expect(result.success).toBe(false);
      expect(result.rejectedBy).toBe('global');
      expect(result.reason).toContain('Global concurrency limit');
    });

    it('rejects when project concurrency limit reached', async () => {
      // BEGIN
      mock.pushResult({ rows: [] });
      // Advisory locks
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      // No existing claim
      mock.pushResult({ rows: [] });
      // Global count OK
      mock.pushResult({ rows: [{ count: '3' }] });
      // Project config with limit of 2
      mock.pushResult({ rows: [{ config: { max_concurrent: 2 } }] });
      // Project active count = 2
      mock.pushResult({ rows: [{ count: '2' }] });
      // ROLLBACK
      mock.pushResult({ rows: [] });

      const result = await cm.claimWorkItem('work-item-1', baseOptions);
      expect(result.success).toBe(false);
      expect(result.rejectedBy).toBe('project');
    });

    it('rejects when host concurrency limit reached', async () => {
      // BEGIN
      mock.pushResult({ rows: [] });
      // Advisory locks
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      // No existing claim
      mock.pushResult({ rows: [] });
      // Global count OK
      mock.pushResult({ rows: [{ count: '3' }] });
      // No project config
      mock.pushResult({ rows: [] });
      // Host limit = 2
      mock.pushResult({ rows: [{ max_concurrent_sessions: 2 }] });
      // Host active count = 2
      mock.pushResult({ rows: [{ count: '2' }] });
      // ROLLBACK
      mock.pushResult({ rows: [] });

      const result = await cm.claimWorkItem('work-item-1', baseOptions);
      expect(result.success).toBe(false);
      expect(result.rejectedBy).toBe('host');
    });

    it('rejects when per-state concurrency limit reached', async () => {
      const options = {
        ...baseOptions,
        targetState: RunState.Running,
        limits: {
          maxConcurrentAgents: 10,
          perStateLimits: new Map([[RunState.Running, 3]]),
        },
      };

      // BEGIN
      mock.pushResult({ rows: [] });
      // Advisory locks: global, project, host, state
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      // No existing claim
      mock.pushResult({ rows: [] });
      // Global count OK
      mock.pushResult({ rows: [{ count: '5' }] });
      // No project config
      mock.pushResult({ rows: [] });
      // Host limit OK
      mock.pushResult({ rows: [{ max_concurrent_sessions: 10 }] });
      // Host active count OK
      mock.pushResult({ rows: [{ count: '2' }] });
      // State count = limit
      mock.pushResult({ rows: [{ count: '3' }] });
      // ROLLBACK
      mock.pushResult({ rows: [] });

      const result = await cm.claimWorkItem('work-item-1', options);
      expect(result.success).toBe(false);
      expect(result.rejectedBy).toBe('state');
    });

    it('rejects when work item already claimed', async () => {
      // BEGIN
      mock.pushResult({ rows: [] });
      // Advisory locks
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      // Existing active claim found
      mock.pushResult({ rows: [{ id: 'existing-claim' }] });
      // ROLLBACK
      mock.pushResult({ rows: [] });

      const result = await cm.claimWorkItem('work-item-1', baseOptions);
      expect(result.success).toBe(false);
      expect(result.rejectedBy).toBe('already_claimed');
    });

    it('returns existing claim for idempotency key retry', async () => {
      const options = {
        ...baseOptions,
        idempotencyKey: 'idem-key-1',
      };

      // BEGIN
      mock.pushResult({ rows: [] });
      // Idempotency check — found existing active claim matching key
      mock.pushResult({
        rows: [{ id: 'existing-claim', claim_epoch: 2, status: 'active' }],
      });
      // COMMIT
      mock.pushResult({ rows: [] });

      const result = await cm.claimWorkItem('work-item-1', options);
      expect(result.success).toBe(true);
      expect(result.claimId).toBe('existing-claim');
      expect(result.claimEpoch).toBe(2);

      // Verify the idempotency query matches on the key
      const idemCall = mock.query.mock.calls[1]; // Second call after BEGIN
      expect(idemCall[0]).toContain('idempotency_key');
      expect(idemCall[1]).toContain('idem-key-1');
    });

    it('does not return claim for different idempotency key', async () => {
      const options = {
        ...baseOptions,
        idempotencyKey: 'idem-key-2',
      };

      // BEGIN
      mock.pushResult({ rows: [] });
      // Idempotency check — no match for this key
      mock.pushResult({ rows: [] });
      // Advisory locks
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      // No existing claim
      mock.pushResult({ rows: [] });
      // Global count OK
      mock.pushResult({ rows: [{ count: '0' }] });
      // No project config
      mock.pushResult({ rows: [] });
      // No host limit
      mock.pushResult({ rows: [] });
      // Epoch
      mock.pushResult({ rows: [{ next_epoch: 1 }] });
      // INSERT claim (includes idempotency_key)
      mock.pushResult({ rows: [{ id: 'new-claim', claim_epoch: 1 }] });
      // COMMIT
      mock.pushResult({ rows: [] });

      const result = await cm.claimWorkItem('work-item-1', options);
      expect(result.success).toBe(true);
      expect(result.claimId).toBe('new-claim');

      // Verify INSERT includes idempotency_key
      const insertCall = mock.query.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO symphony_claim'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toContain('idem-key-2');
    });

    it('acquires advisory locks in deterministic order: global → project → host', async () => {
      // BEGIN
      mock.pushResult({ rows: [] });
      // Advisory lock: global (ns=1, key=1)
      mock.pushResult({ rows: [] });
      // Advisory lock: project (ns=2, key=hash)
      mock.pushResult({ rows: [] });
      // Advisory lock: host (ns=3, key=hash)
      mock.pushResult({ rows: [] });
      // No existing claim
      mock.pushResult({ rows: [] });
      // Global count OK
      mock.pushResult({ rows: [{ count: '3' }] });
      // No project config
      mock.pushResult({ rows: [] });
      // Host limit
      mock.pushResult({ rows: [{ max_concurrent_sessions: 5 }] });
      // Host active count
      mock.pushResult({ rows: [{ count: '2' }] });
      // Get next epoch
      mock.pushResult({ rows: [{ next_epoch: 1 }] });
      // INSERT claim
      mock.pushResult({ rows: [{ id: 'claim-1', claim_epoch: 1 }] });
      // COMMIT
      mock.pushResult({ rows: [] });

      await cm.claimWorkItem('work-item-1', baseOptions);

      // Verify lock calls use two-parameter form with ascending namespace constants
      // advisoryLockCalls captures the first parameter of each pg_advisory_xact_lock call
      expect(mock.advisoryLockCalls.length).toBe(3);
      // Namespace order: GLOBAL(1) → PROJECT(2) → HOST(3)
      expect(mock.advisoryLockCalls[0]).toBe(1); // LOCK_NS_GLOBAL
      expect(mock.advisoryLockCalls[1]).toBe(2); // LOCK_NS_PROJECT
      expect(mock.advisoryLockCalls[2]).toBe(3); // LOCK_NS_HOST
    });

    it('increments claim_epoch monotonically', async () => {
      // BEGIN
      mock.pushResult({ rows: [] });
      // Advisory locks
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      mock.pushResult({ rows: [] });
      // No existing claim
      mock.pushResult({ rows: [] });
      // Global count OK
      mock.pushResult({ rows: [{ count: '0' }] });
      // No project config
      mock.pushResult({ rows: [] });
      // No host limit
      mock.pushResult({ rows: [] });
      // Previous max epoch was 5
      mock.pushResult({ rows: [{ next_epoch: 6 }] });
      // INSERT claim
      mock.pushResult({ rows: [{ id: 'claim-2', claim_epoch: 6 }] });
      // COMMIT
      mock.pushResult({ rows: [] });

      const result = await cm.claimWorkItem('work-item-1', baseOptions);
      expect(result.claimEpoch).toBe(6);
    });
  });

  describe('releaseClaim', () => {
    it('releases an active claim', async () => {
      mock.pushResult({ rowCount: 1 });

      const released = await cm.releaseClaim('claim-1');
      expect(released).toBe(true);

      expect(mock.query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'released'"),
        ['claim-1'],
      );
    });

    it('returns false if claim not found or already released', async () => {
      mock.pushResult({ rowCount: 0 });

      const released = await cm.releaseClaim('nonexistent');
      expect(released).toBe(false);
    });
  });

  describe('renewLease', () => {
    it('extends lease expiration', async () => {
      mock.pushResult({ rowCount: 1 });

      const renewed = await cm.renewLease('claim-1', 120);
      expect(renewed).toBe(true);

      expect(mock.query).toHaveBeenCalledWith(
        expect.stringContaining('lease_expires_at'),
        [120, 'claim-1'],
      );
    });

    it('uses default timeout when no extension specified', async () => {
      mock.pushResult({ rowCount: 1 });

      await cm.renewLease('claim-1');

      expect(mock.query).toHaveBeenCalledWith(
        expect.stringContaining('lease_expires_at'),
        [CLAIM_TIMEOUT_SECONDS, 'claim-1'],
      );
    });
  });

  describe('expireStaleClaims', () => {
    it('expires claims past their lease', async () => {
      // connect
      // BEGIN
      mock.pushResult({ rows: [] });
      // UPDATE expired
      mock.pushResult({ rowCount: 3 });
      // COMMIT
      mock.pushResult({ rows: [] });

      const count = await cm.expireStaleClaims();
      expect(count).toBe(3);
    });

    it('scopes to orchestrator when provided', async () => {
      // connect
      // BEGIN
      mock.pushResult({ rows: [] });
      // UPDATE
      mock.pushResult({ rowCount: 1 });
      // COMMIT
      mock.pushResult({ rows: [] });

      await cm.expireStaleClaims('orch-1');

      // Should include orchestrator_id filter
      const updateCall = mock.query.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes("status = 'expired'"),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toContain('orch-1');
    });
  });

  describe('selectCandidates', () => {
    it('returns candidates sorted by priority, created_at, identifier', async () => {
      mock.pushResult({
        rows: [
          {
            id: 'wi-1',
            project_id: 'proj-1',
            priority: 1,
            created_at: new Date('2026-01-01'),
            identifier: 'PROJ-001',
          },
          {
            id: 'wi-2',
            project_id: 'proj-1',
            priority: 2,
            created_at: new Date('2026-01-02'),
            identifier: 'PROJ-002',
          },
          {
            id: 'wi-3',
            project_id: 'proj-1',
            priority: null,
            created_at: new Date('2025-12-01'),
            identifier: 'PROJ-003',
          },
        ],
      });

      const candidates = await cm.selectCandidates({
        namespace: 'test-ns',
      });

      expect(candidates).toHaveLength(3);
      // Should be in priority order (1, 2, null last)
      expect(candidates[0].priority).toBe(1);
      expect(candidates[1].priority).toBe(2);
      expect(candidates[2].priority).toBeNull();
    });

    it('filters by project when specified', async () => {
      mock.pushResult({ rows: [] });

      await cm.selectCandidates({
        namespace: 'test-ns',
        projectId: 'proj-1',
      });

      const call = mock.query.mock.calls[0];
      expect(call[0]).toContain('parent_id');
      expect(call[1]).toContain('proj-1');
    });

    it('respects limit parameter', async () => {
      mock.pushResult({ rows: [] });

      await cm.selectCandidates({
        namespace: 'test-ns',
        limit: 5,
      });

      const call = mock.query.mock.calls[0];
      expect(call[1]).toContain(5);
    });
  });
});
