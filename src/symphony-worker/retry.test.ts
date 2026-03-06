/**
 * Unit tests for Retry, Backoff & Self-Healing.
 * Issue #2201 — Retry, Backoff & Self-Healing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateRetryDelay,
  calculateContinuationWait,
  shouldPauseForNoProgress,
  MAX_CONTINUATIONS_WITHOUT_PROGRESS,
  checkRetryEligibility,
  checkBudget,
  estimateTokenUsage,
  DEFAULT_BUDGET_LIMITS,
  CircuitBreaker,
  CircuitState,
  probeHostHealth,
  checkGitHubRateLimit,
  tryAcquireRecoverySweepLock,
  releaseRecoverySweepLock,
  RECOVERY_SWEEP_LOCK_ID,
  snapshotConfigVersion,
  classifyConfigChange,
  checkDiskSpace,
  MIN_DISK_FREE_BYTES,
  detectSubstantialEdit,
  persistCircuitBreakerState,
  loadCircuitBreakerState,
} from './retry.ts';
import type {
  BudgetLimits,
  CircuitBreakerConfig,
  CircuitBreakerState,
  IssueSnapshot,
} from './retry.ts';
import { FailureClass } from '../symphony/states.ts';

// ─── Test helpers ───

function createMockPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ total: '0' }], rowCount: 0 }),
  };
}

function createMockClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ acquired: true }], rowCount: 0 }),
  };
}

// ─── Retry Backoff ───

describe('calculateRetryDelay', () => {
  it('returns base delay for attempt 1 with jitter=1.0', () => {
    const delay = calculateRetryDelay(1, 10_000, 300_000, () => 1.0);
    // 10000 * 2^0 * (0.5 + 1.0 * 0.5) = 10000 * 1.0 = 10000
    expect(delay).toBe(10_000);
  });

  it('doubles delay for each subsequent attempt', () => {
    // Use fixed random to get predictable results
    const fixed = () => 1.0;
    const d1 = calculateRetryDelay(1, 10_000, 300_000, fixed); // 10000 * 1.0 = 10000
    const d2 = calculateRetryDelay(2, 10_000, 300_000, fixed); // 20000 * 1.0 = 20000
    const d3 = calculateRetryDelay(3, 10_000, 300_000, fixed); // 40000 * 1.0 = 40000

    expect(d2).toBe(d1 * 2);
    expect(d3).toBe(d2 * 2);
  });

  it('caps delay at maximum', () => {
    const delay = calculateRetryDelay(20, 10_000, 300_000, () => 1.0);
    expect(delay).toBeLessThanOrEqual(300_000);
  });

  it('applies jitter in range [0.5, 1.0]', () => {
    // With random() = 0 → jitter = 0.5
    const minDelay = calculateRetryDelay(1, 10_000, 300_000, () => 0);
    expect(minDelay).toBe(5_000); // 10000 * 0.5

    // With random() = 1.0 → jitter = 1.0
    const maxDelay = calculateRetryDelay(1, 10_000, 300_000, () => 1.0);
    expect(maxDelay).toBe(10_000); // 10000 * 1.0
  });

  it('prevents herd effects with randomized jitter', () => {
    // Run 100 calculations — they should not all be the same
    const delays = new Set<number>();
    for (let i = 0; i < 100; i++) {
      delays.add(calculateRetryDelay(3));
    }
    // With real random, we expect significant variation
    expect(delays.size).toBeGreaterThan(1);
  });

  it('handles attempt < 1 gracefully', () => {
    const delay = calculateRetryDelay(0, 10_000, 300_000, () => 1.0);
    expect(delay).toBe(10_000); // returns base delay
  });

  it('clamps out-of-range random values to [0,1]', () => {
    // randomFn returns > 1 should be clamped
    const overDelay = calculateRetryDelay(1, 10_000, 300_000, () => 2.0);
    expect(overDelay).toBe(10_000); // max jitter = 1.0

    // randomFn returns < 0 should be clamped
    const underDelay = calculateRetryDelay(1, 10_000, 300_000, () => -1.0);
    expect(underDelay).toBe(5_000); // min jitter = 0.5
  });
});

// ─── Continuation Wait Backoff ───

describe('calculateContinuationWait', () => {
  it('returns base wait for first continuation', () => {
    expect(calculateContinuationWait(1)).toBe(30_000); // 30s
  });

  it('doubles for each continuation', () => {
    expect(calculateContinuationWait(2)).toBe(60_000);  // 1 min
    expect(calculateContinuationWait(3)).toBe(120_000); // 2 min
    expect(calculateContinuationWait(4)).toBe(240_000); // 4 min
  });

  it('caps at 30 minutes', () => {
    const wait = calculateContinuationWait(20);
    expect(wait).toBeLessThanOrEqual(1_800_000);
    expect(wait).toBe(1_800_000); // 30 min cap
  });

  it('handles count < 1 gracefully', () => {
    expect(calculateContinuationWait(0)).toBe(30_000);
  });
});

// ─── No-Progress Gate ───

describe('shouldPauseForNoProgress', () => {
  it('does not pause below threshold', () => {
    expect(shouldPauseForNoProgress(0)).toBe(false);
    expect(shouldPauseForNoProgress(1)).toBe(false);
    expect(shouldPauseForNoProgress(2)).toBe(false);
  });

  it('pauses at threshold', () => {
    expect(shouldPauseForNoProgress(MAX_CONTINUATIONS_WITHOUT_PROGRESS)).toBe(true);
  });

  it('pauses above threshold', () => {
    expect(shouldPauseForNoProgress(10)).toBe(true);
  });
});

// ─── Retry Eligibility ───

describe('checkRetryEligibility', () => {
  it('allows retry for SSH failure within limit', () => {
    const result = checkRetryEligibility(FailureClass.SshLost, 0);
    expect(result.canRetry).toBe(true);
    expect(result.maxRetries).toBe(3);
    expect(result.recovery).toBe('retry_same_host');
    expect(result.delay).toBeGreaterThan(0);
  });

  it('denies retry when max attempts reached', () => {
    const result = checkRetryEligibility(FailureClass.SshLost, 3);
    expect(result.canRetry).toBe(false);
  });

  it('allows unlimited retries for rate limited', () => {
    const result = checkRetryEligibility(FailureClass.RateLimited, 100);
    expect(result.canRetry).toBe(true);
    expect(result.maxRetries).toBe(Infinity);
  });

  it('never retries disk full', () => {
    const result = checkRetryEligibility(FailureClass.DiskFull, 0);
    expect(result.canRetry).toBe(false);
    expect(result.maxRetries).toBe(0);
  });

  it('never retries budget exceeded', () => {
    const result = checkRetryEligibility(FailureClass.BudgetExceeded, 0);
    expect(result.canRetry).toBe(false);
    expect(result.recovery).toBe('pause');
  });

  it('allows 1 retry for context overflow with feedback', () => {
    const result = checkRetryEligibility(FailureClass.ContextOverflow, 0);
    expect(result.canRetry).toBe(true);
    expect(result.maxRetries).toBe(1);
    expect(result.recovery).toBe('retry_with_feedback');
  });

  it('denies retry for context overflow on second attempt', () => {
    const result = checkRetryEligibility(FailureClass.ContextOverflow, 1);
    expect(result.canRetry).toBe(false);
  });
});

// ─── Budget Enforcement ───

describe('checkBudget', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
  });

  it('allows when all limits are zero (unlimited)', async () => {
    const result = await checkBudget(
      pool as never,
      'ns',
      'run1',
      'proj1',
      DEFAULT_BUDGET_LIMITS,
      50_000,
    );
    expect(result.allowed).toBe(true);
  });

  it('denies when per-run limit exceeded', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ total: '90000' }] });

    const limits: BudgetLimits = {
      perRunTokenLimit: 100_000,
      perProjectDailyBudget: 0,
      globalDailyBudget: 0,
    };

    const result = await checkBudget(
      pool as never,
      'ns',
      'run1',
      'proj1',
      limits,
      20_000,
    );
    expect(result.allowed).toBe(false);
    expect(result.level).toBe('per_run');
  });

  it('denies when per-project daily budget exceeded', async () => {
    // Run usage check passes
    pool.query.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    // Project daily usage exceeds limit
    pool.query.mockResolvedValueOnce({ rows: [{ total: '450000' }] });

    const limits: BudgetLimits = {
      perRunTokenLimit: 100_000,
      perProjectDailyBudget: 500_000,
      globalDailyBudget: 0,
    };

    const result = await checkBudget(
      pool as never,
      'ns',
      'run1',
      'proj1',
      limits,
      60_000,
    );
    expect(result.allowed).toBe(false);
    expect(result.level).toBe('per_project');
  });

  it('denies when global daily budget exceeded', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    pool.query.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    pool.query.mockResolvedValueOnce({ rows: [{ total: '950000' }] });

    const limits: BudgetLimits = {
      perRunTokenLimit: 100_000,
      perProjectDailyBudget: 500_000,
      globalDailyBudget: 1_000_000,
    };

    const result = await checkBudget(
      pool as never,
      'ns',
      'run1',
      'proj1',
      limits,
      60_000,
    );
    expect(result.allowed).toBe(false);
    expect(result.level).toBe('global');
  });

  it('allows when all levels have budget remaining', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ total: '10000' }] });
    pool.query.mockResolvedValueOnce({ rows: [{ total: '100000' }] });
    pool.query.mockResolvedValueOnce({ rows: [{ total: '200000' }] });

    const limits: BudgetLimits = {
      perRunTokenLimit: 100_000,
      perProjectDailyBudget: 500_000,
      globalDailyBudget: 1_000_000,
    };

    const result = await checkBudget(
      pool as never,
      'ns',
      'run1',
      'proj1',
      limits,
      50_000,
    );
    expect(result.allowed).toBe(true);
  });
});

describe('estimateTokenUsage', () => {
  it('returns historical average', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({ rows: [{ avg_tokens: '75000' }] });

    const estimate = await estimateTokenUsage(pool as never, 'ns', 'proj1');
    expect(estimate).toBe(75_000);
  });

  it('returns default 50000 when no history', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({ rows: [{ avg_tokens: '50000' }] });

    const estimate = await estimateTokenUsage(pool as never, 'ns', 'proj1');
    expect(estimate).toBe(50_000);
  });
});

// ─── Circuit Breaker ───

describe('CircuitBreaker', () => {
  const defaultConfig: CircuitBreakerConfig = {
    breakerId: 'test-host',
    failureThreshold: 3,
    recoveryTimeoutMs: 600_000, // 10 min
    successThreshold: 2,
  };

  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker(defaultConfig);
  });

  it('starts in closed state', () => {
    expect(breaker.getState()).toBe(CircuitState.Closed);
  });

  it('allows requests in closed state', () => {
    expect(breaker.isAllowed()).toBe(true);
  });

  it('opens after failure threshold', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.Closed);

    breaker.recordFailure(); // 3rd failure
    expect(breaker.getState()).toBe(CircuitState.Open);
  });

  it('blocks requests in open state', () => {
    // Force open
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    expect(breaker.isAllowed(Date.now())).toBe(false);
  });

  it('transitions to half-open after recovery timeout', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.Open);

    // Advance time past recovery timeout
    const futureMs = Date.now() + 600_001;
    expect(breaker.isAllowed(futureMs)).toBe(true);
    expect(breaker.getState()).toBe(CircuitState.HalfOpen);
  });

  it('closes after success threshold in half-open', () => {
    // Open the circuit
    for (let i = 0; i < 3; i++) breaker.recordFailure();

    // Transition to half-open
    breaker.isAllowed(Date.now() + 600_001);

    // 2 consecutive successes close it
    breaker.recordSuccess();
    expect(breaker.getState()).toBe(CircuitState.HalfOpen);
    breaker.recordSuccess();
    expect(breaker.getState()).toBe(CircuitState.Closed);
  });

  it('re-opens on failure in half-open state', () => {
    // Open → half-open
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    breaker.isAllowed(Date.now() + 600_001);
    expect(breaker.getState()).toBe(CircuitState.HalfOpen);

    // Probe fails → back to open
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.Open);
  });

  it('only allows one probe at a time in half-open (thundering-herd prevention)', () => {
    // Open the circuit
    for (let i = 0; i < 3; i++) breaker.recordFailure();

    // Transition to half-open
    const future = Date.now() + 600_001;
    expect(breaker.isAllowed(future)).toBe(true); // First probe allowed
    expect(breaker.getState()).toBe(CircuitState.HalfOpen);

    // Second concurrent probe should be blocked
    expect(breaker.isAllowed(future + 1)).toBe(false);

    // After recording result, next probe allowed
    breaker.recordSuccess();
    expect(breaker.isAllowed(future + 2)).toBe(true);
  });

  it('resets failure count on success in closed state', () => {
    breaker.recordFailure();
    breaker.recordFailure(); // 2 failures
    breaker.recordSuccess(); // Reset

    // Now needs 3 more failures to open
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.Closed);
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.Open);
  });

  it('serializes and restores state', () => {
    breaker.recordFailure();
    breaker.recordFailure();

    const state = breaker.getFullState();
    expect(state.breakerId).toBe('test-host');
    expect(state.failureCount).toBe(2);

    const newBreaker = new CircuitBreaker(defaultConfig);
    newBreaker.restoreState(state);
    expect(newBreaker.getFullState().failureCount).toBe(2);

    // One more failure should open it
    newBreaker.recordFailure();
    expect(newBreaker.getState()).toBe(CircuitState.Open);
  });
});

// ─── Host Health Probe ───

describe('probeHostHealth', () => {
  it('returns healthy when SSH and disk are OK', async () => {
    const result = await probeHostHealth(
      async () => true,
      async () => 10 * 1024 * 1024 * 1024, // 10GB
    );
    expect(result.healthy).toBe(true);
    expect(result.sshOk).toBe(true);
    expect(result.diskOk).toBe(true);
  });

  it('returns unhealthy when SSH fails', async () => {
    const result = await probeHostHealth(
      async () => false,
      async () => 10 * 1024 * 1024 * 1024,
    );
    expect(result.healthy).toBe(false);
    expect(result.sshOk).toBe(false);
  });

  it('returns unhealthy when disk is low', async () => {
    const result = await probeHostHealth(
      async () => true,
      async () => 1 * 1024 * 1024 * 1024, // 1GB < 5GB threshold
    );
    expect(result.healthy).toBe(false);
    expect(result.sshOk).toBe(true);
    expect(result.diskOk).toBe(false);
  });

  it('skips disk check when SSH fails', async () => {
    const diskCheck = vi.fn().mockResolvedValue(10 * 1024 * 1024 * 1024);
    const result = await probeHostHealth(
      async () => { throw new Error('SSH timeout'); },
      diskCheck,
    );
    expect(result.sshOk).toBe(false);
    expect(diskCheck).not.toHaveBeenCalled();
  });
});

// ─── GitHub Rate Limit Circuit Breaker ───

describe('checkGitHubRateLimit', () => {
  it('allows when remaining > reserve', () => {
    const now = Date.now();
    const result = checkGitHubRateLimit(500, now / 1000 + 3600, 100, now);
    expect(result.allowed).toBe(true);
    expect(result.waitMs).toBe(0);
  });

  it('blocks when remaining <= reserve', () => {
    const now = Date.now();
    const resetEpoch = Math.floor(now / 1000) + 600; // 10 min from now
    const result = checkGitHubRateLimit(50, resetEpoch, 100, now);
    expect(result.allowed).toBe(false);
    expect(result.waitMs).toBeGreaterThan(0);
    expect(result.waitMs).toBeLessThanOrEqual(600_000);
  });

  it('returns 0 waitMs when reset is in the past', () => {
    const now = Date.now();
    const resetEpoch = Math.floor(now / 1000) - 60; // 1 min ago
    const result = checkGitHubRateLimit(0, resetEpoch, 100, now);
    expect(result.allowed).toBe(false);
    expect(result.waitMs).toBe(0);
  });
});

// ─── Recovery Sweep Advisory Lock (X9) ───

describe('tryAcquireRecoverySweepLock', () => {
  it('returns true when lock acquired', async () => {
    const client = createMockClient();
    client.query.mockResolvedValueOnce({ rows: [{ acquired: true }] });

    const acquired = await tryAcquireRecoverySweepLock(client as never);
    expect(acquired).toBe(true);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_try_advisory_lock'),
      [RECOVERY_SWEEP_LOCK_ID],
    );
  });

  it('returns false when lock not acquired (another sweep running)', async () => {
    const client = createMockClient();
    client.query.mockResolvedValueOnce({ rows: [{ acquired: false }] });

    const acquired = await tryAcquireRecoverySweepLock(client as never);
    expect(acquired).toBe(false);
  });
});

describe('releaseRecoverySweepLock', () => {
  it('releases the lock', async () => {
    const client = createMockClient();
    await releaseRecoverySweepLock(client as never);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      [RECOVERY_SWEEP_LOCK_ID],
    );
  });
});

// ─── Config Version Snapshotting ───

describe('snapshotConfigVersion', () => {
  it('updates the run with config version', async () => {
    const pool = createMockPool();
    await snapshotConfigVersion(pool as never, 'run-123', 5);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('config_version'),
      [5, 'run-123'],
    );
  });
});

describe('classifyConfigChange', () => {
  it('detects budget-only changes', () => {
    const result = classifyConfigChange(
      { perRunTokenLimit: 100000 },
      { perRunTokenLimit: 200000 },
    );
    expect(result.budgetOnly).toBe(true);
    expect(result.structural).toBe(false);
    expect(result.changedKeys).toContain('perRunTokenLimit');
  });

  it('detects structural changes', () => {
    const result = classifyConfigChange(
      { maxConcurrentRuns: 3 },
      { maxConcurrentRuns: 5 },
    );
    expect(result.structural).toBe(true);
    expect(result.budgetOnly).toBe(false);
  });

  it('detects no changes', () => {
    const result = classifyConfigChange(
      { maxConcurrentRuns: 3, perRunTokenLimit: 100000 },
      { maxConcurrentRuns: 3, perRunTokenLimit: 100000 },
    );
    expect(result.changedKeys.length).toBe(0);
    expect(result.budgetOnly).toBe(false);
    expect(result.structural).toBe(false);
  });

  it('detects mixed changes correctly', () => {
    const result = classifyConfigChange(
      { maxConcurrentRuns: 3, perRunTokenLimit: 100000 },
      { maxConcurrentRuns: 5, perRunTokenLimit: 200000 },
    );
    expect(result.structural).toBe(true);
    expect(result.changedKeys).toContain('maxConcurrentRuns');
    expect(result.changedKeys).toContain('perRunTokenLimit');
  });
});

// ─── Disk Monitoring ───

describe('checkDiskSpace', () => {
  it('returns ok when above threshold', async () => {
    const result = await checkDiskSpace(
      async () => 10 * 1024 * 1024 * 1024, // 10GB
    );
    expect(result.ok).toBe(true);
  });

  it('returns not ok when below threshold', async () => {
    const result = await checkDiskSpace(
      async () => 1 * 1024 * 1024 * 1024, // 1GB
    );
    expect(result.ok).toBe(false);
    expect(result.threshold).toBe(MIN_DISK_FREE_BYTES);
  });

  it('uses custom threshold', async () => {
    const result = await checkDiskSpace(
      async () => 2 * 1024 * 1024 * 1024, // 2GB
      1 * 1024 * 1024 * 1024, // 1GB threshold
    );
    expect(result.ok).toBe(true);
  });
});

// ─── Issue Edit Detection ───

describe('detectSubstantialEdit', () => {
  const baseSnapshot: IssueSnapshot = {
    title: 'Fix login bug',
    body: '## Acceptance Criteria\n- [ ] Login works\n- [ ] Tests pass',
    labels: ['bug', 'p1'],
    assignees: ['alice'],
  };

  it('detects no change', () => {
    const result = detectSubstantialEdit(baseSnapshot, { ...baseSnapshot });
    expect(result.isSubstantial).toBe(false);
    expect(result.changedFields.length).toBe(0);
  });

  it('detects title change as substantial (default sensitivity)', () => {
    const result = detectSubstantialEdit(baseSnapshot, {
      ...baseSnapshot,
      title: 'Fix auth bug',
    });
    expect(result.isSubstantial).toBe(true);
    expect(result.changedFields).toContain('title');
  });

  it('detects acceptance criteria change as substantial', () => {
    const result = detectSubstantialEdit(baseSnapshot, {
      ...baseSnapshot,
      body: '## Acceptance Criteria\n- [ ] Login works\n- [ ] Tests pass\n- [ ] Logout works',
    });
    expect(result.isSubstantial).toBe(true);
    expect(result.changedFields).toContain('body');
  });

  it('ignores body formatting changes outside AC section (default sensitivity)', () => {
    const prevWithContext: IssueSnapshot = {
      ...baseSnapshot,
      body: '## Context\nSome background.\n\n## Acceptance Criteria\n- [ ] Login works\n- [ ] Tests pass\n\n## Notes\nOld notes.',
    };
    const currWithContext: IssueSnapshot = {
      ...baseSnapshot,
      body: '## Context\nUpdated background text.\n\n## Acceptance Criteria\n- [ ] Login works\n- [ ] Tests pass\n\n## Notes\nNew notes with typo fix.',
    };
    const result = detectSubstantialEdit(prevWithContext, currWithContext);
    // Body changed but AC section is identical
    expect(result.changedFields).toContain('body');
    expect(result.isSubstantial).toBe(false);
  });

  it('detects label changes as substantial (default sensitivity)', () => {
    const result = detectSubstantialEdit(baseSnapshot, {
      ...baseSnapshot,
      labels: ['bug', 'p2'],
    });
    expect(result.isSubstantial).toBe(true);
    expect(result.changedFields).toContain('labels');
  });

  it('detects assignee changes as substantial (default sensitivity)', () => {
    const result = detectSubstantialEdit(baseSnapshot, {
      ...baseSnapshot,
      assignees: ['bob'],
    });
    expect(result.isSubstantial).toBe(true);
    expect(result.changedFields).toContain('assignees');
  });

  it('respects any_body_change sensitivity', () => {
    const result = detectSubstantialEdit(
      baseSnapshot,
      { ...baseSnapshot, body: baseSnapshot.body + '\ntypo fix' },
      'any_body_change',
    );
    expect(result.isSubstantial).toBe(true);
  });

  it('respects labels_only sensitivity', () => {
    const result = detectSubstantialEdit(
      baseSnapshot,
      { ...baseSnapshot, title: 'New title', labels: [...baseSnapshot.labels] },
      'labels_only',
    );
    // Title changed but labels didn't — not substantial in labels_only mode
    expect(result.isSubstantial).toBe(false);
  });

  it('detects AC changes at end of body (no trailing section)', () => {
    const prev: IssueSnapshot = {
      title: 'Test',
      body: '## Acceptance Criteria\n- [ ] Item A',
      labels: [],
      assignees: [],
    };
    const curr: IssueSnapshot = {
      title: 'Test',
      body: '## Acceptance Criteria\n- [ ] Item A\n- [ ] Item B',
      labels: [],
      assignees: [],
    };
    const result = detectSubstantialEdit(prev, curr);
    expect(result.isSubstantial).toBe(true);
  });

  it('respects all sensitivity', () => {
    const result = detectSubstantialEdit(
      baseSnapshot,
      { ...baseSnapshot, assignees: ['bob'] },
      'all',
    );
    expect(result.isSubstantial).toBe(true);
  });
});

// ─── Circuit Breaker Persistence ───

describe('persistCircuitBreakerState', () => {
  it('upserts state to database', async () => {
    const pool = createMockPool();
    const state: CircuitBreakerState = {
      breakerId: 'host-1',
      state: CircuitState.Open,
      failureCount: 3,
      successCount: 0,
      lastFailureAt: new Date(),
      lastSuccessAt: null,
      lastTransitionAt: new Date(),
    };

    await persistCircuitBreakerState(pool as never, 'ns', state);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO symphony_circuit_breaker'),
      expect.arrayContaining(['ns', 'host-1', CircuitState.Open]),
    );
  });
});

describe('loadCircuitBreakerState', () => {
  it('returns null when no state exists', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({ rows: [] });

    const state = await loadCircuitBreakerState(pool as never, 'ns', 'host-1');
    expect(state).toBeNull();
  });

  it('defaults invalid persisted state to closed', async () => {
    const pool = createMockPool();
    const now = new Date();
    pool.query.mockResolvedValueOnce({
      rows: [{
        breaker_id: 'host-1',
        state: 'invalid_state_value',
        failure_count: 1,
        success_count: 0,
        last_failure_at: now,
        last_success_at: null,
        last_transition_at: now,
      }],
    });

    const state = await loadCircuitBreakerState(pool as never, 'ns', 'host-1');
    expect(state).not.toBeNull();
    expect(state!.state).toBe(CircuitState.Closed);
  });

  it('returns persisted state', async () => {
    const pool = createMockPool();
    const now = new Date();
    pool.query.mockResolvedValueOnce({
      rows: [{
        breaker_id: 'host-1',
        state: 'open',
        failure_count: 3,
        success_count: 0,
        last_failure_at: now,
        last_success_at: null,
        last_transition_at: now,
      }],
    });

    const state = await loadCircuitBreakerState(pool as never, 'ns', 'host-1');
    expect(state).not.toBeNull();
    expect(state!.breakerId).toBe('host-1');
    expect(state!.state).toBe(CircuitState.Open);
    expect(state!.failureCount).toBe(3);
  });
});
