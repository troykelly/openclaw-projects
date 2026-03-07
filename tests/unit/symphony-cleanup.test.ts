/**
 * Unit tests for Symphony Cleanup Queue & Orphan Detection.
 * Issue #2213, Epic #2186 — Phase 6 Observability & Operations.
 *
 * Tests the cleanup sweep logic, double-check pattern, TTL enforcement,
 * worktree GC, SLO tracking, and deferred GC scheduling.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  CleanupSweeper,
  identifyOrphanedContainers,
  identifyStaleWorktrees,
  identifyExpiredSecrets,
  checkCleanupSlo,
  shouldDeferCleanup,
  type CleanupContext,
  type ContainerRecord,
  type WorkspaceRecord,
  type SecretDeploymentRecord,
  type CleanupItem,
  type CleanupResult,
  type SloStatus,
  CLEANUP_RETENTION_DAYS,
  DEFERRED_GC_HOURS,
  MAX_CLEANUP_BACKLOG_AGE_SECONDS,
  MAX_CLEANUP_BACKLOG_SIZE,
} from '../../src/symphony/cleanup.js';

// ─── Constants ───────────────────────────────────────────────
describe('Cleanup constants', () => {
  it('has 7-day secret retention period', () => {
    expect(CLEANUP_RETENTION_DAYS).toBe(7);
  });

  it('has 24-hour deferred GC window', () => {
    expect(DEFERRED_GC_HOURS).toBe(24);
  });

  it('has SLO thresholds', () => {
    expect(MAX_CLEANUP_BACKLOG_AGE_SECONDS).toBe(3600);
    expect(MAX_CLEANUP_BACKLOG_SIZE).toBe(10);
  });
});

// ─── Orphan Detection ────────────────────────────────────────
describe('identifyOrphanedContainers', () => {
  it('returns empty array when all containers have active runs', () => {
    const containers: ContainerRecord[] = [
      {
        id: 'c1',
        containerId: 'docker-abc123',
        connectionId: 'conn-1',
        namespace: 'testns',
        runId: 'run-1',
        containerName: 'symphony-test',
        startedAt: new Date(),
        maxTtlHours: null,
      },
    ];
    const activeRunIds = new Set(['run-1']);
    const result = identifyOrphanedContainers(containers, activeRunIds);
    expect(result).toHaveLength(0);
  });

  it('identifies containers with no active run', () => {
    const containers: ContainerRecord[] = [
      {
        id: 'c1',
        containerId: 'docker-abc123',
        connectionId: 'conn-1',
        namespace: 'testns',
        runId: 'run-1',
        containerName: 'symphony-test',
        startedAt: new Date(),
        maxTtlHours: null,
      },
      {
        id: 'c2',
        containerId: 'docker-def456',
        connectionId: 'conn-1',
        namespace: 'testns',
        runId: null,
        containerName: 'symphony-orphan',
        startedAt: new Date(),
        maxTtlHours: null,
      },
    ];
    const activeRunIds = new Set(['run-1']);
    const result = identifyOrphanedContainers(containers, activeRunIds);
    expect(result).toHaveLength(1);
    expect(result[0].resourceId).toBe('docker-def456');
  });

  it('identifies containers whose run is no longer active', () => {
    const containers: ContainerRecord[] = [
      {
        id: 'c1',
        containerId: 'docker-abc123',
        connectionId: 'conn-1',
        namespace: 'testns',
        runId: 'run-dead',
        containerName: 'symphony-test',
        startedAt: new Date(),
        maxTtlHours: null,
      },
    ];
    const activeRunIds = new Set(['run-alive']);
    const result = identifyOrphanedContainers(containers, activeRunIds);
    expect(result).toHaveLength(1);
  });

  it('identifies containers past max_ttl_hours', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const containers: ContainerRecord[] = [
      {
        id: 'c1',
        containerId: 'docker-ttl',
        connectionId: 'conn-1',
        namespace: 'testns',
        runId: 'run-1', // still active
        containerName: 'symphony-ttl',
        startedAt: twoHoursAgo,
        maxTtlHours: 1, // TTL exceeded
      },
    ];
    const activeRunIds = new Set(['run-1']);
    const result = identifyOrphanedContainers(containers, activeRunIds);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toContain('TTL');
  });

  it('does not flag containers within max_ttl_hours', () => {
    const containers: ContainerRecord[] = [
      {
        id: 'c1',
        containerId: 'docker-ok',
        connectionId: 'conn-1',
        namespace: 'testns',
        runId: 'run-1',
        containerName: 'symphony-ok',
        startedAt: new Date(), // just started
        maxTtlHours: 4,
      },
    ];
    const activeRunIds = new Set(['run-1']);
    const result = identifyOrphanedContainers(containers, activeRunIds);
    expect(result).toHaveLength(0);
  });
});

// ─── Stale Worktree Detection ────────────────────────────────
describe('identifyStaleWorktrees', () => {
  it('identifies worktrees with terminal-state runs', () => {
    const workspaces: WorkspaceRecord[] = [
      {
        id: 'w1',
        connectionId: 'conn-1',
        namespace: 'testns',
        worktreePath: '/tmp/worktree-issue-1-test',
        runId: 'run-1',
        lastUsedAt: new Date(),
        cleanupScheduledAt: null,
      },
    ];
    const terminalRunIds = new Set(['run-1']);
    const result = identifyStaleWorktrees(workspaces, terminalRunIds);
    expect(result).toHaveLength(1);
  });

  it('skips worktrees with active runs', () => {
    const workspaces: WorkspaceRecord[] = [
      {
        id: 'w1',
        connectionId: 'conn-1',
        namespace: 'testns',
        worktreePath: '/tmp/worktree-issue-1-test',
        runId: 'run-1',
        lastUsedAt: new Date(),
        cleanupScheduledAt: null,
      },
    ];
    const terminalRunIds = new Set<string>();
    const result = identifyStaleWorktrees(workspaces, terminalRunIds);
    expect(result).toHaveLength(0);
  });

  it('includes worktrees with no run (orphaned)', () => {
    const workspaces: WorkspaceRecord[] = [
      {
        id: 'w1',
        connectionId: 'conn-1',
        namespace: 'testns',
        worktreePath: '/tmp/worktree-orphaned',
        runId: null,
        lastUsedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // >24h ago
        cleanupScheduledAt: null,
      },
    ];
    const terminalRunIds = new Set<string>();
    const result = identifyStaleWorktrees(workspaces, terminalRunIds);
    expect(result).toHaveLength(1);
  });

  it('defers worktrees with no run but used recently', () => {
    const workspaces: WorkspaceRecord[] = [
      {
        id: 'w1',
        connectionId: 'conn-1',
        namespace: 'testns',
        worktreePath: '/tmp/worktree-recent',
        runId: null,
        lastUsedAt: new Date(), // just used
        cleanupScheduledAt: null,
      },
    ];
    const terminalRunIds = new Set<string>();
    const result = identifyStaleWorktrees(workspaces, terminalRunIds);
    expect(result).toHaveLength(0);
  });
});

// ─── Expired Secrets Detection ───────────────────────────────
describe('identifyExpiredSecrets', () => {
  it('identifies secrets unused for 7+ days', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const secrets: SecretDeploymentRecord[] = [
      {
        id: 's1',
        namespace: 'testns',
        connectionId: 'conn-1',
        secretName: '.env',
        secretVersion: 'v1',
        deployedPath: '/home/user/repo/.env',
        deployedAt: eightDaysAgo,
        lastUsedAt: eightDaysAgo,
        staleness: 'current',
        runId: null,
      },
    ];
    const activeRunIds = new Set<string>();
    const result = identifyExpiredSecrets(secrets, activeRunIds);
    expect(result).toHaveLength(1);
  });

  it('skips secrets used recently', () => {
    const secrets: SecretDeploymentRecord[] = [
      {
        id: 's1',
        namespace: 'testns',
        connectionId: 'conn-1',
        secretName: '.env',
        secretVersion: 'v1',
        deployedPath: '/home/user/repo/.env',
        deployedAt: new Date(),
        lastUsedAt: new Date(),
        staleness: 'current',
        runId: null,
      },
    ];
    const activeRunIds = new Set<string>();
    const result = identifyExpiredSecrets(secrets, activeRunIds);
    expect(result).toHaveLength(0);
  });

  it('skips secrets with active runs', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const secrets: SecretDeploymentRecord[] = [
      {
        id: 's1',
        namespace: 'testns',
        connectionId: 'conn-1',
        secretName: '.env',
        secretVersion: 'v1',
        deployedPath: '/home/user/repo/.env',
        deployedAt: eightDaysAgo,
        lastUsedAt: eightDaysAgo,
        staleness: 'current',
        runId: 'run-1',
      },
    ];
    const activeRunIds = new Set(['run-1']);
    const result = identifyExpiredSecrets(secrets, activeRunIds);
    expect(result).toHaveLength(0);
  });

  it('skips already-cleaned secrets', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const secrets: SecretDeploymentRecord[] = [
      {
        id: 's1',
        namespace: 'testns',
        connectionId: 'conn-1',
        secretName: '.env',
        secretVersion: 'v1',
        deployedPath: '/home/user/repo/.env',
        deployedAt: eightDaysAgo,
        lastUsedAt: eightDaysAgo,
        staleness: 'cleaned',
        runId: null,
      },
    ];
    const activeRunIds = new Set<string>();
    const result = identifyExpiredSecrets(secrets, activeRunIds);
    expect(result).toHaveLength(0);
  });
});

// ─── SLO Checking ────────────────────────────────────────────
describe('checkCleanupSlo', () => {
  it('returns healthy when no pending items', () => {
    const items: CleanupItem[] = [];
    const result = checkCleanupSlo(items);
    expect(result.healthy).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('returns healthy when pending items within SLO', () => {
    const items: CleanupItem[] = [
      {
        id: 'ci-1',
        namespace: 'testns',
        resourceType: 'container',
        resourceId: 'docker-abc',
        status: 'pending',
        createdAt: new Date(), // just created
        attempts: 0,
      },
    ];
    const result = checkCleanupSlo(items);
    expect(result.healthy).toBe(true);
  });

  it('flags when backlog size exceeds threshold', () => {
    const items: CleanupItem[] = Array.from({ length: 11 }, (_, i) => ({
      id: `ci-${i}`,
      namespace: 'testns',
      resourceType: 'container' as const,
      resourceId: `docker-${i}`,
      status: 'pending' as const,
      createdAt: new Date(),
      attempts: 0,
    }));
    const result = checkCleanupSlo(items);
    expect(result.healthy).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ type: 'backlog_size' }),
    );
  });

  it('flags when oldest item exceeds age threshold', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const items: CleanupItem[] = [
      {
        id: 'ci-old',
        namespace: 'testns',
        resourceType: 'container',
        resourceId: 'docker-old',
        status: 'pending',
        createdAt: twoHoursAgo,
        attempts: 0,
      },
    ];
    const result = checkCleanupSlo(items);
    expect(result.healthy).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ type: 'backlog_age' }),
    );
  });

  it('flags critical when backlog age exceeds 24 hours', () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const items: CleanupItem[] = [
      {
        id: 'ci-critical',
        namespace: 'testns',
        resourceType: 'container',
        resourceId: 'docker-critical',
        status: 'pending',
        createdAt: twoDaysAgo,
        attempts: 0,
      },
    ];
    const result = checkCleanupSlo(items);
    expect(result.healthy).toBe(false);
    expect(result.critical).toBe(true);
  });
});

// ─── Deferred GC ─────────────────────────────────────────────
describe('shouldDeferCleanup', () => {
  it('returns true for non-terminal runs with recent activity', () => {
    const result = shouldDeferCleanup({
      runStatus: 'paused',
      lastActivityAt: new Date(),
    });
    expect(result).toBe(true);
  });

  it('returns false for terminal runs', () => {
    const result = shouldDeferCleanup({
      runStatus: 'succeeded',
      lastActivityAt: new Date(),
    });
    expect(result).toBe(false);
  });

  it('returns false when deferred GC period has passed', () => {
    const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000);
    const result = shouldDeferCleanup({
      runStatus: 'paused',
      lastActivityAt: thirtyHoursAgo,
    });
    expect(result).toBe(false);
  });
});

// ─── CleanupSweeper double-check pattern ─────────────────────
describe('CleanupSweeper', () => {
  const mockExecutor = {
    run: vi.fn().mockResolvedValue(''),
    isConnected: vi.fn().mockReturnValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('implements double-check: skips cleanup if resource reclaimed between detect and execute', async () => {
    const sweeper = new CleanupSweeper();

    // Simulate: at detection time, container has no active run
    // But by execution time, it's been reclaimed
    const recheckOwnership = vi.fn().mockResolvedValue(true); // reclaimed = true
    const executeCleanup = vi.fn();

    const result = await sweeper.executeWithDoubleCheck(
      {
        id: 'ci-1',
        namespace: 'testns',
        resourceType: 'container',
        resourceId: 'docker-abc',
        status: 'pending',
        createdAt: new Date(),
        attempts: 0,
      },
      recheckOwnership,
      executeCleanup,
    );

    expect(result.status).toBe('resolved');
    expect(result.resolvedReason).toBe('reclaimed');
    expect(executeCleanup).not.toHaveBeenCalled();
  });

  it('executes cleanup when recheck confirms still orphaned', async () => {
    const sweeper = new CleanupSweeper();

    const recheckOwnership = vi.fn().mockResolvedValue(false); // still orphaned
    const executeCleanup = vi.fn().mockResolvedValue(undefined);

    const result = await sweeper.executeWithDoubleCheck(
      {
        id: 'ci-1',
        namespace: 'testns',
        resourceType: 'container',
        resourceId: 'docker-abc',
        status: 'pending',
        createdAt: new Date(),
        attempts: 0,
      },
      recheckOwnership,
      executeCleanup,
    );

    expect(result.status).toBe('completed');
    expect(result.resolvedReason).toBe('cleaned');
    expect(executeCleanup).toHaveBeenCalledOnce();
  });

  it('records failure when cleanup throws', async () => {
    const sweeper = new CleanupSweeper();

    const recheckOwnership = vi.fn().mockResolvedValue(false);
    const executeCleanup = vi.fn().mockRejectedValue(new Error('SSH timeout'));

    const result = await sweeper.executeWithDoubleCheck(
      {
        id: 'ci-1',
        namespace: 'testns',
        resourceType: 'container',
        resourceId: 'docker-abc',
        status: 'pending',
        createdAt: new Date(),
        attempts: 0,
      },
      recheckOwnership,
      executeCleanup,
    );

    expect(result.status).toBe('failed');
    expect(result.error).toBe('SSH timeout');
  });

  it('records failure when recheck itself throws (transient DB error)', async () => {
    const sweeper = new CleanupSweeper();

    const recheckOwnership = vi.fn().mockRejectedValue(new Error('connection timeout'));
    const executeCleanup = vi.fn();

    const result = await sweeper.executeWithDoubleCheck(
      {
        id: 'ci-1',
        namespace: 'testns',
        resourceType: 'container',
        resourceId: 'docker-abc',
        status: 'pending',
        createdAt: new Date(),
        attempts: 0,
      },
      recheckOwnership,
      executeCleanup,
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Ownership recheck failed');
    expect(result.error).toContain('connection timeout');
    expect(executeCleanup).not.toHaveBeenCalled();
  });
});
