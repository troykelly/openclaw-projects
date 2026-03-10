/**
 * Integration tests for GitHub Issue Sync — migration 148 + SyncService.
 * Epic #2186, Issue #2202 — GitHub Issue Sync.
 *
 * Verifies:
 * - Migration 148 schema (github_issue_sync table, project_repository extensions)
 * - SyncService hierarchy creation (initiative + epic)
 * - SyncService issue sync (create, update, unchanged, skip)
 * - SyncService reconciliation
 * - Sync strategy behavior (github_authoritative, bidirectional, manual)
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';
import { SyncService, type RepositoryConfig } from '../src/api/symphony/tracker/sync-service.ts';
import { computeSyncHash } from '../src/api/symphony/tracker/sync-hash.ts';
import type {
  NormalizedIssue,
  NormalizedIssueState,
  Tracker,
  TrackerPage,
  SyncCursor,
} from '../src/api/symphony/tracker/types.ts';

// ─────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────

/** Insert a minimal work_item and return its id */
async function insertWorkItem(
  pool: Pool,
  namespace: string,
  kind: string = 'issue',
  parentId: string | null = null,
  title: string = 'test-item',
): Promise<string> {
  const res = await pool.query(
    `INSERT INTO work_item (title, namespace, status, kind, parent_id)
     VALUES ($1, $2, 'open', $3, $4) RETURNING id`,
    [title, namespace, kind, parentId],
  );
  return (res.rows[0] as { id: string }).id;
}

/** Create a project_repository record */
async function insertProjectRepository(
  pool: Pool,
  namespace: string,
  projectId: string,
  org: string = 'testorg',
  repo: string = 'testrepo',
  syncStrategy: string = 'github_authoritative',
): Promise<string> {
  const res = await pool.query(
    `INSERT INTO project_repository (namespace, project_id, org, repo, sync_strategy)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [namespace, projectId, org, repo, syncStrategy],
  );
  return (res.rows[0] as { id: string }).id;
}

/** Make a fake normalized issue */
function makeNormalizedIssue(overrides: Partial<NormalizedIssue> = {}): NormalizedIssue {
  return {
    externalId: 1,
    url: 'https://github.com/testorg/testrepo/issues/1',
    title: 'Test Issue #1',
    body: 'Issue body',
    state: 'open',
    priority: 5,
    labels: [{ name: 'bug' }],
    assignees: [{ login: 'alice' }],
    author: { login: 'bob' },
    milestone: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    closedAt: null,
    ...overrides,
  };
}

/** Create a mock tracker that returns given issues */
function createMockTracker(issues: NormalizedIssue[]): Tracker {
  return {
    name: 'mock-github',
    async fetchCandidateIssues(
      _org: string,
      _repo: string,
      _since: string | null,
      _cursor: SyncCursor,
      _perPage?: number,
    ): Promise<TrackerPage<NormalizedIssue>> {
      return { items: issues, nextCursor: null, hasMore: false };
    },
    async fetchIssueStatesByIds(
      _org: string,
      _repo: string,
      issueIds: readonly number[],
    ): Promise<ReadonlyMap<number, NormalizedIssueState>> {
      const map = new Map<number, NormalizedIssueState>();
      for (const id of issueIds) {
        const issue = issues.find((i) => i.externalId === id);
        if (issue) map.set(id, issue.state);
      }
      return map;
    },
    async fetchIssuesByStates(
      _org: string,
      _repo: string,
      _states: readonly NormalizedIssueState[],
      _cursor: SyncCursor,
      _perPage?: number,
    ): Promise<TrackerPage<NormalizedIssue>> {
      return { items: issues, nextCursor: null, hasMore: false };
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('GitHub Issue Sync (#2202)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  // ─── Migration 148 schema tests ───────────────────────────

  describe('Migration 148: github_issue_sync schema', () => {
    beforeEach(async () => {
      await truncateAllTables(pool);
    });

    it('creates the github_issue_sync table', async () => {
      const result = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'github_issue_sync'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('adds last_synced_at column to project_repository', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'project_repository' AND column_name = 'last_synced_at'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('adds sync_hash column to project_repository', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'project_repository' AND column_name = 'sync_hash'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('adds sync_initiative_id column to project_repository', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'project_repository' AND column_name = 'sync_initiative_id'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('accepts github_authoritative sync_strategy', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const result = await pool.query(
        `INSERT INTO project_repository (namespace, project_id, org, repo, sync_strategy)
         VALUES ('testns', $1, 'myorg', 'myrepo', 'github_authoritative') RETURNING id`,
        [projectId],
      );
      expect(result.rows).toHaveLength(1);
    });

    it('accepts bidirectional sync_strategy', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const result = await pool.query(
        `INSERT INTO project_repository (namespace, project_id, org, repo, sync_strategy)
         VALUES ('testns', $1, 'org2', 'repo2', 'bidirectional') RETURNING id`,
        [projectId],
      );
      expect(result.rows).toHaveLength(1);
    });

    it('enforces github_issue_number >= 1 constraint', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const repoId = await insertProjectRepository(pool, 'testns', projectId);
      const workItemId = await insertWorkItem(pool, 'testns');

      await expect(pool.query(
        `INSERT INTO github_issue_sync
          (namespace, project_repository_id, work_item_id, github_issue_number, github_issue_url)
         VALUES ('testns', $1, $2, 0, 'https://github.com/org/repo/issues/0')`,
        [repoId, workItemId],
      )).rejects.toThrow();
    });

    it('enforces unique (project_repository_id, github_issue_number)', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const repoId = await insertProjectRepository(pool, 'testns', projectId);
      const wi1 = await insertWorkItem(pool, 'testns');
      const wi2 = await insertWorkItem(pool, 'testns');

      await pool.query(
        `INSERT INTO github_issue_sync
          (namespace, project_repository_id, work_item_id, github_issue_number, github_issue_url)
         VALUES ('testns', $1, $2, 1, 'https://github.com/org/repo/issues/1')`,
        [repoId, wi1],
      );

      await expect(pool.query(
        `INSERT INTO github_issue_sync
          (namespace, project_repository_id, work_item_id, github_issue_number, github_issue_url)
         VALUES ('testns', $1, $2, 1, 'https://github.com/org/repo/issues/1')`,
        [repoId, wi2],
      )).rejects.toThrow();
    });

    it('cascades delete when project_repository is deleted', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const repoId = await insertProjectRepository(pool, 'testns', projectId);
      const workItemId = await insertWorkItem(pool, 'testns');

      await pool.query(
        `INSERT INTO github_issue_sync
          (namespace, project_repository_id, work_item_id, github_issue_number, github_issue_url)
         VALUES ('testns', $1, $2, 1, 'https://github.com/org/repo/issues/1')`,
        [repoId, workItemId],
      );

      await pool.query(`DELETE FROM project_repository WHERE id = $1`, [repoId]);

      const result = await pool.query(
        `SELECT id FROM github_issue_sync WHERE project_repository_id = $1`,
        [repoId],
      );
      expect(result.rows).toHaveLength(0);
    });

    it('updated_at trigger fires on update', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const repoId = await insertProjectRepository(pool, 'testns', projectId);
      const workItemId = await insertWorkItem(pool, 'testns');

      const inserted = await pool.query(
        `INSERT INTO github_issue_sync
          (namespace, project_repository_id, work_item_id, github_issue_number, github_issue_url)
         VALUES ('testns', $1, $2, 1, 'https://github.com/org/repo/issues/1')
         RETURNING updated_at`,
        [repoId, workItemId],
      );
      const originalUpdatedAt = (inserted.rows[0] as { updated_at: Date }).updated_at;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 50));

      const updated = await pool.query(
        `UPDATE github_issue_sync SET sync_hash = 'newhash'
         WHERE project_repository_id = $1 AND github_issue_number = 1
         RETURNING updated_at`,
        [repoId],
      );
      const newUpdatedAt = (updated.rows[0] as { updated_at: Date }).updated_at;

      expect(newUpdatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  // ─── SyncService hierarchy tests ──────────────────────────

  describe('SyncService.ensureHierarchy', () => {
    beforeEach(async () => {
      await truncateAllTables(pool);
    });

    it('creates initiative and epic for a project_repository', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const repoId = await insertProjectRepository(pool, 'testns', projectId);

      const config: RepositoryConfig = {
        id: repoId,
        namespace: 'testns',
        projectId,
        org: 'testorg',
        repo: 'testrepo',
        syncStrategy: 'github_authoritative',
        syncEpicId: null,
        syncInitiativeId: null,
        lastSyncedAt: null,
        syncHash: null,
      };

      const tracker = createMockTracker([]);
      const service = new SyncService(pool, tracker);
      const { initiativeId, epicId } = await service.ensureHierarchy(config);

      // Verify initiative
      const initiative = await pool.query(
        `SELECT kind, title, parent_id FROM work_item WHERE id = $1`,
        [initiativeId],
      );
      expect(initiative.rows).toHaveLength(1);
      expect((initiative.rows[0] as Record<string, unknown>).kind).toBe('initiative');
      expect((initiative.rows[0] as Record<string, unknown>).title).toBe('GitHub Sync: testorg/testrepo');
      expect((initiative.rows[0] as Record<string, unknown>).parent_id).toBeNull();

      // Verify epic
      const epic = await pool.query(
        `SELECT kind, title, parent_id FROM work_item WHERE id = $1`,
        [epicId],
      );
      expect(epic.rows).toHaveLength(1);
      expect((epic.rows[0] as Record<string, unknown>).kind).toBe('epic');
      expect((epic.rows[0] as Record<string, unknown>).title).toBe('GitHub Issues: testorg/testrepo');
      expect((epic.rows[0] as Record<string, unknown>).parent_id).toBe(initiativeId);

      // Verify project_repository was updated
      const repo = await pool.query(
        `SELECT sync_initiative_id, sync_epic_id FROM project_repository WHERE id = $1`,
        [repoId],
      );
      expect((repo.rows[0] as Record<string, unknown>).sync_initiative_id).toBe(initiativeId);
      expect((repo.rows[0] as Record<string, unknown>).sync_epic_id).toBe(epicId);
    });

    it('is idempotent — reuses existing initiative and epic', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const repoId = await insertProjectRepository(pool, 'testns', projectId);

      const config: RepositoryConfig = {
        id: repoId,
        namespace: 'testns',
        projectId,
        org: 'testorg',
        repo: 'testrepo',
        syncStrategy: 'github_authoritative',
        syncEpicId: null,
        syncInitiativeId: null,
        lastSyncedAt: null,
        syncHash: null,
      };

      const tracker = createMockTracker([]);
      const service = new SyncService(pool, tracker);

      const first = await service.ensureHierarchy(config);
      const second = await service.ensureHierarchy({
        ...config,
        syncInitiativeId: first.initiativeId,
        syncEpicId: first.epicId,
      });

      expect(second.initiativeId).toBe(first.initiativeId);
      expect(second.epicId).toBe(first.epicId);
    });
  });

  // ─── SyncService.syncPage tests ───────────────────────────

  describe('SyncService.syncPage', () => {
    beforeEach(async () => {
      await truncateAllTables(pool);
    });

    it('creates work_items for new issues', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const repoId = await insertProjectRepository(pool, 'testns', projectId);

      const issues = [
        makeNormalizedIssue({ externalId: 1, title: 'Issue One', url: 'https://github.com/testorg/testrepo/issues/1' }),
        makeNormalizedIssue({ externalId: 2, title: 'Issue Two', url: 'https://github.com/testorg/testrepo/issues/2' }),
      ];

      const tracker = createMockTracker(issues);
      const service = new SyncService(pool, tracker);

      const { epicId } = await service.ensureHierarchy({
        id: repoId,
        namespace: 'testns',
        projectId,
        org: 'testorg',
        repo: 'testrepo',
        syncStrategy: 'github_authoritative',
        syncEpicId: null,
        syncInitiativeId: null,
        lastSyncedAt: null,
        syncHash: null,
      });

      const result = await service.syncPage(
        {
          id: repoId,
          namespace: 'testns',
          projectId,
          org: 'testorg',
          repo: 'testrepo',
          syncStrategy: 'github_authoritative',
          syncEpicId: epicId,
          syncInitiativeId: null,
          lastSyncedAt: null,
          syncHash: null,
        },
        epicId,
        null,
      );

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);

      // Verify work_items were created
      const workItems = await pool.query(
        `SELECT title, kind, parent_id, status FROM work_item WHERE parent_id = $1 ORDER BY title`,
        [epicId],
      );
      expect(workItems.rows).toHaveLength(2);
      expect((workItems.rows[0] as Record<string, unknown>).title).toBe('Issue One');
      expect((workItems.rows[0] as Record<string, unknown>).kind).toBe('issue');

      // Verify github_issue_sync records
      const syncRecords = await pool.query(
        `SELECT github_issue_number, github_state FROM github_issue_sync
         WHERE project_repository_id = $1 ORDER BY github_issue_number`,
        [repoId],
      );
      expect(syncRecords.rows).toHaveLength(2);
      expect((syncRecords.rows[0] as Record<string, unknown>).github_issue_number).toBe(1);

      // Verify external links
      const links = await pool.query(
        `SELECT provider, github_owner, github_repo, github_number
         FROM work_item_external_link
         WHERE github_owner = 'testorg' AND github_repo = 'testrepo'
         ORDER BY github_number`,
      );
      expect(links.rows).toHaveLength(2);
      expect((links.rows[0] as Record<string, unknown>).provider).toBe('github');
    });

    it('detects unchanged issues via sync_hash', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const repoId = await insertProjectRepository(pool, 'testns', projectId);

      const issues = [makeNormalizedIssue({ externalId: 1 })];
      const tracker = createMockTracker(issues);
      const service = new SyncService(pool, tracker);

      const { epicId } = await service.ensureHierarchy({
        id: repoId, namespace: 'testns', projectId, org: 'testorg', repo: 'testrepo',
        syncStrategy: 'github_authoritative', syncEpicId: null, syncInitiativeId: null,
        lastSyncedAt: null, syncHash: null,
      });

      const config: RepositoryConfig = {
        id: repoId, namespace: 'testns', projectId, org: 'testorg', repo: 'testrepo',
        syncStrategy: 'github_authoritative', syncEpicId: epicId, syncInitiativeId: null,
        lastSyncedAt: null, syncHash: null,
      };

      // First sync
      const first = await service.syncPage(config, epicId, null);
      expect(first.created).toBe(1);

      // Second sync (same issues) — should be unchanged
      const second = await service.syncPage(config, epicId, null);
      expect(second.unchanged).toBe(1);
      expect(second.created).toBe(0);
      expect(second.updated).toBe(0);
    });

    it('updates work_items when issue changes (github_authoritative)', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const repoId = await insertProjectRepository(pool, 'testns', projectId);

      const originalIssue = makeNormalizedIssue({ externalId: 1, title: 'Original Title' });
      let currentIssues = [originalIssue];

      const tracker: Tracker = {
        name: 'mock',
        async fetchCandidateIssues() {
          return { items: currentIssues, nextCursor: null, hasMore: false };
        },
        async fetchIssueStatesByIds() { return new Map(); },
        async fetchIssuesByStates() { return { items: [], nextCursor: null, hasMore: false }; },
      };

      const service = new SyncService(pool, tracker);
      const { epicId } = await service.ensureHierarchy({
        id: repoId, namespace: 'testns', projectId, org: 'testorg', repo: 'testrepo',
        syncStrategy: 'github_authoritative', syncEpicId: null, syncInitiativeId: null,
        lastSyncedAt: null, syncHash: null,
      });

      const config: RepositoryConfig = {
        id: repoId, namespace: 'testns', projectId, org: 'testorg', repo: 'testrepo',
        syncStrategy: 'github_authoritative', syncEpicId: epicId, syncInitiativeId: null,
        lastSyncedAt: null, syncHash: null,
      };

      // First sync
      await service.syncPage(config, epicId, null);

      // Update issue
      currentIssues = [makeNormalizedIssue({
        externalId: 1,
        title: 'Updated Title',
        updatedAt: '2026-03-01T00:00:00Z',
      })];

      // Second sync
      const result = await service.syncPage(config, epicId, null);
      expect(result.updated).toBe(1);

      // Verify work_item was updated
      const wi = await pool.query(
        `SELECT title FROM work_item WHERE parent_id = $1`,
        [epicId],
      );
      expect((wi.rows[0] as Record<string, unknown>).title).toBe('Updated Title');
    });

    it('skips sync for manual strategy', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const repoId = await insertProjectRepository(pool, 'testns', projectId, 'testorg', 'testrepo', 'manual');

      const tracker = createMockTracker([makeNormalizedIssue()]);
      const service = new SyncService(pool, tracker);

      const config: RepositoryConfig = {
        id: repoId, namespace: 'testns', projectId, org: 'testorg', repo: 'testrepo',
        syncStrategy: 'manual', syncEpicId: null, syncInitiativeId: null,
        lastSyncedAt: null, syncHash: null,
      };

      const result = await service.syncPage(config, 'dummy-epic', null);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('updates last_synced_at on project_repository after sync', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const repoId = await insertProjectRepository(pool, 'testns', projectId);

      const issues = [makeNormalizedIssue({ updatedAt: '2026-02-15T12:00:00Z' })];
      const tracker = createMockTracker(issues);
      const service = new SyncService(pool, tracker);

      const { epicId } = await service.ensureHierarchy({
        id: repoId, namespace: 'testns', projectId, org: 'testorg', repo: 'testrepo',
        syncStrategy: 'github_authoritative', syncEpicId: null, syncInitiativeId: null,
        lastSyncedAt: null, syncHash: null,
      });

      await service.syncPage(
        {
          id: repoId, namespace: 'testns', projectId, org: 'testorg', repo: 'testrepo',
          syncStrategy: 'github_authoritative', syncEpicId: epicId, syncInitiativeId: null,
          lastSyncedAt: null, syncHash: null,
        },
        epicId,
        null,
      );

      const repo = await pool.query(
        `SELECT last_synced_at FROM project_repository WHERE id = $1`,
        [repoId],
      );
      expect((repo.rows[0] as Record<string, unknown>).last_synced_at).not.toBeNull();
    });
  });

  // ─── SyncService.reconcileActiveRuns ──────────────────────

  describe('SyncService.reconcileActiveRuns', () => {
    beforeEach(async () => {
      await truncateAllTables(pool);
    });

    it('returns zeros when no active runs', async () => {
      const projectId = await insertWorkItem(pool, 'testns', 'project');
      const repoId = await insertProjectRepository(pool, 'testns', projectId);

      const tracker = createMockTracker([]);
      const service = new SyncService(pool, tracker);

      const result = await service.reconcileActiveRuns({
        id: repoId, namespace: 'testns', projectId, org: 'testorg', repo: 'testrepo',
        syncStrategy: 'github_authoritative', syncEpicId: null, syncInitiativeId: null,
        lastSyncedAt: null, syncHash: null,
      });

      expect(result.checked).toBe(0);
      expect(result.terminal).toBe(0);
      expect(result.active).toBe(0);
    });
  });

  // ─── Down migration test ──────────────────────────────────

  describe('Migration 149 down', () => {
    it('cleanly rolls back migration 149', async () => {
      // Roll back to migration 148: 159..149 = 11 steps
      await runMigrate('down', 11);

      // Verify table dropped
      const tableCheck = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'github_issue_sync'`,
      );
      expect(tableCheck.rows).toHaveLength(0);

      // Verify columns removed
      const colCheck = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'project_repository' AND column_name = 'sync_initiative_id'`,
      );
      expect(colCheck.rows).toHaveLength(0);

      // Run up again to leave things clean for other tests
      await runMigrate('up');
    });
  });
});
