/**
 * Unit tests for Result Verification & Merge Governance.
 * Issue #2200 — Result Verification & Merge Governance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  aggregateCIChecks,
  analyzeGitDivergence,
  detectMigrationFiles,
  resolveApprovalToken,
  determineApprovalAction,
  classifyMergeFailure,
  decideRevert,
  formatBotComment,
  isSymphonyComment,
  SYMPHONY_BOT_MARKER,
  generateCloseComment,
  createApprovalEventMetadata,
  getContainerPhase,
  DEFAULT_CONTAINER_TTL,
  DEFAULT_VERIFICATION_CONFIG,
} from './verify.ts';
import type {
  CIStatus,
  ApprovalType,
  AutoApprovePolicy,
  ContainerTTLConfig,
} from './verify.ts';

// ─── CI Status Checking ───

describe('aggregateCIChecks', () => {
  it('returns not_found for empty checks array', () => {
    const result = aggregateCIChecks([]);
    expect(result.status).toBe('not_found');
    expect(result.allPassing).toBe(false);
    expect(result.hasPending).toBe(false);
  });

  it('returns success when all checks pass', () => {
    const result = aggregateCIChecks([
      { name: 'build', status: 'success' },
      { name: 'test', status: 'success' },
      { name: 'lint', status: 'success' },
    ]);
    expect(result.status).toBe('success');
    expect(result.allPassing).toBe(true);
    expect(result.hasPending).toBe(false);
  });

  it('returns failure when any check fails', () => {
    const result = aggregateCIChecks([
      { name: 'build', status: 'success' },
      { name: 'test', status: 'failure' },
      { name: 'lint', status: 'success' },
    ]);
    expect(result.status).toBe('failure');
    expect(result.allPassing).toBe(false);
  });

  it('returns pending when checks are pending and none failed', () => {
    const result = aggregateCIChecks([
      { name: 'build', status: 'success' },
      { name: 'test', status: 'pending' },
    ]);
    expect(result.status).toBe('pending');
    expect(result.hasPending).toBe(true);
    expect(result.allPassing).toBe(false);
  });

  it('returns failure over pending when both present', () => {
    const result = aggregateCIChecks([
      { name: 'build', status: 'failure' },
      { name: 'test', status: 'pending' },
    ]);
    expect(result.status).toBe('failure');
  });

  it('includes check URLs', () => {
    const result = aggregateCIChecks([
      { name: 'build', status: 'success', url: 'https://ci.example.com/1' },
    ]);
    expect(result.checks[0].url).toBe('https://ci.example.com/1');
  });
});

// ─── Git Health Check ───

describe('analyzeGitDivergence', () => {
  it('detects up-to-date branch', () => {
    const result = analyzeGitDivergence(5, 0, 'abc123', 'def456');
    expect(result.upToDate).toBe(true);
    expect(result.diverged).toBe(false);
    expect(result.aheadCount).toBe(5);
  });

  it('detects diverged branch', () => {
    const result = analyzeGitDivergence(5, 3, 'abc123', 'def456');
    expect(result.diverged).toBe(true);
    expect(result.upToDate).toBe(false);
    expect(result.behindCount).toBe(3);
  });

  it('handles null merge-base', () => {
    const result = analyzeGitDivergence(0, 0, null, null);
    expect(result.upToDate).toBe(true);
    expect(result.mergeBase).toBeNull();
  });
});

// ─── Migration File Detection (P2-12) ───

describe('detectMigrationFiles', () => {
  it('detects files in migrations directory', () => {
    const result = detectMigrationFiles([
      'src/app.ts',
      'src/db/migrations/001_create_users.sql',
    ]);
    expect(result.hasMigrations).toBe(true);
    expect(result.migrationFiles).toContain('src/db/migrations/001_create_users.sql');
  });

  it('detects files in migrate directory', () => {
    const result = detectMigrationFiles([
      'src/app.ts',
      'db/migrate/20240101_add_column.ts',
    ]);
    expect(result.hasMigrations).toBe(true);
  });

  it('detects standalone SQL files', () => {
    const result = detectMigrationFiles([
      'src/app.ts',
      'schema.sql',
    ]);
    expect(result.hasMigrations).toBe(true);
    expect(result.migrationFiles).toContain('schema.sql');
  });

  it('returns false when no migration files', () => {
    const result = detectMigrationFiles([
      'src/app.ts',
      'src/utils/helper.ts',
      'tests/app.test.ts',
    ]);
    expect(result.hasMigrations).toBe(false);
    expect(result.migrationFiles.length).toBe(0);
  });

  it('handles empty file list', () => {
    const result = detectMigrationFiles([]);
    expect(result.hasMigrations).toBe(false);
  });

  it('detects uppercase SQL extensions', () => {
    const result = detectMigrationFiles([
      'src/app.ts',
      'DB/MIGRATIONS/001_ADD_TABLE.SQL',
    ]);
    expect(result.hasMigrations).toBe(true);
    expect(result.migrationFiles.length).toBeGreaterThan(0);
  });
});

// ─── Auto-Approve (P2-11) ───

describe('resolveApprovalToken', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('resolves token from environment variable', () => {
    process.env.SYMPHONY_APPROVAL_TOKEN = 'ghp_test_token';
    const token = resolveApprovalToken('SYMPHONY_APPROVAL_TOKEN');
    expect(token).toBe('ghp_test_token');
  });

  it('returns null when env var not set', () => {
    delete process.env.SYMPHONY_APPROVAL_TOKEN;
    const token = resolveApprovalToken('SYMPHONY_APPROVAL_TOKEN');
    expect(token).toBeNull();
  });

  it('SECURITY: rejects hardcoded personal token names', () => {
    expect(() => resolveApprovalToken('GITHUB_TOKEN_TROY')).toThrow('SECURITY');
    expect(() => resolveApprovalToken('GITHUB_TOKEN_ALICE')).toThrow('SECURITY');
    expect(() => resolveApprovalToken('GITHUB_TOKEN_BOB')).toThrow('SECURITY');
  });

  it('allows generic token reference names', () => {
    process.env.MY_APPROVAL_TOKEN = 'test';
    expect(() => resolveApprovalToken('MY_APPROVAL_TOKEN')).not.toThrow();
    expect(() => resolveApprovalToken('SYMPHONY_APPROVAL_TOKEN')).not.toThrow();
  });

  it('SECURITY: rejects case-insensitive personal token name variants', () => {
    expect(() => resolveApprovalToken('github_token_troy')).toThrow('SECURITY');
    expect(() => resolveApprovalToken('Github_Token_Bob')).toThrow('SECURITY');
  });
});

// ─── Approval Action (P2-13) ───

describe('determineApprovalAction', () => {
  it('approves for auto_approve_safe policy on pr_review', () => {
    expect(determineApprovalAction('auto_approve_safe', 'pr_review')).toBe('approve');
  });

  it('cancels for auto_cancel policy on pr_review', () => {
    expect(determineApprovalAction('auto_cancel', 'pr_review')).toBe('cancel');
  });

  it('escalates for escalate policy on pr_review', () => {
    expect(determineApprovalAction('escalate', 'pr_review')).toBe('escalate');
  });

  it('always escalates for agent_action regardless of policy', () => {
    expect(determineApprovalAction('auto_approve_safe', 'agent_action')).toBe('escalate');
    expect(determineApprovalAction('auto_cancel', 'agent_action')).toBe('escalate');
  });

  it('always escalates for branch_protection regardless of policy', () => {
    expect(determineApprovalAction('auto_approve_safe', 'branch_protection')).toBe('escalate');
  });
});

// ─── Merge Failure Classification ───

describe('classifyMergeFailure', () => {
  it('detects merge conflicts', () => {
    expect(classifyMergeFailure('Merge conflict in src/app.ts')).toBe('conflict');
    expect(classifyMergeFailure('PR cannot be merged due to conflicts')).toBe('conflict');
  });

  it('detects branch protection blocks', () => {
    expect(classifyMergeFailure('Branch protection rule requires review')).toBe('blocked');
    expect(classifyMergeFailure('Review required before merge')).toBe('blocked');
  });

  it('detects CI required checks', () => {
    expect(classifyMergeFailure('Required checks have not passed')).toBe('ci_required');
    expect(classifyMergeFailure('Required status checks are pending')).toBe('ci_required');
  });

  it('returns unknown for unrecognized errors', () => {
    expect(classifyMergeFailure('Some random error')).toBe('unknown');
  });
});

// ─── Post-Merge Revert Decision (P2-12) ───

describe('decideRevert', () => {
  it('allows revert when no migration files', () => {
    const result = decideRevert(['src/app.ts', 'tests/app.test.ts']);
    expect(result.shouldRevert).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('blocks revert when migration files present', () => {
    const result = decideRevert([
      'src/app.ts',
      'src/db/migrations/001_add_column.sql',
    ]);
    expect(result.shouldRevert).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('migration files');
    expect(result.migrationFiles).toContain('src/db/migrations/001_add_column.sql');
  });

  it('blocks revert for SQL files', () => {
    const result = decideRevert(['src/app.ts', 'schema.sql']);
    expect(result.shouldRevert).toBe(false);
    expect(result.blocked).toBe(true);
  });
});

// ─── Comment Consolidation (Codex finding) ───

describe('formatBotComment', () => {
  it('prepends bot marker', () => {
    const comment = formatBotComment('CI passed, merging...');
    expect(comment).toContain(SYMPHONY_BOT_MARKER);
    expect(comment).toContain('CI passed, merging...');
  });
});

describe('isSymphonyComment', () => {
  it('identifies Symphony comments', () => {
    const comment = formatBotComment('Test content');
    expect(isSymphonyComment(comment)).toBe(true);
  });

  it('rejects non-Symphony comments', () => {
    expect(isSymphonyComment('Regular comment')).toBe(false);
  });
});

describe('generateCloseComment', () => {
  it('generates close comment with PR reference', () => {
    const comment = generateCloseComment(42, 'run-123');
    expect(comment).toContain('#42');
    expect(comment).toContain('run-123');
    expect(isSymphonyComment(comment)).toBe(true);
  });
});

// ─── Approval Event Metadata (P2-13) ───

describe('createApprovalEventMetadata', () => {
  it('includes approval_type field', () => {
    const meta = createApprovalEventMetadata('pr_review', 'auto_approve_safe', 'approve');
    expect(meta.approval_type).toBe('pr_review');
    expect(meta.auto_approve_policy).toBe('auto_approve_safe');
    expect(meta.action).toBe('approve');
  });

  it('distinguishes agent_action type', () => {
    const meta = createApprovalEventMetadata('agent_action', 'escalate', 'escalate');
    expect(meta.approval_type).toBe('agent_action');
  });
});

// ─── Container TTL Grace Period ───

describe('getContainerPhase', () => {
  it('returns running phase when within normal time', () => {
    const result = getContainerPhase(10 * 60 * 1000); // 10 min
    expect(result.phase).toBe('running');
    expect(result.timeUntilNextPhaseMs).toBeGreaterThan(0);
  });

  it('returns warning phase near TTL', () => {
    // Default: warning at maxTtl - 15min = 45min
    const result = getContainerPhase(46 * 60 * 1000); // 46 min
    expect(result.phase).toBe('warning');
  });

  it('returns terminating phase very near TTL', () => {
    // Default: terminate at maxTtl - 5min = 55min
    const result = getContainerPhase(56 * 60 * 1000); // 56 min
    expect(result.phase).toBe('terminating');
  });

  it('returns force_kill phase past TTL + grace', () => {
    // Default: force kill at maxTtl + 2min = 62min
    const result = getContainerPhase(63 * 60 * 1000); // 63 min
    expect(result.phase).toBe('force_kill');
    expect(result.timeUntilNextPhaseMs).toBe(0);
  });

  it('calculates correct time until next phase', () => {
    const result = getContainerPhase(0, DEFAULT_CONTAINER_TTL);
    // Warning is at maxTtl - warningBefore = 60min - 15min = 45min
    expect(result.timeUntilNextPhaseMs).toBe(45 * 60 * 1000);
  });

  it('works with custom TTL config', () => {
    const config: ContainerTTLConfig = {
      maxTtlMs: 30 * 60 * 1000, // 30 min
      warningBeforeMs: 5 * 60 * 1000,
      terminateBeforeMs: 2 * 60 * 1000,
      forceKillAfterMs: 1 * 60 * 1000,
    };

    // At 26 min, should be in warning phase (warning at 25min)
    expect(getContainerPhase(26 * 60 * 1000, config).phase).toBe('warning');

    // At 29 min, should be terminating (terminate at 28min)
    expect(getContainerPhase(29 * 60 * 1000, config).phase).toBe('terminating');
  });
});

// ─── Default Config ───

describe('DEFAULT_VERIFICATION_CONFIG', () => {
  it('uses a generic approval token reference (P2-11)', () => {
    expect(DEFAULT_VERIFICATION_CONFIG.approvalTokenRef).not.toMatch(/GITHUB_TOKEN_[A-Z]+/);
    expect(DEFAULT_VERIFICATION_CONFIG.approvalTokenRef).toBe('SYMPHONY_APPROVAL_TOKEN');
  });

  it('has sensible defaults', () => {
    expect(DEFAULT_VERIFICATION_CONFIG.autoApprovePolicy).toBe('escalate');
    expect(DEFAULT_VERIFICATION_CONFIG.mergeStrategy).toBe('squash');
    expect(DEFAULT_VERIFICATION_CONFIG.notificationMode).toBe('quiet');
    expect(DEFAULT_VERIFICATION_CONFIG.codexReviewEnabled).toBe(true);
    expect(DEFAULT_VERIFICATION_CONFIG.codexReviewTimeoutMs).toBe(300_000);
    expect(DEFAULT_VERIFICATION_CONFIG.codexReviewMaxRetries).toBe(2);
  });

  it('no hardcoded personal token names in any code path', () => {
    // This test verifies P2-11: MUST NOT hardcode personal token names
    const configStr = JSON.stringify(DEFAULT_VERIFICATION_CONFIG);
    expect(configStr).not.toContain('GITHUB_TOKEN_TROY');
    expect(configStr).not.toContain('GITHUB_TOKEN_ALICE');
  });
});
