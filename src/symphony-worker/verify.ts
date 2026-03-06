/**
 * Result Verification & Merge Governance.
 * Issue #2200 — Result Verification & Merge Governance.
 *
 * Manages the closed-loop from PR creation through merge to issue closure:
 * - VerifyingResult: CI check + optional Codex review
 * - AwaitingApproval: auto-approve policies with configurable credential reference
 * - MergePending: squash/merge with conflict handling
 * - PostMergeVerify: post-merge CI monitoring with revert-on-red
 * - IssueClosing: close issue + sync work_item
 *
 * Security (P2-11): No hardcoded personal token names.
 * Safety (P2-12): Automatic revert blocked when migration files present.
 * Clarity (P2-13): approval_type metadata distinguishes approval scenarios.
 * Noise (Codex finding): Bot marker and notification_mode for comment consolidation.
 */

import type { Pool } from 'pg';

// ─── Types ───

/** Approval type for AwaitingApproval state metadata (P2-13). */
export type ApprovalType = 'pr_review' | 'agent_action' | 'branch_protection';

/** Auto-approve policy per project. */
export type AutoApprovePolicy = 'auto_approve_safe' | 'auto_cancel' | 'escalate';

/** Notification mode for automated comments (Codex finding). */
export type NotificationMode = 'normal' | 'quiet' | 'silent';

/** Merge strategy. */
export type MergeStrategy = 'squash' | 'merge' | 'rebase';

/** On-diverge behavior for force-push/rebase recovery. */
export type OnDiverge = 'rebase' | 'restart' | 'fail';

/** CI check status. */
export type CIStatus = 'success' | 'failure' | 'pending' | 'error' | 'not_found';

/** Bot marker for comment identification. */
export const SYMPHONY_BOT_MARKER = '<!-- symphony-bot -->';

/** Default approval SLA in milliseconds. */
export const APPROVAL_SLA_MS = 5 * 60 * 1000; // 5 min

// ─── Verification Configuration ───

/** Configuration for the verification pipeline. */
export interface VerificationConfig {
  /** Auto-approve policy. Default: 'escalate'. */
  autoApprovePolicy: AutoApprovePolicy;
  /** Configurable credential reference for approval token (P2-11).
   *  Points to an environment variable name or vault item reference.
   *  MUST NOT be a hardcoded personal token name. */
  approvalTokenRef: string;
  /** Merge strategy. Default: 'squash'. */
  mergeStrategy: MergeStrategy;
  /** Notification mode. Default: 'quiet'. */
  notificationMode: NotificationMode;
  /** On-diverge behavior. Default: 'rebase'. */
  onDiverge: OnDiverge;
  /** Whether to run Codex review. Default: true. */
  codexReviewEnabled: boolean;
  /** Codex review timeout in ms. Default: 300000 (5min). */
  codexReviewTimeoutMs: number;
  /** Maximum Codex review retries. Default: 2. */
  codexReviewMaxRetries: number;
}

/** Default verification configuration. */
export const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
  autoApprovePolicy: 'escalate',
  approvalTokenRef: 'SYMPHONY_APPROVAL_TOKEN',
  mergeStrategy: 'squash',
  notificationMode: 'quiet',
  onDiverge: 'rebase',
  codexReviewEnabled: true,
  codexReviewTimeoutMs: 300_000,
  codexReviewMaxRetries: 2,
};

// ─── CI Status Checking ───

/** PR CI check result. */
export interface CICheckResult {
  status: CIStatus;
  checks: Array<{
    name: string;
    status: CIStatus;
    url?: string;
  }>;
  allPassing: boolean;
  hasPending: boolean;
}

/**
 * Aggregate individual CI check statuses into an overall result.
 */
export function aggregateCIChecks(
  checks: Array<{ name: string; status: CIStatus; url?: string }>,
): CICheckResult {
  if (checks.length === 0) {
    return {
      status: 'not_found',
      checks,
      allPassing: false,
      hasPending: false,
    };
  }

  const allPassing = checks.every((c) => c.status === 'success');
  const hasPending = checks.some((c) => c.status === 'pending');
  const hasFailure = checks.some(
    (c) => c.status === 'failure' || c.status === 'error',
  );

  let status: CIStatus;
  if (allPassing) {
    status = 'success';
  } else if (hasFailure) {
    status = 'failure';
  } else if (hasPending) {
    status = 'pending';
  } else {
    status = 'error';
  }

  return { status, checks, allPassing, hasPending };
}

// ─── Git Health Check ───

/** Git health check result. */
export interface GitHealthResult {
  upToDate: boolean;
  diverged: boolean;
  behindCount: number;
  aheadCount: number;
  mergeBase: string | null;
  headSha: string | null;
}

/**
 * Parse git merge-base / rev-list output to detect divergence.
 */
export function analyzeGitDivergence(
  aheadCount: number,
  behindCount: number,
  mergeBase: string | null,
  headSha: string | null,
): GitHealthResult {
  const diverged = behindCount > 0;
  const upToDate = behindCount === 0;

  return {
    upToDate,
    diverged,
    behindCount,
    aheadCount,
    mergeBase,
    headSha,
  };
}

// ─── Migration File Detection (P2-12) ───

/** Glob patterns for migration file detection. */
const MIGRATION_PATTERNS = [
  /^.*\/migrations\/.+$/,
  /^.*\/migrate\/.+$/,
  /^.*\.sql$/,
];

/**
 * Check if a PR contains migration files that would make auto-revert dangerous.
 * Per P2-12: automatic revert MUST be blocked if migration files are present.
 *
 * @param changedFiles List of file paths changed in the PR.
 * @returns Object with hasMigrations flag and matching files.
 */
export function detectMigrationFiles(
  changedFiles: string[],
): { hasMigrations: boolean; migrationFiles: string[] } {
  const migrationFiles = changedFiles.filter((file) =>
    MIGRATION_PATTERNS.some((pattern) => pattern.test(file)),
  );

  return {
    hasMigrations: migrationFiles.length > 0,
    migrationFiles,
  };
}

// ─── Auto-Approve ───

/**
 * Resolve the approval token from a credential reference.
 * The reference is an environment variable name or vault item reference.
 * Per P2-11: MUST NOT hardcode personal token names.
 *
 * @param tokenRef The credential reference (e.g., 'SYMPHONY_APPROVAL_TOKEN').
 * @returns The resolved token value, or null if not found.
 */
export function resolveApprovalToken(tokenRef: string): string | null {
  // Validate that the token ref is not a hardcoded personal token name
  const personalTokenPattern = /^GITHUB_TOKEN_[A-Z]+$/;
  if (personalTokenPattern.test(tokenRef)) {
    throw new Error(
      `SECURITY: approvalTokenRef '${tokenRef}' appears to be a hardcoded personal ` +
      `token reference. Use a generic credential reference (e.g., 'SYMPHONY_APPROVAL_TOKEN') ` +
      `that points to a vault item or environment variable.`,
    );
  }

  // Resolve from environment
  const value = process.env[tokenRef];
  return value ?? null;
}

/**
 * Determine the auto-approve action based on policy and approval type.
 *
 * @param policy       The project's auto-approve policy.
 * @param approvalType The type of approval needed (P2-13).
 * @returns Action to take.
 */
export function determineApprovalAction(
  policy: AutoApprovePolicy,
  approvalType: ApprovalType,
): 'approve' | 'cancel' | 'escalate' | 'skip' {
  // Auto-approve only applies to pr_review type (P2-13)
  if (approvalType !== 'pr_review') {
    return 'escalate';
  }

  switch (policy) {
    case 'auto_approve_safe':
      return 'approve';
    case 'auto_cancel':
      return 'cancel';
    case 'escalate':
      return 'escalate';
    default:
      return 'escalate';
  }
}

// ─── Merge Handling ───

/** Merge attempt result. */
export interface MergeResult {
  success: boolean;
  sha?: string;
  error?: string;
  conflicted?: boolean;
  blocked?: boolean;
}

/**
 * Classify a merge failure for retry logic.
 *
 * @param errorMessage The error message from the merge attempt.
 * @returns Classified failure type.
 */
export function classifyMergeFailure(
  errorMessage: string,
): 'conflict' | 'blocked' | 'ci_required' | 'unknown' {
  const msg = errorMessage.toLowerCase();

  if (msg.includes('conflict') || msg.includes('cannot be merged')) {
    return 'conflict';
  }

  // Check CI-related patterns before generic branch protection patterns
  // because "required status checks" contains "required status check".
  if (
    msg.includes('required checks') ||
    msg.includes('status checks')
  ) {
    return 'ci_required';
  }

  if (
    msg.includes('branch protection') ||
    msg.includes('required status check') ||
    msg.includes('review required')
  ) {
    return 'blocked';
  }

  return 'unknown';
}

// ─── Post-Merge Verification ───

/** Revert decision result. */
export interface RevertDecision {
  shouldRevert: boolean;
  blocked: boolean;
  reason: string;
  migrationFiles?: string[];
}

/**
 * Decide whether to auto-revert a PR after post-merge CI failure.
 * Per P2-12: revert blocked when migration files are present.
 *
 * @param changedFiles Files changed in the original PR.
 * @returns Revert decision.
 */
export function decideRevert(changedFiles: string[]): RevertDecision {
  const { hasMigrations, migrationFiles } = detectMigrationFiles(changedFiles);

  if (hasMigrations) {
    return {
      shouldRevert: false,
      blocked: true,
      reason:
        'Automatic revert blocked: PR contains migration files. ' +
        'Manual intervention required to avoid data loss.',
      migrationFiles,
    };
  }

  return {
    shouldRevert: true,
    blocked: false,
    reason: 'Post-merge CI failed — automatic revert initiated.',
  };
}

// ─── Comment Consolidation ───

/**
 * Format a Symphony bot comment with the bot marker for identification.
 * In 'quiet' mode, comments should be updated in-place rather than creating new ones.
 *
 * @param content     Comment body text.
 * @param commentId   Optional existing comment ID for in-place updates.
 * @returns Formatted comment body with bot marker.
 */
export function formatBotComment(content: string): string {
  return `${SYMPHONY_BOT_MARKER}\n${content}`;
}

/**
 * Check if a comment was created by Symphony.
 *
 * @param commentBody The comment body text.
 * @returns True if the comment has the Symphony bot marker.
 */
export function isSymphonyComment(commentBody: string): boolean {
  return commentBody.includes(SYMPHONY_BOT_MARKER);
}

// ─── Container TTL Grace Period ───

/** Container TTL warning/termination thresholds. */
export interface ContainerTTLConfig {
  /** Maximum TTL in milliseconds. */
  maxTtlMs: number;
  /** Warning issued at maxTtl - warningBeforeMs. */
  warningBeforeMs: number;
  /** Termination starts at maxTtl - terminateBeforeMs. */
  terminateBeforeMs: number;
  /** Force kill at maxTtl + forceKillAfterMs. */
  forceKillAfterMs: number;
}

/** Default container TTL config. */
export const DEFAULT_CONTAINER_TTL: ContainerTTLConfig = {
  maxTtlMs: 60 * 60 * 1000,           // 1 hour
  warningBeforeMs: 15 * 60 * 1000,     // warn at max - 15min
  terminateBeforeMs: 5 * 60 * 1000,    // terminate at max - 5min
  forceKillAfterMs: 2 * 60 * 1000,     // force kill at max + 2min
};

/**
 * Calculate container lifecycle phase based on elapsed time.
 *
 * @param elapsedMs  Time elapsed since container start.
 * @param config     TTL configuration.
 * @returns Current phase and time until next phase.
 */
export function getContainerPhase(
  elapsedMs: number,
  config: ContainerTTLConfig = DEFAULT_CONTAINER_TTL,
): {
  phase: 'running' | 'warning' | 'terminating' | 'force_kill';
  timeUntilNextPhaseMs: number;
} {
  const warningAt = config.maxTtlMs - config.warningBeforeMs;
  const terminateAt = config.maxTtlMs - config.terminateBeforeMs;
  const forceKillAt = config.maxTtlMs + config.forceKillAfterMs;

  if (elapsedMs >= forceKillAt) {
    return { phase: 'force_kill', timeUntilNextPhaseMs: 0 };
  }

  if (elapsedMs >= terminateAt) {
    return {
      phase: 'terminating',
      timeUntilNextPhaseMs: forceKillAt - elapsedMs,
    };
  }

  if (elapsedMs >= warningAt) {
    return {
      phase: 'warning',
      timeUntilNextPhaseMs: terminateAt - elapsedMs,
    };
  }

  return {
    phase: 'running',
    timeUntilNextPhaseMs: warningAt - elapsedMs,
  };
}

// ─── Issue Closing ───

/** Work item sync result after issue closure. */
export interface IssueCloseResult {
  closed: boolean;
  prNumber?: number;
  error?: string;
}

/**
 * Generate the issue close comment referencing the merged PR.
 */
export function generateCloseComment(
  prNumber: number,
  runId: string,
): string {
  return formatBotComment(
    `Closed by Symphony run \`${runId}\` after successful merge of PR #${prNumber}.`,
  );
}

// ─── Approval Event Metadata (P2-13) ───

/**
 * Create the approval event metadata that distinguishes approval types.
 */
export function createApprovalEventMetadata(
  approvalType: ApprovalType,
  policy: AutoApprovePolicy,
  action: 'approve' | 'cancel' | 'escalate' | 'skip',
): Record<string, unknown> {
  return {
    approval_type: approvalType,
    auto_approve_policy: policy,
    action,
  };
}
