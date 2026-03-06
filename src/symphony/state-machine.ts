/**
 * Symphony Orchestrator State Machine Engine
 *
 * Manages run lifecycle transitions with:
 * - Compare-and-swap (CAS) via state_version
 * - claim_epoch fencing for split-brain prevention
 * - Terminal state idempotency
 * - Transition event recording
 *
 * Issue #2196
 */

import type { Pool, PoolClient } from 'pg';
import {
  RunState,
  RunStage,
  FailureClass,
  VALID_TRANSITIONS,
  TERMINAL_STATES,
  STATE_TIMEOUTS,
  FAILURE_RETRY_LIMITS,
  FAILURE_RECOVERY,
  isValidTransition,
  isTerminalState,
  inferStage,
  classifyFailure,
} from './states.js';

/** Result of a state transition attempt. */
export interface TransitionResult {
  success: boolean;
  /** The run's state after the transition (or current state if failed). */
  currentState: RunState;
  /** The state_version after the transition (or current if failed). */
  stateVersion: number;
  /** Error reason if transition failed. */
  error?: string;
}

/** Context for a state transition. */
export interface TransitionContext {
  runId: string;
  targetState: RunState;
  /** Expected state_version for CAS. */
  expectedVersion: number;
  /** Expected claim_epoch for fencing. Null skips fencing check. */
  claimEpoch?: number;
  /** Actor performing the transition (orchestrator ID, user, system). */
  actor: string;
  /** Trigger/reason for the transition. */
  trigger: string;
  /** Optional error message (for failure transitions). */
  errorMessage?: string;
  /** Optional error code for failure classification. */
  errorCode?: string;
  /** Optional failure class override. */
  failureClass?: FailureClass;
  /** Optional advisory stage update. */
  stage?: RunStage;
  /** Additional event payload metadata. */
  metadata?: Record<string, unknown>;
}

/** Snapshot of a run's current state for decision-making. */
export interface RunSnapshot {
  id: string;
  namespace: string;
  workItemId: string;
  projectId: string | null;
  orchestratorId: string | null;
  status: RunState;
  stage: RunStage | null;
  stateVersion: number;
  claimEpoch: number | null;
  attempt: number;
  errorMessage: string | null;
  errorCode: string | null;
  startedAt: Date | null;
  updatedAt: Date;
}

/** Options for the watchdog sweep. */
export interface WatchdogOptions {
  /** Override timeouts per state (seconds). */
  timeoutOverrides?: Map<RunState, number>;
  /** Maximum number of runs to process per sweep. */
  batchSize?: number;
}

/**
 * The Symphony State Machine manages all run state transitions.
 *
 * All transitions are atomic (single UPDATE with CAS) and recorded
 * in symphony_run_event.
 */
export class SymphonyStateMachine {
  constructor(private readonly pool: Pool) {}

  /**
   * Attempt a state transition using compare-and-swap.
   *
   * Returns success if the transition was applied, or an error describing
   * why it was rejected (invalid transition, version mismatch, epoch mismatch).
   *
   * Terminal state transitions are idempotent — double-finalization is a no-op
   * that returns success with the current state.
   */
  async transition(
    ctx: TransitionContext,
    client?: PoolClient,
  ): Promise<TransitionResult> {
    const executor = client ?? this.pool;

    // Fetch current state with FOR UPDATE to serialize concurrent transitions
    const lockResult = await executor.query<{
      status: string;
      state_version: number;
      claim_epoch: number | null;
    }>(
      `SELECT status, state_version, claim_epoch
       FROM symphony_run
       WHERE id = $1
       FOR UPDATE`,
      [ctx.runId],
    );

    if (lockResult.rows.length === 0) {
      return {
        success: false,
        currentState: RunState.Unclaimed,
        stateVersion: 0,
        error: `Run ${ctx.runId} not found`,
      };
    }

    const row = lockResult.rows[0];
    const currentState = row.status as RunState;
    const currentVersion = row.state_version;
    const currentEpoch = row.claim_epoch;

    // Terminal state idempotency: if already in the target terminal state, return success
    if (isTerminalState(currentState) && currentState === ctx.targetState) {
      return {
        success: true,
        currentState,
        stateVersion: currentVersion,
      };
    }

    // If already in a terminal state and trying to move to a different state, reject
    if (isTerminalState(currentState) && currentState !== ctx.targetState) {
      return {
        success: false,
        currentState,
        stateVersion: currentVersion,
        error: `Run is in terminal state '${currentState}', cannot transition to '${ctx.targetState}'`,
      };
    }

    // Validate the transition
    if (!isValidTransition(currentState, ctx.targetState)) {
      return {
        success: false,
        currentState,
        stateVersion: currentVersion,
        error: `Invalid transition from '${currentState}' to '${ctx.targetState}'`,
      };
    }

    // Compare-and-swap: check state_version
    if (currentVersion !== ctx.expectedVersion) {
      return {
        success: false,
        currentState,
        stateVersion: currentVersion,
        error: `State version mismatch: expected ${ctx.expectedVersion}, actual ${currentVersion}`,
      };
    }

    // claim_epoch fencing: if provided, must match
    if (ctx.claimEpoch !== undefined && currentEpoch !== null) {
      if (currentEpoch !== ctx.claimEpoch) {
        return {
          success: false,
          currentState,
          stateVersion: currentVersion,
          error: `Claim epoch mismatch: expected ${ctx.claimEpoch}, actual ${currentEpoch}`,
        };
      }
    }

    // Build the UPDATE
    const newVersion = currentVersion + 1;
    const now = new Date();
    const isCompleting = isTerminalState(ctx.targetState);

    const updateResult = await executor.query<{ state_version: number }>(
      `UPDATE symphony_run
       SET status = $1,
           state_version = $2,
           error_message = COALESCE($3, error_message),
           error_code = COALESCE($4, error_code),
           started_at = CASE WHEN started_at IS NULL AND $1 NOT IN ('unclaimed') THEN $5 ELSE started_at END,
           completed_at = CASE WHEN $6 THEN $5 ELSE completed_at END,
           updated_at = $5
       WHERE id = $7
         AND state_version = $8
       RETURNING state_version`,
      [
        ctx.targetState,
        newVersion,
        ctx.errorMessage ?? null,
        ctx.errorCode ?? null,
        now,
        isCompleting,
        ctx.runId,
        ctx.expectedVersion,
      ],
    );

    if (updateResult.rows.length === 0) {
      // CAS failed — concurrent modification
      return {
        success: false,
        currentState,
        stateVersion: currentVersion,
        error: 'Concurrent modification detected (CAS failed)',
      };
    }

    // Record the transition event
    await this.recordEvent(executor, {
      runId: ctx.runId,
      kind: 'state_transition',
      actor: ctx.actor,
      payload: {
        previous_state: currentState,
        new_state: ctx.targetState,
        trigger: ctx.trigger,
        state_version: newVersion,
        claim_epoch: ctx.claimEpoch ?? null,
        error_message: ctx.errorMessage ?? null,
        error_code: ctx.errorCode ?? null,
        failure_class: ctx.failureClass ?? null,
        stage: ctx.stage ?? null,
        ...ctx.metadata,
      },
    });

    return {
      success: true,
      currentState: ctx.targetState,
      stateVersion: newVersion,
    };
  }

  /**
   * Get a snapshot of a run's current state.
   */
  async getRunSnapshot(
    runId: string,
    client?: PoolClient,
  ): Promise<RunSnapshot | null> {
    const executor = client ?? this.pool;

    const result = await executor.query<{
      id: string;
      namespace: string;
      work_item_id: string;
      project_id: string | null;
      orchestrator_id: string | null;
      status: string;
      stage: string | null;
      state_version: number;
      claim_epoch: number | null;
      attempt: number;
      error_message: string | null;
      error_code: string | null;
      started_at: Date | null;
      updated_at: Date;
    }>(
      `SELECT r.id, r.namespace, r.work_item_id, r.project_id,
              r.orchestrator_id, r.status, r.stage, r.state_version,
              c.claim_epoch, r.attempt, r.error_message, r.error_code,
              r.started_at, r.updated_at
       FROM symphony_run r
       LEFT JOIN symphony_claim c ON c.id = r.claim_id
       WHERE r.id = $1`,
      [runId],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      namespace: row.namespace,
      workItemId: row.work_item_id,
      projectId: row.project_id,
      orchestratorId: row.orchestrator_id,
      status: row.status as RunState,
      stage: row.stage as RunStage | null,
      stateVersion: row.state_version,
      claimEpoch: row.claim_epoch,
      attempt: row.attempt,
      errorMessage: row.error_message,
      errorCode: row.error_code,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Watchdog sweep: find runs that have exceeded their per-state timeout
   * and transition them to the appropriate recovery state.
   *
   * Uses FOR UPDATE SKIP LOCKED for concurrent orchestrator safety.
   */
  async watchdogSweep(
    orchestratorId: string,
    options?: WatchdogOptions,
  ): Promise<Array<{ runId: string; from: RunState; to: RunState }>> {
    const batchSize = options?.batchSize ?? 50;
    const overrides = options?.timeoutOverrides ?? new Map<RunState, number>();
    const results: Array<{ runId: string; from: RunState; to: RunState }> = [];

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Find timed-out runs across all timeout-bearing states
      const timedOutRuns = await client.query<{
        id: string;
        status: string;
        state_version: number;
        updated_at: Date;
      }>(
        `SELECT id, status, state_version, updated_at
         FROM symphony_run
         WHERE status IN (${Array.from(STATE_TIMEOUTS.keys())
           .map((_, i) => `$${i + 1}`)
           .join(', ')})
           AND completed_at IS NULL
         ORDER BY updated_at ASC
         LIMIT $${STATE_TIMEOUTS.size + 1}
         FOR UPDATE SKIP LOCKED`,
        [...Array.from(STATE_TIMEOUTS.keys()), batchSize],
      );

      const now = Date.now();

      for (const run of timedOutRuns.rows) {
        const state = run.status as RunState;
        const timeout =
          overrides.get(state) ?? STATE_TIMEOUTS.get(state);
        if (!timeout) continue;

        const elapsed = (now - run.updated_at.getTime()) / 1000;
        if (elapsed < timeout) continue;

        // Determine the timeout target state
        const targetState = this.timeoutTargetState(state);
        if (!targetState) continue;

        const result = await this.transition(
          {
            runId: run.id,
            targetState,
            expectedVersion: run.state_version,
            actor: orchestratorId,
            trigger: `timeout:${state}:${Math.round(elapsed)}s`,
            errorMessage: `State '${state}' timed out after ${Math.round(elapsed)}s (limit: ${timeout}s)`,
          },
          client,
        );

        if (result.success) {
          results.push({ runId: run.id, from: state, to: targetState });
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return results;
  }

  /**
   * Classify a failure and check retry eligibility.
   */
  classifyAndCheckRetry(
    errorMessage: string,
    errorCode: string | undefined,
    currentRetryCount: number,
    failureClassOverride?: FailureClass,
  ): {
    failureClass: FailureClass | undefined;
    canRetry: boolean;
    maxRetries: number;
    recovery: string | undefined;
  } {
    const fc =
      failureClassOverride ?? classifyFailure(errorMessage, errorCode);

    if (!fc) {
      return {
        failureClass: undefined,
        canRetry: false,
        maxRetries: 0,
        recovery: undefined,
      };
    }

    const maxRetries = FAILURE_RETRY_LIMITS.get(fc) ?? 0;
    const canRetry = currentRetryCount < maxRetries;
    const recovery = FAILURE_RECOVERY.get(fc);

    return { failureClass: fc, canRetry, maxRetries, recovery };
  }

  /**
   * Update the advisory stage on a run without changing its state.
   * This is a non-CAS update since stages never drive transitions.
   */
  async updateStage(
    runId: string,
    output: string,
    client?: PoolClient,
  ): Promise<RunStage | undefined> {
    const stage = inferStage(output);
    if (!stage) return undefined;

    const executor = client ?? this.pool;
    await executor.query(
      `UPDATE symphony_run SET stage = $1, updated_at = NOW() WHERE id = $2`,
      [stage, runId],
    );

    return stage;
  }

  /**
   * Record an event in the symphony_run_event hypertable.
   */
  private async recordEvent(
    executor: Pool | PoolClient,
    event: {
      runId: string;
      kind: string;
      actor: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    // Get the namespace from the run
    const nsResult = await executor.query<{ namespace: string }>(
      `SELECT namespace FROM symphony_run WHERE id = $1`,
      [event.runId],
    );

    const namespace = nsResult.rows[0]?.namespace ?? 'unknown';

    await executor.query(
      `INSERT INTO symphony_run_event (run_id, namespace, kind, actor, payload, emitted_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [event.runId, namespace, event.kind, event.actor, JSON.stringify(event.payload)],
    );
  }

  /**
   * Determine the target state when a timeout is detected.
   */
  private timeoutTargetState(state: RunState): RunState | undefined {
    switch (state) {
      case RunState.Claimed:
        return RunState.Orphaned;
      case RunState.Provisioning:
        return RunState.Failed;
      case RunState.Prompting:
        return RunState.Failed;
      case RunState.Running:
        return RunState.Stalled;
      case RunState.VerifyingResult:
        return RunState.Failed;
      case RunState.MergePending:
        return RunState.Failed;
      case RunState.PostMergeVerify:
        return RunState.Failed;
      case RunState.IssueClosing:
        return RunState.Failed;
      case RunState.AwaitingApproval:
        return RunState.Paused;
      case RunState.Terminating:
        return RunState.CleanupFailed;
      default:
        return undefined;
    }
  }
}
