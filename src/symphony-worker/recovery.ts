/**
 * Startup recovery sweep for orphaned symphony runs.
 * Issue #2195 — Symphony Worker Process Skeleton.
 *
 * On startup, the orchestrator:
 * 1. Finds stale orchestrators (heartbeat expired)
 * 2. Transitions their orphaned runs to recovery states:
 *    - claimed/provisioning/prompting -> failed (early stages)
 *    - running/verifying_result/merge_pending/etc -> stalled (active stages)
 *    - paused -> orphaned
 * 3. Removes stale heartbeat entries
 */

import type { Pool } from 'pg';
import { findStaleOrchestrators, removeHeartbeat } from './heartbeat.ts';
import { symphonyRecoveryTotal } from './metrics.ts';
import { RunState, TERMINAL_STATES } from '../symphony/states.ts';

/** Recovery result for a single run. */
export interface RecoveryResult {
  runId: string;
  previousStatus: string;
  newStatus: string;
}

/**
 * Status transition map for recovery.
 * Maps current non-terminal status to the recovery target status.
 * Uses the 22-state model from migration 148.
 */
const RECOVERY_TRANSITIONS: Record<string, string> = {
  [RunState.Claimed]: RunState.Failed,
  [RunState.Provisioning]: RunState.Failed,
  [RunState.Prompting]: RunState.Failed,
  [RunState.Running]: RunState.Stalled,
  [RunState.AwaitingApproval]: RunState.Stalled,
  [RunState.VerifyingResult]: RunState.Stalled,
  [RunState.MergePending]: RunState.Stalled,
  [RunState.PostMergeVerify]: RunState.Stalled,
  [RunState.IssueClosing]: RunState.Stalled,
  [RunState.ContinuationWait]: RunState.Stalled,
  [RunState.Paused]: RunState.Orphaned,
  [RunState.Terminating]: RunState.Terminated,
  [RunState.RetryQueued]: RunState.Failed,
};

/**
 * Recover orphaned runs from a specific stale orchestrator.
 * Transitions non-terminal runs to appropriate recovery states.
 */
export async function recoverOrphanedRuns(
  pool: Pool,
  namespace: string,
  staleOrchestratorId: string,
): Promise<RecoveryResult[]> {
  const results: RecoveryResult[] = [];

  // Find all non-terminal runs owned by the stale orchestrator
  const terminalArr = [...TERMINAL_STATES];
  const terminalParams = terminalArr.map((_, i) => `$${i + 3}`).join(', ');
  const orphanedRuns = await pool.query<{
    id: string;
    status: string;
  }>(
    `SELECT id, status
     FROM symphony_run
     WHERE namespace = $1
       AND orchestrator_id = $2
       AND status NOT IN (${terminalParams})`,
    [namespace, staleOrchestratorId, ...terminalArr],
  );

  for (const run of orphanedRuns.rows) {
    const newStatus = RECOVERY_TRANSITIONS[run.status];
    if (!newStatus) {
      // Unexpected status — skip but log
      console.warn(
        `[SymphonyRecovery] Run ${run.id} has unexpected status '${run.status}', skipping`,
      );
      continue;
    }

    await pool.query(
      `UPDATE symphony_run
       SET status = $1,
           error_message = $2,
           completed_at = NOW()
       WHERE id = $3
         AND status = $4`,
      [
        newStatus,
        `Recovered: orchestrator '${staleOrchestratorId}' became stale`,
        run.id,
        run.status,
      ],
    );

    // Release any active claims for recovered runs
    await pool.query(
      `UPDATE symphony_claim
       SET status = 'released',
           released_at = NOW()
       WHERE orchestrator_id = $1
         AND status IN ('pending', 'assigned', 'active')`,
      [staleOrchestratorId],
    );

    results.push({
      runId: run.id,
      previousStatus: run.status,
      newStatus,
    });

    symphonyRecoveryTotal.inc();
  }

  return results;
}

/**
 * Full recovery sweep: find all stale orchestrators, recover their runs,
 * and clean up their heartbeat entries.
 */
export async function recoverySweep(
  pool: Pool,
  namespace: string,
  staleThresholdMs?: number,
): Promise<RecoveryResult[]> {
  const staleIds = await findStaleOrchestrators(pool, namespace, staleThresholdMs);

  if (staleIds.length === 0) {
    console.log('[SymphonyRecovery] No stale orchestrators found');
    return [];
  }

  console.log(`[SymphonyRecovery] Found ${staleIds.length} stale orchestrator(s): ${staleIds.join(', ')}`);

  const allResults: RecoveryResult[] = [];

  for (const staleId of staleIds) {
    const results = await recoverOrphanedRuns(pool, namespace, staleId);
    allResults.push(...results);

    // Clean up stale heartbeat entry
    await removeHeartbeat(pool, staleId);
    console.log(
      `[SymphonyRecovery] Recovered ${results.length} run(s) from orchestrator '${staleId}'`,
    );
  }

  console.log(`[SymphonyRecovery] Sweep complete: ${allResults.length} total run(s) recovered`);
  return allResults;
}
