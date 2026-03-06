/**
 * Symphony Orchestrator State Machine — State Definitions
 *
 * 22 states with PascalCase TypeScript enum keys mapping to snake_case DB values.
 * Per review finding X1: consistent casing between TS and DB.
 *
 * @see docs/plans/2026-03-06-symphony-orchestration-design.md §3
 * Issue #2196
 */

/**
 * All 22 run states in the Symphony orchestrator lifecycle.
 * PascalCase keys map to snake_case values matching the DB CHECK constraint.
 */
export enum RunState {
  Unclaimed = 'unclaimed',
  Claimed = 'claimed',
  Provisioning = 'provisioning',
  Prompting = 'prompting',
  Running = 'running',
  AwaitingApproval = 'awaiting_approval',
  VerifyingResult = 'verifying_result',
  MergePending = 'merge_pending',
  PostMergeVerify = 'post_merge_verify',
  IssueClosing = 'issue_closing',
  ContinuationWait = 'continuation_wait',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Stalled = 'stalled',
  Cancelled = 'cancelled',
  Terminated = 'terminated',
  Terminating = 'terminating',
  Paused = 'paused',
  Orphaned = 'orphaned',
  CleanupFailed = 'cleanup_failed',
  RetryQueued = 'retry_queued',
  Released = 'released',
}

/** The complete set of DB CHECK constraint values for symphony_run.status. */
export const RUN_STATE_DB_VALUES: ReadonlySet<string> = new Set(
  Object.values(RunState),
);

/**
 * Terminal states — once reached, the run is complete and cannot transition further.
 * Note: Failed is NOT terminal — it can transition to RetryQueued or ContinuationWait.
 */
export const TERMINAL_STATES: ReadonlySet<RunState> = new Set([
  RunState.Succeeded,
  RunState.Cancelled,
  RunState.Terminated,
  RunState.Released,
  RunState.CleanupFailed,
]);

/** Active states — runs currently consuming resources or requiring attention. */
export const ACTIVE_STATES: ReadonlySet<RunState> = new Set([
  RunState.Claimed,
  RunState.Provisioning,
  RunState.Prompting,
  RunState.Running,
  RunState.AwaitingApproval,
  RunState.VerifyingResult,
  RunState.MergePending,
  RunState.PostMergeVerify,
  RunState.IssueClosing,
  RunState.Terminating,
]);

/**
 * Valid state transitions. Each key is a source state; the value is the set of
 * states it can transition to. Any transition not in this map is rejected.
 */
export const VALID_TRANSITIONS: ReadonlyMap<RunState, ReadonlySet<RunState>> =
  new Map([
    // Initial dispatch
    [
      RunState.Unclaimed,
      new Set([RunState.Claimed, RunState.Cancelled]),
    ],

    // Claimed → provision or release
    [
      RunState.Claimed,
      new Set([
        RunState.Provisioning,
        RunState.Released,       // lease expired or voluntarily released
        RunState.Orphaned,       // lease expired, detected by watchdog
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // Provisioning pipeline
    [
      RunState.Provisioning,
      new Set([
        RunState.Prompting,
        RunState.Failed,         // provisioning step failed
        RunState.Orphaned,       // lease expired during provisioning
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // Prompt delivery
    [
      RunState.Prompting,
      new Set([
        RunState.Running,
        RunState.Failed,         // prompt delivery failed
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // Agent execution
    [
      RunState.Running,
      new Set([
        RunState.VerifyingResult,
        RunState.AwaitingApproval,
        RunState.Stalled,        // timeout, no progress
        RunState.Failed,         // agent error
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // Awaiting human/auto approval
    [
      RunState.AwaitingApproval,
      new Set([
        RunState.Running,        // approval granted, resume
        RunState.MergePending,   // PR approval
        RunState.VerifyingResult,
        RunState.Paused,         // approval SLA exceeded
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // CI + optional Codex review
    [
      RunState.VerifyingResult,
      new Set([
        RunState.MergePending,   // verification passed
        RunState.Failed,         // CI failed
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // Merge attempt
    [
      RunState.MergePending,
      new Set([
        RunState.PostMergeVerify,
        RunState.AwaitingApproval, // merge blocked, needs approval
        RunState.Failed,           // merge conflict
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // Post-merge CI verification
    [
      RunState.PostMergeVerify,
      new Set([
        RunState.IssueClosing,
        RunState.Failed,         // post-merge CI red → revert
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // Issue close
    [
      RunState.IssueClosing,
      new Set([
        RunState.Released,       // issue closed → complete
        RunState.Failed,         // close API failed
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // Continuation wait (exponential backoff)
    [
      RunState.ContinuationWait,
      new Set([
        RunState.Provisioning,   // re-dispatch
        RunState.Paused,         // 3 continuations without progress
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // Stalled (detected by watchdog)
    [
      RunState.Stalled,
      new Set([
        RunState.RetryQueued,
        RunState.Paused,
        RunState.Failed,
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // Retry queue
    [
      RunState.RetryQueued,
      new Set([
        RunState.Provisioning,   // re-dispatch after backoff
        RunState.Paused,         // max retries exceeded or budget exceeded
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // Paused (manual re-enable required)
    [
      RunState.Paused,
      new Set([
        RunState.RetryQueued,    // manual re-enable
        RunState.Cancelled,
        RunState.Terminating,
      ]),
    ],

    // Orphaned (lease expired, no orchestrator)
    [
      RunState.Orphaned,
      new Set([
        RunState.Failed,
        RunState.Released,
        RunState.Cancelled,
      ]),
    ],

    // Terminating (graceful shutdown, 2min)
    [
      RunState.Terminating,
      new Set([
        RunState.Terminated,
        RunState.Released,       // cleanup succeeded
        RunState.CleanupFailed,  // cleanup failed
      ]),
    ],

    // Failed (can be retried or escalated)
    [
      RunState.Failed,
      new Set([
        RunState.RetryQueued,
        RunState.ContinuationWait,
      ]),
    ],

    // Terminal states — no outbound transitions
    [RunState.Succeeded, new Set()],
    [RunState.Cancelled, new Set()],
    [RunState.Terminated, new Set()],
    [RunState.Released, new Set()],
    [RunState.CleanupFailed, new Set()],
  ]);

/**
 * Per-state timeout in seconds. States not listed have no timeout
 * (or use configurable project-level values).
 */
export const STATE_TIMEOUTS: ReadonlyMap<RunState, number> = new Map([
  [RunState.Claimed, 60],
  [RunState.Provisioning, 20 * 60],      // 20 min aggregate
  [RunState.Prompting, 2 * 60],          // 2 min
  [RunState.Running, 60 * 60],           // 60 min (default, configurable)
  [RunState.VerifyingResult, 10 * 60],   // 10 min
  [RunState.MergePending, 30 * 60],      // 30 min
  [RunState.PostMergeVerify, 15 * 60],   // 15 min
  [RunState.IssueClosing, 5 * 60],       // 5 min
  [RunState.AwaitingApproval, 5 * 60],   // 5 min SLA
  [RunState.Terminating, 2 * 60],        // 2 min graceful
]);

/**
 * Advisory run stages inferred from terminal I/O.
 * These NEVER drive state transitions — they are purely informational.
 */
export enum RunStage {
  ReadingIssue = 'reading_issue',
  Planning = 'planning',
  Coding = 'coding',
  Testing = 'testing',
  CreatingPr = 'creating_pr',
  Reviewing = 'reviewing',
  WaitingReview = 'waiting_review',
}

/** DB CHECK constraint values for symphony_run.stage (advisory). */
export const RUN_STAGE_DB_VALUES: ReadonlySet<string> = new Set(
  Object.values(RunStage),
);

/**
 * Failure classification for retry logic.
 * Each class has a maximum retry count and recovery strategy.
 */
export enum FailureClass {
  SshLost = 'ssh_lost',
  DockerUnavailable = 'docker_unavailable',
  HostReboot = 'host_reboot',
  CredentialsUnavailable = 'credentials_unavailable',
  RateLimited = 'rate_limited',
  DiskFull = 'disk_full',
  TokenExhaustion = 'token_exhaustion',
  ContextOverflow = 'context_overflow',
  BudgetExceeded = 'budget_exceeded',
  AgentLoop = 'agent_loop',
  DivergedBase = 'diverged_base',
}

/** Per-failure-class maximum retry limits. */
export const FAILURE_RETRY_LIMITS: ReadonlyMap<FailureClass, number> = new Map([
  [FailureClass.SshLost, 3],
  [FailureClass.DockerUnavailable, 2],
  [FailureClass.HostReboot, 2],
  [FailureClass.CredentialsUnavailable, 1],
  [FailureClass.RateLimited, Infinity],  // unlimited, wait until reset
  [FailureClass.DiskFull, 0],
  [FailureClass.TokenExhaustion, 0],
  [FailureClass.ContextOverflow, 1],
  [FailureClass.BudgetExceeded, 0],
  [FailureClass.AgentLoop, 1],
  [FailureClass.DivergedBase, 2],
]);

/** Recovery strategy for each failure class. */
export type RecoveryStrategy =
  | 'retry_same_host'
  | 'retry_different_host'
  | 'wait_and_retry'
  | 'pause'
  | 'terminal'
  | 'retry_with_feedback';

export const FAILURE_RECOVERY: ReadonlyMap<FailureClass, RecoveryStrategy> =
  new Map([
    [FailureClass.SshLost, 'retry_same_host'],
    [FailureClass.DockerUnavailable, 'retry_different_host'],
    [FailureClass.HostReboot, 'wait_and_retry'],
    [FailureClass.CredentialsUnavailable, 'pause'],
    [FailureClass.RateLimited, 'wait_and_retry'],
    [FailureClass.DiskFull, 'terminal'],
    [FailureClass.TokenExhaustion, 'terminal'],
    [FailureClass.ContextOverflow, 'retry_with_feedback'],
    [FailureClass.BudgetExceeded, 'pause'],
    [FailureClass.AgentLoop, 'retry_with_feedback'],
    [FailureClass.DivergedBase, 'retry_with_feedback'],
  ]);

/**
 * Check if a transition from `from` to `to` is valid.
 */
export function isValidTransition(from: RunState, to: RunState): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  if (!allowed) return false;
  return allowed.has(to);
}

/**
 * Check if a state is terminal (no outbound transitions).
 */
export function isTerminalState(state: RunState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Infer the advisory stage from terminal I/O content.
 * Returns undefined if no pattern matches.
 */
export function inferStage(output: string): RunStage | undefined {
  // Order matters — check most specific patterns first
  const patterns: Array<[RegExp, RunStage]> = [
    [/creating pull request|gh pr create|git push.*-u/i, RunStage.CreatingPr],
    [/codex.*review|running.*review|security.*review/i, RunStage.Reviewing],
    [/waiting.*review|review.*pending|approval.*pending/i, RunStage.WaitingReview],
    [/running tests|test.*pass|test.*fail|vitest|jest|pytest/i, RunStage.Testing],
    [/reading.*issue|gh issue view|fetching.*issue/i, RunStage.ReadingIssue],
    [/planning|design|architecture|approach/i, RunStage.Planning],
    [/editing.*file|creating.*file|writing.*code|implementing/i, RunStage.Coding],
  ];

  for (const [pattern, stage] of patterns) {
    if (pattern.test(output)) return stage;
  }
  return undefined;
}

/**
 * Classify an error into a failure class based on error context.
 * Returns undefined if the error doesn't match any known failure pattern.
 */
export function classifyFailure(
  errorMessage: string,
  errorCode?: string,
): FailureClass | undefined {
  const msg = errorMessage.toLowerCase();
  const code = errorCode?.toLowerCase() ?? '';

  if (
    msg.includes('ssh') ||
    msg.includes('connection reset') ||
    msg.includes('broken pipe') ||
    code === 'ssh_lost'
  ) {
    return FailureClass.SshLost;
  }

  if (
    msg.includes('docker') ||
    msg.includes('container') ||
    msg.includes('devcontainer') ||
    code === 'docker_unavailable'
  ) {
    return FailureClass.DockerUnavailable;
  }

  if (
    msg.includes('host reboot') ||
    msg.includes('host restart') ||
    code === 'host_reboot'
  ) {
    return FailureClass.HostReboot;
  }

  if (
    msg.includes('credential') ||
    msg.includes('1password') ||
    msg.includes('op://') ||
    code === 'credentials_unavailable'
  ) {
    return FailureClass.CredentialsUnavailable;
  }

  if (
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('x-ratelimit') ||
    code === 'rate_limited'
  ) {
    return FailureClass.RateLimited;
  }

  if (
    msg.includes('disk full') ||
    msg.includes('no space left') ||
    msg.includes('enospc') ||
    code === 'disk_full'
  ) {
    return FailureClass.DiskFull;
  }

  if (
    msg.includes('token exhaustion') ||
    msg.includes('max tokens') ||
    code === 'token_exhaustion'
  ) {
    return FailureClass.TokenExhaustion;
  }

  if (
    msg.includes('context overflow') ||
    msg.includes('context window') ||
    msg.includes('context length') ||
    code === 'context_overflow'
  ) {
    return FailureClass.ContextOverflow;
  }

  if (
    msg.includes('budget exceeded') ||
    msg.includes('budget limit') ||
    code === 'budget_exceeded'
  ) {
    return FailureClass.BudgetExceeded;
  }

  if (
    msg.includes('agent loop') ||
    msg.includes('loop detected') ||
    msg.includes('repeated pattern') ||
    code === 'agent_loop'
  ) {
    return FailureClass.AgentLoop;
  }

  if (
    msg.includes('diverged') ||
    msg.includes('rebase') ||
    msg.includes('merge conflict') ||
    code === 'diverged_base'
  ) {
    return FailureClass.DivergedBase;
  }

  return undefined;
}
