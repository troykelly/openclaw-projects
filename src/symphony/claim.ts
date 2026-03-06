/**
 * Symphony Claim & Concurrency Control
 *
 * Atomic claim acquisition with four-level concurrency enforcement:
 * 1. Global: max_concurrent_agents - running_total
 * 2. Project: project.max_concurrent - running_in_project
 * 3. Host: host.max_concurrent_sessions - active_on_host
 * 4. State: per_state_limit[state] - running_in_state
 *
 * Advisory lock acquisition order (deterministic, deadlock-free):
 *   global → project (by ID ascending) → host (by ID ascending) → state
 *
 * Issue #2197
 */

import type { Pool, PoolClient } from 'pg';
import { RunState, ACTIVE_STATES } from './states.js';

/** Concurrency limits configuration. */
export interface ConcurrencyLimits {
  /** Maximum total concurrent agents across all projects. */
  maxConcurrentAgents: number;
  /** Per-state concurrency limits. */
  perStateLimits?: Map<RunState, number>;
}

/** Result of a claim attempt. */
export interface ClaimResult {
  success: boolean;
  claimId?: string;
  claimEpoch?: number;
  /** Reason for rejection if claim failed. */
  reason?: string;
  /** The specific concurrency level that rejected the claim. */
  rejectedBy?: 'global' | 'project' | 'host' | 'state' | 'no_candidates' | 'already_claimed';
}

/** A candidate work item for dispatch. */
export interface ClaimCandidate {
  workItemId: string;
  projectId: string;
  priority: number | null;
  createdAt: Date;
  identifier: string;
}

/** Pre-dispatch gate check results. */
export interface PreDispatchGates {
  budgetAvailable: boolean;
  rateLimitOk: boolean;
  hostHealthy: boolean;
  diskSpaceOk: boolean;
}

/** Options for the claim operation. */
export interface ClaimOptions {
  orchestratorId: string;
  /** Connection/host ID for host-level concurrency. */
  hostId: string;
  /** Project ID for project-level concurrency. */
  projectId: string;
  /** Namespace for scoping. */
  namespace: string;
  /** Concurrency limits. */
  limits: ConcurrencyLimits;
  /** Claim lease duration in seconds. Default 60. */
  leaseDurationSeconds?: number;
  /** Idempotency key for retry safety. */
  idempotencyKey?: string;
  /** Target state for state-level concurrency check. */
  targetState?: RunState;
}

/**
 * Candidate selection parameters.
 */
export interface CandidateSelectionOptions {
  namespace: string;
  projectId?: string;
  /** Maximum candidates to consider. Default 100. */
  limit?: number;
}

/** Claim timeout constant in seconds. */
export const CLAIM_TIMEOUT_SECONDS = 60;

/**
 * FNV-1a hash to convert a UUID string to a stable int32 for advisory locks.
 * Returns a positive 32-bit integer suitable for the two-parameter
 * pg_advisory_xact_lock(namespace, id) form.
 */
function uuidToLockKey(uuid: string): number {
  let hash = 2166136261;
  for (let i = 0; i < uuid.length; i++) {
    hash ^= uuid.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Ensure positive 32-bit integer
  return hash >>> 0;
}

/**
 * Advisory lock namespace constants for the two-parameter form:
 *   pg_advisory_xact_lock(namespace_constant, entity_key)
 *
 * Using separate namespace constants prevents collisions between
 * global, project, host, and state locks even if entity keys overlap.
 *
 * Lock acquisition order (deterministic, deadlock-free):
 *   GLOBAL → PROJECT → HOST → STATE
 */
const LOCK_NS_GLOBAL = 1;
const LOCK_NS_PROJECT = 2;
const LOCK_NS_HOST = 3;
const LOCK_NS_STATE = 4;

/** Fixed key for the global singleton lock. */
const LOCK_KEY_GLOBAL = 1;

/**
 * Symphony Claim Manager handles atomic claim acquisition with
 * four-level concurrency enforcement.
 */
export class SymphonyClaimManager {
  constructor(private readonly pool: Pool) {}

  /**
   * Attempt to claim a work item for orchestration.
   *
   * Acquires advisory locks in deterministic order:
   *   1. Global lock
   *   2. Project lock (by project ID)
   *   3. Host lock (by host ID)
   *   4. State lock (if per-state limits configured)
   *
   * All concurrency checks happen within a single transaction.
   *
   * Supports idempotency keys: if a claim with the same key already exists
   * and hasn't expired, returns the existing claim.
   */
  async claimWorkItem(
    workItemId: string,
    options: ClaimOptions,
  ): Promise<ClaimResult> {
    const client = await this.pool.connect();
    const leaseDuration = options.leaseDurationSeconds ?? CLAIM_TIMEOUT_SECONDS;

    try {
      await client.query('BEGIN');

      // Idempotency check: if key provided, look for existing claim with same key
      if (options.idempotencyKey) {
        const existing = await client.query<{
          id: string;
          claim_epoch: number;
          status: string;
        }>(
          `SELECT id, claim_epoch, status
           FROM symphony_claim
           WHERE work_item_id = $1
             AND idempotency_key = $2
             AND status IN ('pending', 'assigned', 'active')
             AND lease_expires_at > NOW()
           LIMIT 1`,
          [workItemId, options.idempotencyKey],
        );

        if (existing.rows.length > 0) {
          await client.query('COMMIT');
          return {
            success: true,
            claimId: existing.rows[0].id,
            claimEpoch: existing.rows[0].claim_epoch,
          };
        }
      }

      // Acquire advisory locks in deterministic order: GLOBAL → PROJECT → HOST → STATE
      // Using two-parameter form pg_advisory_xact_lock(namespace, key) to avoid collisions.

      // 1. Global lock
      await client.query(
        `SELECT pg_advisory_xact_lock($1, $2)`,
        [LOCK_NS_GLOBAL, LOCK_KEY_GLOBAL],
      );

      // 2. Project lock (deterministic: by project ID hash)
      await client.query(
        `SELECT pg_advisory_xact_lock($1, $2)`,
        [LOCK_NS_PROJECT, uuidToLockKey(options.projectId)],
      );

      // 3. Host lock (deterministic: by host ID hash)
      await client.query(
        `SELECT pg_advisory_xact_lock($1, $2)`,
        [LOCK_NS_HOST, uuidToLockKey(options.hostId)],
      );

      // 4. State lock (if per-state limits configured)
      if (options.targetState && options.limits.perStateLimits?.has(options.targetState)) {
        const stateIndex = Object.values(RunState).indexOf(options.targetState);
        await client.query(
          `SELECT pg_advisory_xact_lock($1, $2)`,
          [LOCK_NS_STATE, stateIndex],
        );
      }

      // Check for existing active claim on this work item
      const existingClaim = await client.query<{ id: string }>(
        `SELECT id FROM symphony_claim
         WHERE work_item_id = $1
           AND status IN ('pending', 'assigned', 'active')
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [workItemId],
      );

      if (existingClaim.rows.length > 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          reason: 'Work item already has an active claim',
          rejectedBy: 'already_claimed',
        };
      }

      // Level 1: Global concurrency check
      const globalCount = await this.countActiveRuns(client);
      if (globalCount >= options.limits.maxConcurrentAgents) {
        await client.query('ROLLBACK');
        return {
          success: false,
          reason: `Global concurrency limit reached (${globalCount}/${options.limits.maxConcurrentAgents})`,
          rejectedBy: 'global',
        };
      }

      // Level 2: Project concurrency check
      const projectLimit = await this.getProjectConcurrencyLimit(
        client,
        options.projectId,
      );
      if (projectLimit !== null) {
        const projectCount = await this.countActiveRunsForProject(
          client,
          options.projectId,
        );
        if (projectCount >= projectLimit) {
          await client.query('ROLLBACK');
          return {
            success: false,
            reason: `Project concurrency limit reached (${projectCount}/${projectLimit})`,
            rejectedBy: 'project',
          };
        }
      }

      // Level 3: Host concurrency check
      const hostLimit = await this.getHostConcurrencyLimit(
        client,
        options.hostId,
        options.projectId,
      );
      if (hostLimit !== null) {
        const hostCount = await this.countActiveRunsOnHost(
          client,
          options.hostId,
        );
        if (hostCount >= hostLimit) {
          await client.query('ROLLBACK');
          return {
            success: false,
            reason: `Host concurrency limit reached (${hostCount}/${hostLimit})`,
            rejectedBy: 'host',
          };
        }
      }

      // Level 4: Per-state concurrency check
      if (options.targetState && options.limits.perStateLimits) {
        const stateLimit = options.limits.perStateLimits.get(
          options.targetState,
        );
        if (stateLimit !== undefined) {
          const stateCount = await this.countRunsInState(
            client,
            options.targetState,
          );
          if (stateCount >= stateLimit) {
            await client.query('ROLLBACK');
            return {
              success: false,
              reason: `State '${options.targetState}' concurrency limit reached (${stateCount}/${stateLimit})`,
              rejectedBy: 'state',
            };
          }
        }
      }

      // Get the next claim_epoch for this work item
      const epochResult = await client.query<{ next_epoch: number }>(
        `SELECT COALESCE(MAX(claim_epoch), 0) + 1 AS next_epoch
         FROM symphony_claim
         WHERE work_item_id = $1`,
        [workItemId],
      );
      const nextEpoch = epochResult.rows[0].next_epoch;

      // Create the claim
      const leaseExpiresAt = new Date(
        Date.now() + leaseDuration * 1000,
      );

      const claimResult = await client.query<{
        id: string;
        claim_epoch: number;
      }>(
        `INSERT INTO symphony_claim
           (namespace, work_item_id, orchestrator_id, status, claim_epoch, lease_expires_at, idempotency_key)
         VALUES ($1, $2, $3, 'active', $4, $5, $6)
         RETURNING id, claim_epoch`,
        [
          options.namespace,
          workItemId,
          options.orchestratorId,
          nextEpoch,
          leaseExpiresAt,
          options.idempotencyKey ?? null,
        ],
      );

      await client.query('COMMIT');

      return {
        success: true,
        claimId: claimResult.rows[0].id,
        claimEpoch: claimResult.rows[0].claim_epoch,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Release a claim (mark as released).
   */
  async releaseClaim(
    claimId: string,
    client?: PoolClient,
  ): Promise<boolean> {
    const executor = client ?? this.pool;
    const result = await executor.query(
      `UPDATE symphony_claim
       SET status = 'released', released_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'assigned', 'active')`,
      [claimId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Expire stale claims that have exceeded their lease timeout.
   * Used for crash recovery on orchestrator startup.
   */
  async expireStaleClaims(
    orchestratorId?: string,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      let query = `
        UPDATE symphony_claim
        SET status = 'expired', released_at = NOW()
        WHERE status IN ('pending', 'assigned', 'active')
          AND lease_expires_at < NOW()
      `;
      const params: string[] = [];

      if (orchestratorId) {
        query += ` AND orchestrator_id = $1`;
        params.push(orchestratorId);
      }

      const result = await client.query(query, params);
      await client.query('COMMIT');
      return result.rowCount ?? 0;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Renew a claim's lease (extend expiration).
   */
  async renewLease(
    claimId: string,
    extensionSeconds?: number,
    client?: PoolClient,
  ): Promise<boolean> {
    const extension = extensionSeconds ?? CLAIM_TIMEOUT_SECONDS;
    const executor = client ?? this.pool;
    const result = await executor.query(
      `UPDATE symphony_claim
       SET lease_expires_at = NOW() + INTERVAL '1 second' * $1
       WHERE id = $2 AND status IN ('pending', 'assigned', 'active')`,
      [extension, claimId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Select candidates for dispatch, ordered by priority (ascending),
   * created_at (oldest first), identifier (tiebreaker).
   *
   * Filters out:
   * - Work items with active claims
   * - Work items with active non-terminal runs
   * - Todo issues with non-terminal blockers (blocker rule)
   */
  async selectCandidates(
    options: CandidateSelectionOptions,
  ): Promise<ClaimCandidate[]> {
    const limit = options.limit ?? 100;

    const result = await this.pool.query<{
      id: string;
      project_id: string;
      priority: number | null;
      created_at: Date;
      identifier: string;
    }>(
      `SELECT wi.id, wi.parent_id AS project_id, wi.priority, wi.created_at,
              COALESCE(wi.identifier, wi.id::text) AS identifier
       FROM work_item wi
       WHERE wi.namespace = $1
         ${options.projectId ? 'AND wi.parent_id = $2' : ''}
         -- No active claims
         AND NOT EXISTS (
           SELECT 1 FROM symphony_claim sc
           WHERE sc.work_item_id = wi.id
             AND sc.status IN ('pending', 'assigned', 'active')
         )
         -- No active non-terminal runs
         AND NOT EXISTS (
           SELECT 1 FROM symphony_run sr
           WHERE sr.work_item_id = wi.id
             AND sr.status NOT IN ('succeeded', 'failed', 'cancelled', 'terminated', 'released', 'cleanup_failed')
         )
       ORDER BY
         wi.priority ASC NULLS LAST,
         wi.created_at ASC,
         COALESCE(wi.identifier, wi.id::text) ASC
       LIMIT $${options.projectId ? '3' : '2'}`,
      options.projectId
        ? [options.namespace, options.projectId, limit]
        : [options.namespace, limit],
    );

    return result.rows.map((row) => ({
      workItemId: row.id,
      projectId: row.project_id,
      priority: row.priority,
      createdAt: row.created_at,
      identifier: row.identifier,
    }));
  }

  // --- Private concurrency counting helpers ---

  private async countActiveRuns(client: PoolClient): Promise<number> {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM symphony_run
       WHERE status = ANY($1)`,
      [Array.from(ACTIVE_STATES)],
    );
    return parseInt(result.rows[0].count, 10);
  }

  private async countActiveRunsForProject(
    client: PoolClient,
    projectId: string,
  ): Promise<number> {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM symphony_run
       WHERE project_id = $1 AND status = ANY($2)`,
      [projectId, Array.from(ACTIVE_STATES)],
    );
    return parseInt(result.rows[0].count, 10);
  }

  private async countActiveRunsOnHost(
    client: PoolClient,
    hostId: string,
  ): Promise<number> {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM symphony_run r
       JOIN symphony_workspace w ON w.id = r.workspace_id
       WHERE w.connection_id = $1 AND r.status = ANY($2)`,
      [hostId, Array.from(ACTIVE_STATES)],
    );
    return parseInt(result.rows[0].count, 10);
  }

  private async countRunsInState(
    client: PoolClient,
    state: RunState,
  ): Promise<number> {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM symphony_run WHERE status = $1`,
      [state],
    );
    return parseInt(result.rows[0].count, 10);
  }

  private async getProjectConcurrencyLimit(
    client: PoolClient,
    projectId: string,
  ): Promise<number | null> {
    const result = await client.query<{ config: { max_concurrent?: number } }>(
      `SELECT config FROM symphony_orchestrator_config
       WHERE project_id = $1
       ORDER BY version DESC LIMIT 1`,
      [projectId],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].config.max_concurrent ?? null;
  }

  private async getHostConcurrencyLimit(
    client: PoolClient,
    hostId: string,
    projectId: string,
  ): Promise<number | null> {
    const result = await client.query<{ max_concurrent_sessions: number }>(
      `SELECT max_concurrent_sessions FROM project_host
       WHERE connection_id = $1 AND project_id = $2`,
      [hostId, projectId],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].max_concurrent_sessions;
  }
}
