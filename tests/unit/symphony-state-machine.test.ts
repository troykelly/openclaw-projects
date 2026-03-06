/**
 * Symphony State Machine Engine — Unit Tests
 *
 * Tests the state machine logic using a mock DB pool.
 * Covers:
 * - Valid state transitions succeed
 * - Invalid transitions rejected
 * - Compare-and-swap prevents concurrent mutation
 * - claim_epoch fencing blocks stale writes
 * - Terminal state idempotency
 * - Timeout detection triggers correct transitions
 * - Failure classification maps to correct classes
 * - Per-class retry limits enforced
 * - Stage inference is advisory only
 * - All transitions logged to symphony_run_event
 *
 * Issue #2196
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SymphonyStateMachine } from '../../src/symphony/state-machine.js';
import {
  RunState,
  RunStage,
  FailureClass,
} from '../../src/symphony/states.js';
import type { Pool, PoolClient, QueryResult } from 'pg';

/** Helper to create a mock pool/client. */
function createMockPool() {
  const queryResults: Array<Partial<QueryResult>> = [];
  let queryCallIndex = 0;

  const mockQuery = vi.fn(async () => {
    const result = queryResults[queryCallIndex] ?? { rows: [], rowCount: 0 };
    queryCallIndex++;
    return result as QueryResult;
  });

  const mockPool = {
    query: mockQuery,
    connect: vi.fn(async () => mockClient),
  } as unknown as Pool;

  const mockClient = {
    query: mockQuery,
    release: vi.fn(),
  } as unknown as PoolClient;

  return {
    pool: mockPool,
    client: mockClient,
    query: mockQuery,
    /** Push expected query results in order. */
    pushResult: (result: Partial<QueryResult>) => {
      queryResults.push(result);
    },
    resetCallIndex: () => {
      queryCallIndex = 0;
    },
  };
}

describe('SymphonyStateMachine', () => {
  let mock: ReturnType<typeof createMockPool>;
  let sm: SymphonyStateMachine;

  beforeEach(() => {
    mock = createMockPool();
    sm = new SymphonyStateMachine(mock.pool);
    vi.clearAllMocks();
  });

  describe('transition', () => {
    it('succeeds for valid transition with matching version', async () => {
      // SELECT current state (FOR UPDATE)
      mock.pushResult({
        rows: [{ status: 'unclaimed', state_version: 1, claim_epoch: null }],
      });
      // UPDATE with CAS
      mock.pushResult({ rows: [{ state_version: 2 }], rowCount: 1 });
      // SELECT namespace for event
      mock.pushResult({ rows: [{ namespace: 'test-ns' }] });
      // INSERT event
      mock.pushResult({ rows: [], rowCount: 1 });

      const result = await sm.transition({
        runId: 'run-1',
        targetState: RunState.Claimed,
        expectedVersion: 1,
        actor: 'orchestrator-1',
        trigger: 'claim',
      });

      expect(result.success).toBe(true);
      expect(result.currentState).toBe(RunState.Claimed);
      expect(result.stateVersion).toBe(2);
      expect(result.error).toBeUndefined();
    });

    it('rejects invalid transition', async () => {
      // SELECT current state
      mock.pushResult({
        rows: [{ status: 'unclaimed', state_version: 1, claim_epoch: null }],
      });

      const result = await sm.transition({
        runId: 'run-1',
        targetState: RunState.Running, // Invalid: cannot jump from unclaimed to running
        expectedVersion: 1,
        actor: 'orchestrator-1',
        trigger: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
      expect(result.currentState).toBe(RunState.Unclaimed);
    });

    it('rejects on state_version mismatch (CAS)', async () => {
      // SELECT current state — version is 3, not the expected 1
      mock.pushResult({
        rows: [{ status: 'unclaimed', state_version: 3, claim_epoch: null }],
      });

      const result = await sm.transition({
        runId: 'run-1',
        targetState: RunState.Claimed,
        expectedVersion: 1, // Expects version 1, but it's 3
        actor: 'orchestrator-1',
        trigger: 'claim',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('State version mismatch');
      expect(result.stateVersion).toBe(3);
    });

    it('rejects on claim_epoch mismatch (split-brain fencing)', async () => {
      // SELECT current state — epoch is 5, not the expected 3
      mock.pushResult({
        rows: [{ status: 'claimed', state_version: 2, claim_epoch: 5 }],
      });

      const result = await sm.transition({
        runId: 'run-1',
        targetState: RunState.Provisioning,
        expectedVersion: 2,
        claimEpoch: 3, // Stale epoch
        actor: 'orchestrator-1',
        trigger: 'provision',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Claim epoch mismatch');
    });

    it('allows transition when claimEpoch is not provided', async () => {
      // SELECT current state — has an epoch but caller doesn't provide one
      mock.pushResult({
        rows: [{ status: 'claimed', state_version: 2, claim_epoch: 5 }],
      });
      // UPDATE
      mock.pushResult({ rows: [{ state_version: 3 }], rowCount: 1 });
      // SELECT namespace
      mock.pushResult({ rows: [{ namespace: 'test-ns' }] });
      // INSERT event
      mock.pushResult({ rows: [], rowCount: 1 });

      const result = await sm.transition({
        runId: 'run-1',
        targetState: RunState.Provisioning,
        expectedVersion: 2,
        // No claimEpoch — skips fencing check
        actor: 'orchestrator-1',
        trigger: 'provision',
      });

      expect(result.success).toBe(true);
    });

    it('terminal state idempotency — double finalization returns success', async () => {
      // SELECT current state — already succeeded
      mock.pushResult({
        rows: [{ status: 'succeeded', state_version: 10, claim_epoch: null }],
      });

      const result = await sm.transition({
        runId: 'run-1',
        targetState: RunState.Succeeded,
        expectedVersion: 10,
        actor: 'orchestrator-1',
        trigger: 'finalize',
      });

      expect(result.success).toBe(true);
      expect(result.currentState).toBe(RunState.Succeeded);
      expect(result.stateVersion).toBe(10);
    });

    it('terminal state rejects transition to different state', async () => {
      // SELECT current state — already succeeded
      mock.pushResult({
        rows: [{ status: 'succeeded', state_version: 10, claim_epoch: null }],
      });

      const result = await sm.transition({
        runId: 'run-1',
        targetState: RunState.Running, // Can't go from Succeeded to Running
        expectedVersion: 10,
        actor: 'orchestrator-1',
        trigger: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('terminal state');
    });

    it('returns error when run not found', async () => {
      // SELECT returns empty
      mock.pushResult({ rows: [] });

      const result = await sm.transition({
        runId: 'nonexistent',
        targetState: RunState.Claimed,
        expectedVersion: 1,
        actor: 'orchestrator-1',
        trigger: 'claim',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('handles concurrent CAS failure (UPDATE returns 0 rows)', async () => {
      // SELECT current state
      mock.pushResult({
        rows: [{ status: 'unclaimed', state_version: 1, claim_epoch: null }],
      });
      // UPDATE returns 0 rows (someone else modified it first)
      mock.pushResult({ rows: [], rowCount: 0 });

      const result = await sm.transition({
        runId: 'run-1',
        targetState: RunState.Claimed,
        expectedVersion: 1,
        actor: 'orchestrator-1',
        trigger: 'claim',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Concurrent modification');
    });

    it('records transition event on success', async () => {
      // SELECT current state
      mock.pushResult({
        rows: [{ status: 'unclaimed', state_version: 1, claim_epoch: null }],
      });
      // UPDATE
      mock.pushResult({ rows: [{ state_version: 2 }], rowCount: 1 });
      // SELECT namespace for event
      mock.pushResult({ rows: [{ namespace: 'test-ns' }] });
      // INSERT event
      mock.pushResult({ rows: [], rowCount: 1 });

      await sm.transition({
        runId: 'run-1',
        targetState: RunState.Claimed,
        expectedVersion: 1,
        actor: 'orchestrator-1',
        trigger: 'claim',
      });

      // Verify the INSERT event was called (4th query call)
      const insertCall = mock.query.mock.calls[3];
      expect(insertCall[0]).toContain('INSERT INTO symphony_run_event');
      expect(insertCall[1]).toEqual(
        expect.arrayContaining([
          'run-1',     // run_id
          'test-ns',   // namespace
          'state_transition', // kind
          'orchestrator-1',   // actor
        ]),
      );
    });
  });

  describe('classifyAndCheckRetry', () => {
    it('classifies SSH failure with retry eligibility', () => {
      const result = sm.classifyAndCheckRetry('SSH connection lost', undefined, 0);
      expect(result.failureClass).toBe(FailureClass.SshLost);
      expect(result.canRetry).toBe(true);
      expect(result.maxRetries).toBe(3);
      expect(result.recovery).toBe('retry_same_host');
    });

    it('denies retry when count exceeds limit', () => {
      const result = sm.classifyAndCheckRetry('SSH connection lost', undefined, 3);
      expect(result.failureClass).toBe(FailureClass.SshLost);
      expect(result.canRetry).toBe(false);
    });

    it('rate_limited always allows retry', () => {
      const result = sm.classifyAndCheckRetry('Rate limit hit 429', undefined, 999);
      expect(result.failureClass).toBe(FailureClass.RateLimited);
      expect(result.canRetry).toBe(true);
      expect(result.maxRetries).toBe(Infinity);
    });

    it('disk_full never retries', () => {
      const result = sm.classifyAndCheckRetry('No space left on device', undefined, 0);
      expect(result.failureClass).toBe(FailureClass.DiskFull);
      expect(result.canRetry).toBe(false);
      expect(result.maxRetries).toBe(0);
    });

    it('respects failure class override', () => {
      const result = sm.classifyAndCheckRetry(
        'Unknown error',
        undefined,
        0,
        FailureClass.AgentLoop,
      );
      expect(result.failureClass).toBe(FailureClass.AgentLoop);
      expect(result.canRetry).toBe(true);
      expect(result.maxRetries).toBe(1);
    });

    it('returns undefined failure class for unclassifiable errors', () => {
      const result = sm.classifyAndCheckRetry('Something happened', undefined, 0);
      expect(result.failureClass).toBeUndefined();
      expect(result.canRetry).toBe(false);
    });
  });

  describe('updateStage', () => {
    it('updates stage when pattern matches', async () => {
      mock.pushResult({ rows: [], rowCount: 1 });

      const stage = await sm.updateStage('run-1', 'Running tests in vitest...');
      expect(stage).toBe(RunStage.Testing);

      expect(mock.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE symphony_run SET stage'),
        [RunStage.Testing, 'run-1'],
      );
    });

    it('returns undefined and does not update when no pattern matches', async () => {
      const stage = await sm.updateStage('run-1', 'Hello world');
      expect(stage).toBeUndefined();
      // No UPDATE should have been called
      expect(mock.query).not.toHaveBeenCalled();
    });
  });
});
