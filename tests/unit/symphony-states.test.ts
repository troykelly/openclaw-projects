/**
 * Symphony State Machine — State Definitions Unit Tests
 *
 * Tests:
 * - Enum values match DB CHECK constraint values (X1 finding)
 * - All 22 states defined
 * - Valid transitions are complete and correct
 * - Terminal states have no outbound transitions
 * - Failure classification
 * - Stage inference (advisory only)
 * - Per-state timeouts
 * - Failure retry limits
 *
 * Issue #2196
 */

import { describe, it, expect } from 'vitest';
import {
  RunState,
  RunStage,
  FailureClass,
  RUN_STATE_DB_VALUES,
  RUN_STAGE_DB_VALUES,
  TERMINAL_STATES,
  ACTIVE_STATES,
  VALID_TRANSITIONS,
  STATE_TIMEOUTS,
  FAILURE_RETRY_LIMITS,
  FAILURE_RECOVERY,
  isValidTransition,
  isTerminalState,
  inferStage,
  classifyFailure,
} from '../../src/symphony/states.js';

describe('Symphony RunState enum', () => {
  /** X1 finding: verify enum values match the expected DB CHECK constraint values */
  it('has exactly 22 states', () => {
    const values = Object.values(RunState);
    expect(values).toHaveLength(22);
  });

  it('uses snake_case values for DB compatibility', () => {
    for (const value of Object.values(RunState)) {
      // All values should be lowercase with underscores only
      expect(value).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it('uses PascalCase keys', () => {
    for (const key of Object.keys(RunState)) {
      // First char should be uppercase
      expect(key[0]).toMatch(/[A-Z]/);
      // Should not contain underscores
      expect(key).not.toContain('_');
    }
  });

  it('maps PascalCase keys to snake_case values correctly', () => {
    expect(RunState.Unclaimed).toBe('unclaimed');
    expect(RunState.Claimed).toBe('claimed');
    expect(RunState.Provisioning).toBe('provisioning');
    expect(RunState.Prompting).toBe('prompting');
    expect(RunState.Running).toBe('running');
    expect(RunState.AwaitingApproval).toBe('awaiting_approval');
    expect(RunState.VerifyingResult).toBe('verifying_result');
    expect(RunState.MergePending).toBe('merge_pending');
    expect(RunState.PostMergeVerify).toBe('post_merge_verify');
    expect(RunState.IssueClosing).toBe('issue_closing');
    expect(RunState.ContinuationWait).toBe('continuation_wait');
    expect(RunState.Succeeded).toBe('succeeded');
    expect(RunState.Failed).toBe('failed');
    expect(RunState.Stalled).toBe('stalled');
    expect(RunState.Cancelled).toBe('cancelled');
    expect(RunState.Terminated).toBe('terminated');
    expect(RunState.Terminating).toBe('terminating');
    expect(RunState.Paused).toBe('paused');
    expect(RunState.Orphaned).toBe('orphaned');
    expect(RunState.CleanupFailed).toBe('cleanup_failed');
    expect(RunState.RetryQueued).toBe('retry_queued');
    expect(RunState.Released).toBe('released');
  });

  it('DB values set contains all enum values', () => {
    for (const value of Object.values(RunState)) {
      expect(RUN_STATE_DB_VALUES.has(value)).toBe(true);
    }
    expect(RUN_STATE_DB_VALUES.size).toBe(22);
  });

  /**
   * X1 acceptance test: verify TypeScript enum values match the database
   * CHECK constraint values exactly. The DB CHECK from migration 148 lists:
   * unclaimed, claimed, provisioning, prompting, running, awaiting_approval,
   * verifying_result, merge_pending, post_merge_verify, issue_closing,
   * continuation_wait, succeeded, failed, stalled, cancelled, terminated,
   * terminating, paused, orphaned, cleanup_failed, retry_queued, released
   */
  it('enum values match DB CHECK constraint values exactly (X1)', () => {
    const dbCheckValues = new Set([
      'unclaimed',
      'claimed',
      'provisioning',
      'prompting',
      'running',
      'awaiting_approval',
      'verifying_result',
      'merge_pending',
      'post_merge_verify',
      'issue_closing',
      'continuation_wait',
      'succeeded',
      'failed',
      'stalled',
      'cancelled',
      'terminated',
      'terminating',
      'paused',
      'orphaned',
      'cleanup_failed',
      'retry_queued',
      'released',
    ]);

    const enumValues = new Set(Object.values(RunState));

    // Every DB value must be in the enum
    for (const dbVal of dbCheckValues) {
      expect(enumValues.has(dbVal as RunState)).toBe(true);
    }

    // Every enum value must be in the DB
    for (const enumVal of enumValues) {
      expect(dbCheckValues.has(enumVal)).toBe(true);
    }

    // Same size
    expect(enumValues.size).toBe(dbCheckValues.size);
  });
});

describe('Terminal states', () => {
  it('identifies correct terminal states', () => {
    expect(isTerminalState(RunState.Succeeded)).toBe(true);
    expect(isTerminalState(RunState.Cancelled)).toBe(true);
    expect(isTerminalState(RunState.Terminated)).toBe(true);
    expect(isTerminalState(RunState.Released)).toBe(true);
    expect(isTerminalState(RunState.CleanupFailed)).toBe(true);
  });

  it('Failed is NOT terminal (can retry)', () => {
    expect(isTerminalState(RunState.Failed)).toBe(false);
  });

  it('non-terminal states are not terminal', () => {
    expect(isTerminalState(RunState.Unclaimed)).toBe(false);
    expect(isTerminalState(RunState.Running)).toBe(false);
    expect(isTerminalState(RunState.Paused)).toBe(false);
    expect(isTerminalState(RunState.RetryQueued)).toBe(false);
    expect(isTerminalState(RunState.Failed)).toBe(false);
  });

  it('terminal states have no outbound transitions', () => {
    for (const state of TERMINAL_STATES) {
      const transitions = VALID_TRANSITIONS.get(state);
      // Terminal states should either have no entry or an empty set
      if (transitions) {
        expect(
          transitions.size,
          `Terminal state '${state}' should have no outbound transitions`,
        ).toBe(0);
      }
    }
  });
});

describe('Valid transitions', () => {
  it('covers all 22 states as source states', () => {
    for (const state of Object.values(RunState)) {
      expect(
        VALID_TRANSITIONS.has(state),
        `Missing transition map for state '${state}'`,
      ).toBe(true);
    }
  });

  it('Unclaimed can transition to Claimed or Cancelled', () => {
    expect(isValidTransition(RunState.Unclaimed, RunState.Claimed)).toBe(true);
    expect(isValidTransition(RunState.Unclaimed, RunState.Cancelled)).toBe(true);
    expect(isValidTransition(RunState.Unclaimed, RunState.Running)).toBe(false);
  });

  it('Claimed can transition to Provisioning', () => {
    expect(isValidTransition(RunState.Claimed, RunState.Provisioning)).toBe(true);
  });

  it('Running can transition to VerifyingResult, AwaitingApproval, Stalled, Failed', () => {
    expect(isValidTransition(RunState.Running, RunState.VerifyingResult)).toBe(true);
    expect(isValidTransition(RunState.Running, RunState.AwaitingApproval)).toBe(true);
    expect(isValidTransition(RunState.Running, RunState.Stalled)).toBe(true);
    expect(isValidTransition(RunState.Running, RunState.Failed)).toBe(true);
  });

  it('VerifyingResult can transition to MergePending or Failed', () => {
    expect(isValidTransition(RunState.VerifyingResult, RunState.MergePending)).toBe(true);
    expect(isValidTransition(RunState.VerifyingResult, RunState.Failed)).toBe(true);
  });

  it('MergePending can transition to PostMergeVerify', () => {
    expect(isValidTransition(RunState.MergePending, RunState.PostMergeVerify)).toBe(true);
  });

  it('PostMergeVerify can transition to IssueClosing or Failed', () => {
    expect(isValidTransition(RunState.PostMergeVerify, RunState.IssueClosing)).toBe(true);
    expect(isValidTransition(RunState.PostMergeVerify, RunState.Failed)).toBe(true);
  });

  it('IssueClosing can transition to Succeeded or Released', () => {
    expect(isValidTransition(RunState.IssueClosing, RunState.Succeeded)).toBe(true);
    expect(isValidTransition(RunState.IssueClosing, RunState.Released)).toBe(true);
  });

  it('Failed can transition to RetryQueued or ContinuationWait', () => {
    expect(isValidTransition(RunState.Failed, RunState.RetryQueued)).toBe(true);
    expect(isValidTransition(RunState.Failed, RunState.ContinuationWait)).toBe(true);
  });

  it('RetryQueued can transition to Provisioning or Paused', () => {
    expect(isValidTransition(RunState.RetryQueued, RunState.Provisioning)).toBe(true);
    expect(isValidTransition(RunState.RetryQueued, RunState.Paused)).toBe(true);
  });

  it('Stalled transitions to RetryQueued, Paused, Failed, Cancelled, or Terminating', () => {
    expect(isValidTransition(RunState.Stalled, RunState.RetryQueued)).toBe(true);
    expect(isValidTransition(RunState.Stalled, RunState.Paused)).toBe(true);
    expect(isValidTransition(RunState.Stalled, RunState.Failed)).toBe(true);
    expect(isValidTransition(RunState.Stalled, RunState.Cancelled)).toBe(true);
    expect(isValidTransition(RunState.Stalled, RunState.Terminating)).toBe(true);
  });

  it('Terminating transitions to Terminated, Released, or CleanupFailed', () => {
    expect(isValidTransition(RunState.Terminating, RunState.Terminated)).toBe(true);
    expect(isValidTransition(RunState.Terminating, RunState.Released)).toBe(true);
    expect(isValidTransition(RunState.Terminating, RunState.CleanupFailed)).toBe(true);
  });

  it('Paused can be re-enabled to RetryQueued', () => {
    expect(isValidTransition(RunState.Paused, RunState.RetryQueued)).toBe(true);
    expect(isValidTransition(RunState.Paused, RunState.Cancelled)).toBe(true);
    expect(isValidTransition(RunState.Paused, RunState.Terminating)).toBe(true);
  });

  it('Orphaned can transition to Failed, Released, or Cancelled', () => {
    expect(isValidTransition(RunState.Orphaned, RunState.Failed)).toBe(true);
    expect(isValidTransition(RunState.Orphaned, RunState.Released)).toBe(true);
    expect(isValidTransition(RunState.Orphaned, RunState.Cancelled)).toBe(true);
  });

  it('every non-initial state has at least one inbound transition', () => {
    // Build reverse transition map: for each state, find all states that can transition TO it
    const inboundMap = new Map<RunState, Set<RunState>>();
    for (const state of Object.values(RunState)) {
      inboundMap.set(state, new Set());
    }
    for (const [from, targets] of VALID_TRANSITIONS) {
      for (const to of targets) {
        inboundMap.get(to)!.add(from);
      }
    }

    // Unclaimed is the initial state — it doesn't need inbound transitions
    for (const [state, inbound] of inboundMap) {
      if (state === RunState.Unclaimed) continue;
      expect(
        inbound.size,
        `State '${state}' has no inbound transitions — it is unreachable`,
      ).toBeGreaterThan(0);
    }
  });

  it('Succeeded is reachable from IssueClosing', () => {
    expect(isValidTransition(RunState.IssueClosing, RunState.Succeeded)).toBe(true);
  });

  it('rejects invalid transitions', () => {
    // Cannot go backwards
    expect(isValidTransition(RunState.Running, RunState.Unclaimed)).toBe(false);
    expect(isValidTransition(RunState.Provisioning, RunState.Claimed)).toBe(false);
    // Cannot skip states
    expect(isValidTransition(RunState.Unclaimed, RunState.Running)).toBe(false);
    // Cannot transition from terminal states
    expect(isValidTransition(RunState.Succeeded, RunState.Running)).toBe(false);
    expect(isValidTransition(RunState.Released, RunState.Unclaimed)).toBe(false);
  });

  it('most active states can be cancelled or terminated', () => {
    const cancellableStates = [
      RunState.Unclaimed,
      RunState.Claimed,
      RunState.Provisioning,
      RunState.Prompting,
      RunState.Running,
      RunState.AwaitingApproval,
      RunState.VerifyingResult,
      RunState.MergePending,
      RunState.PostMergeVerify,
      RunState.IssueClosing,
      RunState.ContinuationWait,
      RunState.Stalled,
      RunState.RetryQueued,
      RunState.Paused,
      RunState.Orphaned,
    ];

    for (const state of cancellableStates) {
      expect(
        isValidTransition(state, RunState.Cancelled) ||
          isValidTransition(state, RunState.Terminating),
        `State '${state}' should be cancellable or terminatable`,
      ).toBe(true);
    }
  });
});

describe('State timeouts', () => {
  it('Claimed timeout is 60 seconds', () => {
    expect(STATE_TIMEOUTS.get(RunState.Claimed)).toBe(60);
  });

  it('Provisioning timeout is 20 minutes', () => {
    expect(STATE_TIMEOUTS.get(RunState.Provisioning)).toBe(20 * 60);
  });

  it('Running timeout is 60 minutes (default)', () => {
    expect(STATE_TIMEOUTS.get(RunState.Running)).toBe(60 * 60);
  });

  it('Terminating timeout is 2 minutes', () => {
    expect(STATE_TIMEOUTS.get(RunState.Terminating)).toBe(2 * 60);
  });

  it('terminal states have no timeouts', () => {
    for (const state of TERMINAL_STATES) {
      expect(STATE_TIMEOUTS.has(state)).toBe(false);
    }
  });
});

describe('RunStage enum', () => {
  it('has 7 advisory stages', () => {
    expect(Object.values(RunStage)).toHaveLength(7);
  });

  it('uses snake_case values', () => {
    for (const value of Object.values(RunStage)) {
      expect(value).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it('DB values set matches enum', () => {
    expect(RUN_STAGE_DB_VALUES.size).toBe(7);
    for (const value of Object.values(RunStage)) {
      expect(RUN_STAGE_DB_VALUES.has(value)).toBe(true);
    }
  });
});

describe('FailureClass enum', () => {
  it('has 11 failure classes', () => {
    expect(Object.values(FailureClass)).toHaveLength(11);
  });

  it('every failure class has a retry limit', () => {
    for (const fc of Object.values(FailureClass)) {
      expect(FAILURE_RETRY_LIMITS.has(fc)).toBe(true);
    }
  });

  it('every failure class has a recovery strategy', () => {
    for (const fc of Object.values(FailureClass)) {
      expect(FAILURE_RECOVERY.has(fc)).toBe(true);
    }
  });

  it('rate_limited has unlimited retries', () => {
    expect(FAILURE_RETRY_LIMITS.get(FailureClass.RateLimited)).toBe(Infinity);
  });

  it('disk_full and token_exhaustion have 0 retries', () => {
    expect(FAILURE_RETRY_LIMITS.get(FailureClass.DiskFull)).toBe(0);
    expect(FAILURE_RETRY_LIMITS.get(FailureClass.TokenExhaustion)).toBe(0);
  });

  it('ssh_lost has 3 retries', () => {
    expect(FAILURE_RETRY_LIMITS.get(FailureClass.SshLost)).toBe(3);
  });
});

describe('inferStage', () => {
  it('infers reading_issue from issue view output', () => {
    expect(inferStage('Reading issue #123...')).toBe(RunStage.ReadingIssue);
    expect(inferStage('gh issue view 456')).toBe(RunStage.ReadingIssue);
  });

  it('infers coding from file editing', () => {
    expect(inferStage('Editing file src/main.ts')).toBe(RunStage.Coding);
    expect(inferStage('Creating file config.json')).toBe(RunStage.Coding);
    expect(inferStage('Implementing the feature')).toBe(RunStage.Coding);
  });

  it('infers testing from test runs', () => {
    expect(inferStage('Running tests...')).toBe(RunStage.Testing);
    expect(inferStage('vitest run tests/')).toBe(RunStage.Testing);
    expect(inferStage('Tests passed: 42/42')).toBe(RunStage.Testing);
  });

  it('infers creating_pr from push/PR commands', () => {
    expect(inferStage('Creating pull request')).toBe(RunStage.CreatingPr);
    expect(inferStage('gh pr create --title "Fix"')).toBe(RunStage.CreatingPr);
    expect(inferStage('git push -u origin issue/123')).toBe(RunStage.CreatingPr);
  });

  it('infers reviewing from review activity', () => {
    expect(inferStage('Running Codex review')).toBe(RunStage.Reviewing);
    expect(inferStage('Security review in progress')).toBe(RunStage.Reviewing);
  });

  it('infers waiting_review from pending reviews', () => {
    expect(inferStage('Waiting for review approval')).toBe(RunStage.WaitingReview);
    expect(inferStage('Review pending from maintainer')).toBe(RunStage.WaitingReview);
  });

  it('infers planning from design discussions', () => {
    expect(inferStage('Planning the approach')).toBe(RunStage.Planning);
    expect(inferStage('Architecture decision')).toBe(RunStage.Planning);
  });

  it('returns undefined for unrecognized output', () => {
    expect(inferStage('Hello world')).toBeUndefined();
    expect(inferStage('')).toBeUndefined();
  });
});

describe('classifyFailure', () => {
  it('classifies SSH failures', () => {
    expect(classifyFailure('SSH connection lost')).toBe(FailureClass.SshLost);
    expect(classifyFailure('connection reset by peer')).toBe(FailureClass.SshLost);
    expect(classifyFailure('broken pipe error')).toBe(FailureClass.SshLost);
  });

  it('classifies Docker failures', () => {
    expect(classifyFailure('Docker daemon not running')).toBe(FailureClass.DockerUnavailable);
    expect(classifyFailure('Container failed to start')).toBe(FailureClass.DockerUnavailable);
    expect(classifyFailure('devcontainer up failed')).toBe(FailureClass.DockerUnavailable);
  });

  it('classifies rate limit failures', () => {
    expect(classifyFailure('GitHub rate limit exceeded')).toBe(FailureClass.RateLimited);
    expect(classifyFailure('HTTP 429 Too Many Requests')).toBe(FailureClass.RateLimited);
  });

  it('classifies disk full failures', () => {
    expect(classifyFailure('No space left on device')).toBe(FailureClass.DiskFull);
    expect(classifyFailure('ENOSPC write error')).toBe(FailureClass.DiskFull);
  });

  it('classifies credential failures', () => {
    expect(classifyFailure('1Password CLI not authenticated')).toBe(FailureClass.CredentialsUnavailable);
    expect(classifyFailure('Credential not found: op://vault/item')).toBe(FailureClass.CredentialsUnavailable);
  });

  it('classifies budget exceeded', () => {
    expect(classifyFailure('Daily budget exceeded')).toBe(FailureClass.BudgetExceeded);
  });

  it('classifies agent loop', () => {
    expect(classifyFailure('Agent loop detected')).toBe(FailureClass.AgentLoop);
    expect(classifyFailure('Repeated pattern in output')).toBe(FailureClass.AgentLoop);
  });

  it('classifies diverged base', () => {
    expect(classifyFailure('Branch has diverged from main')).toBe(FailureClass.DivergedBase);
    expect(classifyFailure('Merge conflict detected')).toBe(FailureClass.DivergedBase);
  });

  it('classifies context overflow', () => {
    expect(classifyFailure('Context window exceeded')).toBe(FailureClass.ContextOverflow);
    expect(classifyFailure('Context length limit reached')).toBe(FailureClass.ContextOverflow);
  });

  it('classifies by error code when message is ambiguous', () => {
    expect(classifyFailure('Unknown error', 'ssh_lost')).toBe(FailureClass.SshLost);
    expect(classifyFailure('Unknown error', 'disk_full')).toBe(FailureClass.DiskFull);
  });

  it('returns undefined for unclassifiable errors', () => {
    expect(classifyFailure('Something went wrong')).toBeUndefined();
    expect(classifyFailure('')).toBeUndefined();
  });
});
