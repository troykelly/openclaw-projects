/**
 * Symphony Cleanup Queue & Orphan Detection
 *
 * Periodic sweep to detect and clean orphaned resources:
 * - Containers with no active run or past max_ttl_hours
 * - Worktrees in terminal-state runs
 * - Secrets unused for 7+ days with no active runs
 *
 * Implements the double-check pattern (P6-3 review finding):
 * 1. Detect: Sweep identifies candidate resources
 * 2. Enqueue: Candidates written to symphony_cleanup_item
 * 3. Recheck: Before cleanup, re-verify resource is still orphaned
 * 4. Abort if reclaimed: Skip if resource claimed since detection
 * 5. Execute: Only destroy if recheck confirms orphaned
 *
 * Cleanup operations use least-privilege credentials (P6-2 review finding):
 * - Dedicated cleanup user with minimal permissions
 * - No access to secret values, only file paths for deletion
 *
 * Issue #2213, Epic #2186
 */

import { TERMINAL_STATES, type RunState } from './states.js';

// ─── Constants ───────────────────────────────────────────────

/** Retention period for unused secrets before GC. */
export const CLEANUP_RETENTION_DAYS = 7;

/** Deferred GC window for non-active issues. */
export const DEFERRED_GC_HOURS = 24;

/** SLO: maximum pending cleanup items before alert. */
export const MAX_CLEANUP_BACKLOG_SIZE = 10;

/** SLO: maximum age of oldest pending item in seconds before alert. */
export const MAX_CLEANUP_BACKLOG_AGE_SECONDS = 3600; // 1 hour

/** SLO: critical threshold — age in seconds for auto-escalation. */
export const CRITICAL_BACKLOG_AGE_SECONDS = 24 * 3600; // 24 hours

// ─── Types ───────────────────────────────────────────────────

/** Container record from symphony_container. */
export interface ContainerRecord {
  id: string;
  containerId: string;
  connectionId: string;
  namespace: string;
  runId: string | null;
  containerName: string | null;
  startedAt: Date | null;
  maxTtlHours: number | null;
}

/** Workspace record from symphony_workspace. */
export interface WorkspaceRecord {
  id: string;
  connectionId: string;
  namespace: string;
  worktreePath: string;
  runId: string | null;
  lastUsedAt: Date | null;
  cleanupScheduledAt: Date | null;
}

/** Secret deployment record from symphony_secret_deployment. */
export interface SecretDeploymentRecord {
  id: string;
  namespace: string;
  connectionId: string;
  secretName: string;
  secretVersion: string;
  deployedPath: string;
  deployedAt: Date;
  lastUsedAt: Date | null;
  staleness: string;
  runId: string | null;
}

/** Cleanup item record from symphony_cleanup_item. */
export interface CleanupItem {
  id: string;
  namespace: string;
  resourceType: 'container' | 'worktree' | 'branch' | 'secret' | 'workspace';
  resourceId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  createdAt: Date;
  attempts: number;
}

/** Identified orphan with reason. */
export interface OrphanCandidate {
  resourceType: CleanupItem['resourceType'];
  resourceId: string;
  connectionId: string;
  namespace: string;
  reason: string;
}

/** Result of a cleanup execution (with double-check). */
export interface CleanupResult {
  status: 'completed' | 'failed' | 'resolved';
  resolvedReason?: 'cleaned' | 'reclaimed' | 'expired' | 'manual';
  error?: string;
}

/** SLO violation detail. */
export interface SloViolation {
  type: 'backlog_size' | 'backlog_age';
  value: number;
  threshold: number;
  message: string;
}

/** SLO check result. */
export interface SloStatus {
  healthy: boolean;
  critical?: boolean;
  violations: SloViolation[];
  pendingCount: number;
  oldestPendingAgeSeconds: number;
}

/** Context for deferred cleanup decision. */
export interface CleanupContext {
  runStatus: string;
  lastActivityAt: Date;
}

// ─── Orphan Detection ────────────────────────────────────────

/**
 * Identify orphaned containers by comparing against active runs.
 *
 * A container is orphaned if:
 * 1. It has no run_id, OR
 * 2. Its run_id is not in the set of active runs, OR
 * 3. It has exceeded max_ttl_hours since startedAt
 */
export function identifyOrphanedContainers(
  containers: ContainerRecord[],
  activeRunIds: ReadonlySet<string>,
): OrphanCandidate[] {
  const now = Date.now();
  const orphans: OrphanCandidate[] = [];

  for (const container of containers) {
    // Check TTL first (even active containers can exceed TTL)
    if (
      container.maxTtlHours !== null &&
      container.startedAt !== null
    ) {
      const ttlMs = container.maxTtlHours * 60 * 60 * 1000;
      const elapsed = now - container.startedAt.getTime();
      if (elapsed > ttlMs) {
        orphans.push({
          resourceType: 'container',
          resourceId: container.containerId,
          connectionId: container.connectionId,
          namespace: container.namespace,
          reason: `TTL exceeded: ${container.maxTtlHours}h limit, running for ${(elapsed / 3600000).toFixed(1)}h`,
        });
        continue;
      }
    }

    // Check for no run or inactive run
    if (container.runId === null || !activeRunIds.has(container.runId)) {
      orphans.push({
        resourceType: 'container',
        resourceId: container.containerId,
        connectionId: container.connectionId,
        namespace: container.namespace,
        reason: container.runId === null
          ? 'No associated run'
          : `Run ${container.runId} is no longer active`,
      });
    }
  }

  return orphans;
}

// ─── Stale Worktree Detection ────────────────────────────────

/**
 * Identify stale worktrees whose runs are in terminal state
 * or that have been unused for longer than the deferred GC window.
 */
export function identifyStaleWorktrees(
  workspaces: WorkspaceRecord[],
  terminalRunIds: ReadonlySet<string>,
): OrphanCandidate[] {
  const now = Date.now();
  const stale: OrphanCandidate[] = [];

  for (const ws of workspaces) {
    // If run is in terminal state, worktree is stale
    if (ws.runId !== null && terminalRunIds.has(ws.runId)) {
      stale.push({
        resourceType: 'worktree',
        resourceId: ws.worktreePath,
        connectionId: ws.connectionId,
        namespace: ws.namespace,
        reason: `Run ${ws.runId} in terminal state`,
      });
      continue;
    }

    // If no run and last used > 24h ago, also stale
    if (ws.runId === null && ws.lastUsedAt !== null) {
      const idleMs = now - ws.lastUsedAt.getTime();
      const deferredMs = DEFERRED_GC_HOURS * 60 * 60 * 1000;
      if (idleMs > deferredMs) {
        stale.push({
          resourceType: 'worktree',
          resourceId: ws.worktreePath,
          connectionId: ws.connectionId,
          namespace: ws.namespace,
          reason: `No run, idle for ${(idleMs / 3600000).toFixed(1)}h (>${DEFERRED_GC_HOURS}h threshold)`,
        });
      }
    }
  }

  return stale;
}

// ─── Expired Secrets Detection ───────────────────────────────

/**
 * Identify secrets eligible for cleanup.
 *
 * A secret is eligible if:
 * 1. It is not already cleaned
 * 2. It has no active run
 * 3. It was last used > CLEANUP_RETENTION_DAYS days ago
 *    (or never used and deployed > CLEANUP_RETENTION_DAYS days ago)
 *
 * Note: This module (#2213) reads symphony_secret_deployment data
 * maintained by #2214. It only determines cleanup eligibility and
 * performs file deletion — it does not manage deployment records.
 */
export function identifyExpiredSecrets(
  secrets: SecretDeploymentRecord[],
  activeRunIds: ReadonlySet<string>,
): OrphanCandidate[] {
  const now = Date.now();
  const retentionMs = CLEANUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired: OrphanCandidate[] = [];

  for (const secret of secrets) {
    // Skip already-cleaned
    if (secret.staleness === 'cleaned') continue;

    // Skip if associated with an active run
    if (secret.runId !== null && activeRunIds.has(secret.runId)) continue;

    // Check retention period
    const referenceDate = secret.lastUsedAt ?? secret.deployedAt;
    const age = now - referenceDate.getTime();

    if (age > retentionMs) {
      expired.push({
        resourceType: 'secret',
        resourceId: secret.deployedPath,
        connectionId: secret.connectionId,
        namespace: secret.namespace,
        reason: `Unused for ${(age / 86400000).toFixed(1)} days (>${CLEANUP_RETENTION_DAYS}d retention)`,
      });
    }
  }

  return expired;
}

// ─── SLO Checking ────────────────────────────────────────────

/**
 * Check cleanup SLO against pending items.
 *
 * SLO violations:
 * - Pending items > MAX_CLEANUP_BACKLOG_SIZE
 * - Oldest pending item age > MAX_CLEANUP_BACKLOG_AGE_SECONDS
 * - Critical: age > CRITICAL_BACKLOG_AGE_SECONDS (24h)
 */
export function checkCleanupSlo(items: CleanupItem[]): SloStatus {
  const pendingItems = items.filter((i) => i.status === 'pending');
  const violations: SloViolation[] = [];
  let critical = false;

  // Find oldest pending item age
  let oldestAgeSeconds = 0;
  const now = Date.now();
  for (const item of pendingItems) {
    const ageSeconds = (now - item.createdAt.getTime()) / 1000;
    if (ageSeconds > oldestAgeSeconds) {
      oldestAgeSeconds = ageSeconds;
    }
  }

  // Check backlog size
  if (pendingItems.length > MAX_CLEANUP_BACKLOG_SIZE) {
    violations.push({
      type: 'backlog_size',
      value: pendingItems.length,
      threshold: MAX_CLEANUP_BACKLOG_SIZE,
      message: `Cleanup backlog size ${pendingItems.length} exceeds threshold ${MAX_CLEANUP_BACKLOG_SIZE}`,
    });
  }

  // Check backlog age
  if (oldestAgeSeconds > MAX_CLEANUP_BACKLOG_AGE_SECONDS) {
    violations.push({
      type: 'backlog_age',
      value: oldestAgeSeconds,
      threshold: MAX_CLEANUP_BACKLOG_AGE_SECONDS,
      message: `Oldest pending item age ${oldestAgeSeconds.toFixed(0)}s exceeds threshold ${MAX_CLEANUP_BACKLOG_AGE_SECONDS}s`,
    });
  }

  // Check critical threshold
  if (oldestAgeSeconds > CRITICAL_BACKLOG_AGE_SECONDS) {
    critical = true;
  }

  return {
    healthy: violations.length === 0,
    critical,
    violations,
    pendingCount: pendingItems.length,
    oldestPendingAgeSeconds: oldestAgeSeconds,
  };
}

// ─── Deferred GC ─────────────────────────────────────────────

/**
 * Determine if cleanup should be deferred for a resource.
 *
 * Deferral rules:
 * - Non-terminal runs with activity within DEFERRED_GC_HOURS → defer
 * - Terminal runs → do not defer
 * - Activity older than DEFERRED_GC_HOURS → do not defer
 */
export function shouldDeferCleanup(ctx: CleanupContext): boolean {
  // Terminal states never defer
  if (TERMINAL_STATES.has(ctx.runStatus as RunState)) {
    return false;
  }

  // Check if activity is within deferred GC window
  const now = Date.now();
  const idleMs = now - ctx.lastActivityAt.getTime();
  const deferredMs = DEFERRED_GC_HOURS * 60 * 60 * 1000;

  return idleMs < deferredMs;
}

// ─── Double-Check Pattern ────────────────────────────────────

/**
 * CleanupSweeper implements the double-check pattern (P6-3 finding).
 *
 * Before executing any destructive cleanup action, the sweeper
 * rechecks whether the resource has been reclaimed since detection.
 * This prevents destroying resources that were orphaned momentarily
 * but have since been assigned to a new run.
 */
export class CleanupSweeper {
  /**
   * Execute cleanup with double-check ownership verification.
   *
   * @param item The cleanup item to process
   * @param recheckOwnership Returns true if resource has been reclaimed
   * @param executeCleanup The actual cleanup action (delete file, stop container, etc.)
   */
  async executeWithDoubleCheck(
    item: CleanupItem,
    recheckOwnership: (item: CleanupItem) => Promise<boolean>,
    executeCleanup: (item: CleanupItem) => Promise<void>,
  ): Promise<CleanupResult> {
    // Step 3: Recheck ownership before executing
    const reclaimed = await recheckOwnership(item);

    if (reclaimed) {
      // Step 4: Resource reclaimed since detection — abort
      return {
        status: 'resolved',
        resolvedReason: 'reclaimed',
      };
    }

    // Step 5: Execute cleanup
    try {
      await executeCleanup(item);
      return {
        status: 'completed',
        resolvedReason: 'cleaned',
      };
    } catch (err) {
      return {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
