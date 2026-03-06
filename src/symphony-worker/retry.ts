/**
 * Retry, Backoff & Self-Healing.
 * Issue #2201 — Retry, Backoff & Self-Healing.
 *
 * Provides:
 * - Exponential backoff with jitter for retries
 * - Continuation wait backoff with progress gating
 * - Per-failure-class retry limits
 * - Budget enforcement (per-run, per-project, global)
 * - Circuit breaker pattern for hosts, GitHub rate limits, credentials
 * - Advisory lock for recovery sweep (X9)
 * - Config version snapshotting
 * - Disk monitoring threshold
 * - Issue edit detection
 */

import type { Pool, PoolClient } from 'pg';
import {
  FailureClass,
  FAILURE_RETRY_LIMITS,
  FAILURE_RECOVERY,
} from '../symphony/states.js';
import type { RecoveryStrategy } from '../symphony/states.js';

// ─── Retry Backoff ───

/**
 * Calculate retry delay with exponential backoff and jitter.
 * Formula: min(base * 2^(attempt-1), max) * (0.5 + random(0.5))
 *
 * @param attempt     Current attempt number (1-based).
 * @param baseMs      Base delay in milliseconds. Default: 10000 (10s).
 * @param maxMs       Maximum delay in milliseconds. Default: 300000 (5min).
 * @param randomFn    Random number generator (0..1) for testing. Default: Math.random.
 * @returns Delay in milliseconds.
 */
export function calculateRetryDelay(
  attempt: number,
  baseMs: number = 10_000,
  maxMs: number = 300_000,
  randomFn: () => number = Math.random,
): number {
  if (attempt < 1) return baseMs;
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, maxMs);
  const raw = randomFn();
  const clamped = Math.max(0, Math.min(1, raw));
  const jitter = 0.5 + clamped * 0.5;
  return Math.floor(capped * jitter);
}

// ─── Continuation Wait Backoff ───

/**
 * Calculate continuation wait delay with exponential backoff.
 * Formula: min(base * 2^(continuationCount-1), max)
 *
 * @param continuationCount Number of continuations so far (1-based).
 * @param baseMs            Base wait in milliseconds. Default: 30000 (30s).
 * @param maxMs             Maximum wait in milliseconds. Default: 1800000 (30min).
 * @returns Delay in milliseconds.
 */
export function calculateContinuationWait(
  continuationCount: number,
  baseMs: number = 30_000,
  maxMs: number = 1_800_000,
): number {
  if (continuationCount < 1) return baseMs;
  const exponential = baseMs * Math.pow(2, continuationCount - 1);
  return Math.min(exponential, maxMs);
}

/** Maximum continuations without progress before pausing. */
export const MAX_CONTINUATIONS_WITHOUT_PROGRESS = 3;

/**
 * Determine if a run should be paused due to no progress after continuations.
 *
 * @param continuationCount  Total continuations in this run.
 * @param lastProgressAt     Timestamp of last meaningful progress (commit, comment, status change).
 * @param continuationsSinceProgress Continuations since last progress signal.
 * @returns True if the run should be paused.
 */
export function shouldPauseForNoProgress(
  continuationsSinceProgress: number,
): boolean {
  return continuationsSinceProgress >= MAX_CONTINUATIONS_WITHOUT_PROGRESS;
}

// ─── Retry Eligibility ───

/**
 * Check if a failure class allows retry and get the recovery strategy.
 */
export function checkRetryEligibility(
  failureClass: FailureClass,
  currentAttempt: number,
): {
  canRetry: boolean;
  maxRetries: number;
  recovery: RecoveryStrategy | undefined;
  delay: number;
} {
  const maxRetries = FAILURE_RETRY_LIMITS.get(failureClass) ?? 0;
  const canRetry = currentAttempt < maxRetries;
  const recovery = FAILURE_RECOVERY.get(failureClass);
  const delay = canRetry ? calculateRetryDelay(currentAttempt + 1) : 0;

  return { canRetry, maxRetries, recovery, delay };
}

// ─── Budget Enforcement ───

/** Budget limits configuration. */
export interface BudgetLimits {
  /** Maximum tokens per run. 0 = unlimited. */
  perRunTokenLimit: number;
  /** Maximum tokens per project per day. 0 = unlimited. */
  perProjectDailyBudget: number;
  /** Global spending circuit breaker threshold (tokens/day). 0 = unlimited. */
  globalDailyBudget: number;
}

/** Budget check result. */
export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  level?: 'per_run' | 'per_project' | 'global';
  currentUsage?: number;
  limit?: number;
}

/** Default budget limits (all unlimited). */
export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  perRunTokenLimit: 0,
  perProjectDailyBudget: 0,
  globalDailyBudget: 0,
};

/**
 * Check budget at all three levels before dispatching a run.
 *
 * @param pool         Database pool.
 * @param namespace    Namespace scope.
 * @param runId        The run to check.
 * @param projectId    The project the run belongs to.
 * @param limits       Budget limits configuration.
 * @param estimatedTokens Estimated token consumption for this run.
 * @returns Budget check result.
 */
export async function checkBudget(
  pool: Pool,
  namespace: string,
  runId: string,
  projectId: string,
  limits: BudgetLimits,
  estimatedTokens: number,
): Promise<BudgetCheckResult> {
  // Level 1: Per-run token limit
  if (limits.perRunTokenLimit > 0) {
    const runUsage = await getRunTokenUsage(pool, runId);
    if (runUsage + estimatedTokens > limits.perRunTokenLimit) {
      return {
        allowed: false,
        reason: `Per-run token limit exceeded (${runUsage}/${limits.perRunTokenLimit})`,
        level: 'per_run',
        currentUsage: runUsage,
        limit: limits.perRunTokenLimit,
      };
    }
  }

  // Level 2: Per-project daily budget
  if (limits.perProjectDailyBudget > 0) {
    const projectUsage = await getProjectDailyTokenUsage(pool, namespace, projectId);
    if (projectUsage + estimatedTokens > limits.perProjectDailyBudget) {
      return {
        allowed: false,
        reason: `Per-project daily budget exceeded (${projectUsage}/${limits.perProjectDailyBudget})`,
        level: 'per_project',
        currentUsage: projectUsage,
        limit: limits.perProjectDailyBudget,
      };
    }
  }

  // Level 3: Global daily budget
  if (limits.globalDailyBudget > 0) {
    const globalUsage = await getGlobalDailyTokenUsage(pool, namespace);
    if (globalUsage + estimatedTokens > limits.globalDailyBudget) {
      return {
        allowed: false,
        reason: `Global daily budget exceeded (${globalUsage}/${limits.globalDailyBudget})`,
        level: 'global',
        currentUsage: globalUsage,
        limit: limits.globalDailyBudget,
      };
    }
  }

  return { allowed: true };
}

/**
 * Get token usage for a specific run from run events.
 */
async function getRunTokenUsage(pool: Pool, runId: string): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM((payload->>'tokens_used')::bigint), 0) AS total
     FROM symphony_run_event
     WHERE run_id = $1
       AND kind = 'token_usage'`,
    [runId],
  );
  return parseInt(result.rows[0].total, 10);
}

/**
 * Get today's token usage for a project across all runs.
 */
async function getProjectDailyTokenUsage(
  pool: Pool,
  namespace: string,
  projectId: string,
): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM((e.payload->>'tokens_used')::bigint), 0) AS total
     FROM symphony_run_event e
     JOIN symphony_run r ON r.id = e.run_id
     WHERE r.namespace = $1
       AND r.project_id = $2
       AND e.kind = 'token_usage'
       AND e.emitted_at >= CURRENT_DATE`,
    [namespace, projectId],
  );
  return parseInt(result.rows[0].total, 10);
}

/**
 * Get today's total token usage across all runs in a namespace.
 */
async function getGlobalDailyTokenUsage(
  pool: Pool,
  namespace: string,
): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM((e.payload->>'tokens_used')::bigint), 0) AS total
     FROM symphony_run_event e
     JOIN symphony_run r ON r.id = e.run_id
     WHERE r.namespace = $1
       AND e.kind = 'token_usage'
       AND e.emitted_at >= CURRENT_DATE`,
    [namespace],
  );
  return parseInt(result.rows[0].total, 10);
}

/**
 * Estimate token usage for a run based on historical averages.
 */
export async function estimateTokenUsage(
  pool: Pool,
  namespace: string,
  projectId: string,
): Promise<number> {
  const result = await pool.query<{ avg_tokens: string }>(
    `SELECT COALESCE(AVG((e.payload->>'tokens_used')::bigint), 50000) AS avg_tokens
     FROM symphony_run_event e
     JOIN symphony_run r ON r.id = e.run_id
     WHERE r.namespace = $1
       AND r.project_id = $2
       AND e.kind = 'token_usage'
       AND e.emitted_at >= NOW() - INTERVAL '7 days'`,
    [namespace, projectId],
  );
  return parseInt(result.rows[0].avg_tokens, 10);
}

// ─── Circuit Breaker ───

/** Circuit breaker states. */
export enum CircuitState {
  Closed = 'closed',
  Open = 'open',
  HalfOpen = 'half_open',
}

/** Circuit breaker configuration. */
export interface CircuitBreakerConfig {
  /** Identifier for this breaker (e.g., host ID, 'github_rate'). */
  breakerId: string;
  /** Number of failures to open the circuit. */
  failureThreshold: number;
  /** Time in ms before attempting a probe (half-open). */
  recoveryTimeoutMs: number;
  /** Number of consecutive successes in half-open to close circuit. */
  successThreshold: number;
}

/** Persisted circuit breaker state. */
export interface CircuitBreakerState {
  breakerId: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  lastTransitionAt: Date;
}

/**
 * Circuit breaker for host/resource health tracking.
 * State is persisted to the database for crash recovery (per issue requirement).
 */
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitState = CircuitState.Closed;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private lastTransitionAt: Date = new Date();
  /** Prevents thundering-herd: only one probe at a time in half-open. */
  private probeInFlight = false;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  /** Get the current circuit state. */
  getState(): CircuitState {
    return this.state;
  }

  /** Get the full breaker state for persistence. */
  getFullState(): CircuitBreakerState {
    return {
      breakerId: this.config.breakerId,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      lastTransitionAt: this.lastTransitionAt,
    };
  }

  /** Restore state from persisted data. */
  restoreState(persisted: CircuitBreakerState): void {
    this.state = persisted.state;
    this.failureCount = persisted.failureCount;
    this.successCount = persisted.successCount;
    this.lastFailureAt = persisted.lastFailureAt;
    this.lastSuccessAt = persisted.lastSuccessAt;
    this.lastTransitionAt = persisted.lastTransitionAt;
  }

  /**
   * Check if the circuit allows a request.
   * In half-open state, allow the probe request.
   *
   * @param nowMs Current time in ms (for testing). Default: Date.now().
   */
  isAllowed(nowMs: number = Date.now()): boolean {
    switch (this.state) {
      case CircuitState.Closed:
        return true;

      case CircuitState.Open: {
        // Check if recovery timeout has elapsed → transition to half-open
        const elapsed = nowMs - this.lastTransitionAt.getTime();
        if (elapsed >= this.config.recoveryTimeoutMs) {
          this.transitionTo(CircuitState.HalfOpen);
          this.probeInFlight = true; // Gate subsequent probes
          return true; // Allow first probe
        }
        return false;
      }

      case CircuitState.HalfOpen:
        // Only allow a single probe at a time to prevent thundering-herd
        if (this.probeInFlight) return false;
        this.probeInFlight = true;
        return true;

      default:
        return false;
    }
  }

  /**
   * Record a successful operation.
   * In half-open: increment success count, close if threshold reached.
   * In closed: reset failure count.
   */
  recordSuccess(): void {
    this.lastSuccessAt = new Date();

    switch (this.state) {
      case CircuitState.HalfOpen:
        this.probeInFlight = false;
        this.successCount++;
        if (this.successCount >= this.config.successThreshold) {
          this.transitionTo(CircuitState.Closed);
          this.failureCount = 0;
          this.successCount = 0;
        }
        break;

      case CircuitState.Closed:
        // Reset failure counter on success
        this.failureCount = 0;
        this.successCount = 0;
        break;

      default:
        break;
    }
  }

  /**
   * Record a failed operation.
   * In closed: increment failure count, open if threshold reached.
   * In half-open: open immediately (probe failed).
   */
  recordFailure(): void {
    this.lastFailureAt = new Date();

    switch (this.state) {
      case CircuitState.Closed:
        this.failureCount++;
        if (this.failureCount >= this.config.failureThreshold) {
          this.transitionTo(CircuitState.Open);
        }
        break;

      case CircuitState.HalfOpen:
        // Probe failed — back to open
        this.probeInFlight = false;
        this.transitionTo(CircuitState.Open);
        this.successCount = 0;
        break;

      default:
        break;
    }
  }

  private transitionTo(newState: CircuitState): void {
    this.state = newState;
    this.lastTransitionAt = new Date();
  }
}

// ─── Host Circuit Breaker ───

/**
 * Host health status for the circuit breaker.
 */
export interface HostHealthStatus {
  hostId: string;
  state: CircuitState;
  failureCount: number;
  lastProbeAt: Date | null;
  draining: boolean;
}

/**
 * Check host health by performing SSH + disk space probe.
 * Returns true if the host is healthy.
 *
 * @param sshCheck Callback to verify SSH connectivity.
 * @param diskCheck Callback to check disk space (returns free bytes).
 * @param minDiskBytes Minimum disk space threshold. Default: 5GB.
 */
export async function probeHostHealth(
  sshCheck: () => Promise<boolean>,
  diskCheck: () => Promise<number>,
  minDiskBytes: number = 5 * 1024 * 1024 * 1024,
): Promise<{ healthy: boolean; sshOk: boolean; diskOk: boolean; freeBytes: number }> {
  let sshOk = false;
  let diskOk = false;
  let freeBytes = 0;

  try {
    sshOk = await sshCheck();
  } catch {
    sshOk = false;
  }

  if (sshOk) {
    try {
      freeBytes = await diskCheck();
      diskOk = freeBytes >= minDiskBytes;
    } catch {
      diskOk = false;
    }
  }

  return { healthy: sshOk && diskOk, sshOk, diskOk, freeBytes };
}

// ─── GitHub Rate Limit Circuit Breaker ───

/**
 * Check if GitHub API calls should be allowed based on rate limit headers.
 *
 * @param remaining     X-RateLimit-Remaining value.
 * @param resetEpoch    X-RateLimit-Reset Unix epoch.
 * @param reserveQuota  Minimum calls to reserve for critical ops. Default: 100.
 * @param nowMs         Current time in ms (for testing).
 * @returns Object with allowed flag and wait time if rate-limited.
 */
export function checkGitHubRateLimit(
  remaining: number,
  resetEpoch: number,
  reserveQuota: number = 100,
  nowMs: number = Date.now(),
): { allowed: boolean; waitMs: number } {
  if (remaining > reserveQuota) {
    return { allowed: true, waitMs: 0 };
  }

  const resetMs = resetEpoch * 1000;
  const waitMs = Math.max(resetMs - nowMs, 0);

  return { allowed: false, waitMs };
}

// ─── Recovery Sweep Advisory Lock (X9) ───

/** Well-known advisory lock ID for the recovery sweep. */
export const RECOVERY_SWEEP_LOCK_ID = 0x53594D50; // "SYMP" in hex

/**
 * Attempt to acquire the advisory lock for the recovery sweep.
 * Uses pg_try_advisory_lock (non-blocking) — returns immediately.
 *
 * @param client  Database client (must be within a transaction).
 * @returns True if the lock was acquired.
 */
export async function tryAcquireRecoverySweepLock(
  client: PoolClient,
): Promise<boolean> {
  const result = await client.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS acquired`,
    [RECOVERY_SWEEP_LOCK_ID],
  );
  return result.rows[0]?.acquired ?? false;
}

/**
 * Release the recovery sweep advisory lock.
 *
 * @param client  Database client.
 */
export async function releaseRecoverySweepLock(
  client: PoolClient,
): Promise<void> {
  await client.query(`SELECT pg_advisory_unlock($1)`, [RECOVERY_SWEEP_LOCK_ID]);
}

// ─── Config Version Snapshotting ───

/**
 * Snapshot the current config version for an active run.
 * Active runs continue using the snapshotted version until completion.
 * Budget changes apply immediately regardless.
 *
 * @param pool       Database pool.
 * @param runId      The run to snapshot config for.
 * @param configVersion The config version to snapshot.
 */
export async function snapshotConfigVersion(
  pool: Pool,
  runId: string,
  configVersion: number,
): Promise<void> {
  await pool.query(
    `UPDATE symphony_run
     SET config_version = $1
     WHERE id = $2`,
    [configVersion, runId],
  );
}

/**
 * Check if a config change is structural (requiring draining) or just budget.
 *
 * @param oldConfig Previous config object.
 * @param newConfig New config object.
 * @returns Object indicating change types.
 */
export function classifyConfigChange(
  oldConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>,
): { budgetOnly: boolean; structural: boolean; changedKeys: string[] } {
  const budgetKeys = new Set([
    'perRunTokenLimit',
    'perProjectDailyBudget',
    'globalDailyBudget',
    'githubRateLimitReserve',
  ]);

  const changedKeys: string[] = [];
  let structural = false;

  const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);

  for (const key of allKeys) {
    if (JSON.stringify(oldConfig[key]) !== JSON.stringify(newConfig[key])) {
      changedKeys.push(key);
      if (!budgetKeys.has(key)) {
        structural = true;
      }
    }
  }

  return {
    budgetOnly: changedKeys.length > 0 && !structural,
    structural,
    changedKeys,
  };
}

// ─── Disk Monitoring ───

/** Minimum free disk space threshold (5 GB). */
export const MIN_DISK_FREE_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Check if a host has sufficient disk space.
 *
 * @param freeBytesGetter Callback to get free disk bytes.
 * @param threshold       Minimum free bytes. Default: 5GB.
 * @returns Object with check result.
 */
export async function checkDiskSpace(
  freeBytesGetter: () => Promise<number>,
  threshold: number = MIN_DISK_FREE_BYTES,
): Promise<{ ok: boolean; freeBytes: number; threshold: number }> {
  const freeBytes = await freeBytesGetter();
  return {
    ok: freeBytes >= threshold,
    freeBytes,
    threshold,
  };
}

// ─── Issue Edit Detection ───

/** What constitutes a "substantial" issue edit. */
export type EditSensitivity =
  | 'title_and_ac'       // Title + acceptance criteria (default)
  | 'any_body_change'    // Any body text change
  | 'labels_only'        // Only label changes
  | 'all';               // Any change at all

/** Fields to compare for substantial change detection. */
export interface IssueSnapshot {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
}

/**
 * Detect if an issue has been substantially edited.
 *
 * @param previous     Previous snapshot of the issue.
 * @param current      Current state of the issue.
 * @param sensitivity  Edit sensitivity mode.
 * @returns Object with isSubstantial flag and list of changed fields.
 */
export function detectSubstantialEdit(
  previous: IssueSnapshot,
  current: IssueSnapshot,
  sensitivity: EditSensitivity = 'title_and_ac',
): { isSubstantial: boolean; changedFields: string[] } {
  const changedFields: string[] = [];

  if (previous.title !== current.title) {
    changedFields.push('title');
  }

  if (previous.body !== current.body) {
    changedFields.push('body');
  }

  const prevLabels = [...previous.labels].sort().join(',');
  const currLabels = [...current.labels].sort().join(',');
  if (prevLabels !== currLabels) {
    changedFields.push('labels');
  }

  const prevAssignees = [...previous.assignees].sort().join(',');
  const currAssignees = [...current.assignees].sort().join(',');
  if (prevAssignees !== currAssignees) {
    changedFields.push('assignees');
  }

  if (changedFields.length === 0) {
    return { isSubstantial: false, changedFields };
  }

  switch (sensitivity) {
    case 'all':
      return { isSubstantial: true, changedFields };

    case 'any_body_change':
      return {
        isSubstantial: changedFields.includes('body') || changedFields.includes('title'),
        changedFields,
      };

    case 'labels_only':
      return {
        isSubstantial: changedFields.includes('labels'),
        changedFields,
      };

    case 'title_and_ac': {
      // Title changed is always substantial
      if (changedFields.includes('title')) {
        return { isSubstantial: true, changedFields };
      }
      // Body changed — check if acceptance criteria changed
      if (changedFields.includes('body')) {
        const prevAC = extractAcceptanceCriteria(previous.body);
        const currAC = extractAcceptanceCriteria(current.body);
        if (prevAC !== currAC) {
          return { isSubstantial: true, changedFields };
        }
      }
      // Labels changed (especially priority labels)
      if (changedFields.includes('labels')) {
        return { isSubstantial: true, changedFields };
      }
      // Assignee changed
      if (changedFields.includes('assignees')) {
        return { isSubstantial: true, changedFields };
      }
      return { isSubstantial: false, changedFields };
    }

    default:
      return { isSubstantial: false, changedFields };
  }
}

/**
 * Extract acceptance criteria section from an issue body.
 * Looks for "## Acceptance Criteria" or "- [ ]" checklist items.
 */
function extractAcceptanceCriteria(body: string): string {
  // Try to extract ## Acceptance Criteria section
  const acMatch = body.match(/##\s*Acceptance\s*Criteria\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (acMatch) {
    return acMatch[1].trim();
  }

  // Fall back to collecting all checklist items
  const checklistItems = body.match(/- \[[ x]\] .+/g);
  if (checklistItems) {
    return checklistItems.join('\n');
  }

  return '';
}

// ─── Circuit Breaker Persistence ───

/**
 * Persist a circuit breaker state to the database.
 * Uses upsert for idempotency.
 */
export async function persistCircuitBreakerState(
  pool: Pool,
  namespace: string,
  state: CircuitBreakerState,
): Promise<void> {
  await pool.query(
    `INSERT INTO symphony_circuit_breaker
       (namespace, breaker_id, state, failure_count, success_count,
        last_failure_at, last_success_at, last_transition_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (namespace, breaker_id)
     DO UPDATE SET
       state = EXCLUDED.state,
       failure_count = EXCLUDED.failure_count,
       success_count = EXCLUDED.success_count,
       last_failure_at = EXCLUDED.last_failure_at,
       last_success_at = EXCLUDED.last_success_at,
       last_transition_at = EXCLUDED.last_transition_at`,
    [
      namespace,
      state.breakerId,
      state.state,
      state.failureCount,
      state.successCount,
      state.lastFailureAt,
      state.lastSuccessAt,
      state.lastTransitionAt,
    ],
  );
}

/**
 * Load a circuit breaker state from the database.
 * Returns null if no persisted state exists.
 */
export async function loadCircuitBreakerState(
  pool: Pool,
  namespace: string,
  breakerId: string,
): Promise<CircuitBreakerState | null> {
  const result = await pool.query<{
    breaker_id: string;
    state: string;
    failure_count: number;
    success_count: number;
    last_failure_at: Date | null;
    last_success_at: Date | null;
    last_transition_at: Date;
  }>(
    `SELECT breaker_id, state, failure_count, success_count,
            last_failure_at, last_success_at, last_transition_at
     FROM symphony_circuit_breaker
     WHERE namespace = $1 AND breaker_id = $2`,
    [namespace, breakerId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  // Validate persisted state value
  const validStates = new Set(Object.values(CircuitState));
  const state = validStates.has(row.state as CircuitState)
    ? (row.state as CircuitState)
    : CircuitState.Closed; // Default to closed for unknown states

  return {
    breakerId: row.breaker_id,
    state,
    failureCount: row.failure_count,
    successCount: row.success_count,
    lastFailureAt: row.last_failure_at,
    lastSuccessAt: row.last_success_at,
    lastTransitionAt: row.last_transition_at,
  };
}
