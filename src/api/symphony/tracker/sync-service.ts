/**
 * GitHub Issue Sync Service.
 * Epic #2186, Issue #2202 — GitHub Issue Sync.
 *
 * Orchestrates sync between a tracker (GitHub) and openclaw-projects work_items.
 * Handles:
 * - Paginated, resumable sync with cursor
 * - Auto-creation of initiative + epic hierarchy per project_repository
 * - Sync hash drift detection via github_issue_sync table
 * - Work item creation/update from normalized issues
 * - External link management via work_item_external_link
 * - Reconciliation of active runs
 */
import type { Pool, PoolClient } from 'pg';
import type {
  NormalizedIssue,
  NormalizedIssueState,
  SyncCursor,
  SyncStrategy,
  Tracker,
} from './types.ts';
import { computeSyncHash } from './sync-hash.ts';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** Sync result summary */
export interface SyncResult {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly cursor: SyncCursor;
  readonly hasMore: boolean;
}

/** Repository config from project_repository table */
export interface RepositoryConfig {
  readonly id: string;
  readonly namespace: string;
  readonly projectId: string;
  readonly org: string;
  readonly repo: string;
  readonly syncStrategy: SyncStrategy;
  readonly syncEpicId: string | null;
  readonly syncInitiativeId: string | null;
  readonly lastSyncedAt: string | null;
  readonly syncHash: string | null;
}

/** Reconciliation result for active runs */
export interface ReconciliationResult {
  readonly checked: number;
  readonly terminal: number;
  readonly active: number;
  readonly failed: number;
}

// ─────────────────────────────────────────────────────────────
// Sync Service
// ─────────────────────────────────────────────────────────────

/**
 * Sync service that coordinates issue sync between a tracker and the database.
 */
export class SyncService {
  constructor(
    private readonly pool: Pool,
    private readonly tracker: Tracker,
  ) {}

  /**
   * Ensure the work_item hierarchy exists for a project_repository.
   * Creates an initiative ("GitHub Sync: org/repo") and an epic
   * ("GitHub Issues: org/repo") if they don't exist.
   *
   * The hierarchy trigger requires:
   * - initiative: parent_id NULL (top-level) or under project
   * - epic: parent must be initiative
   * - issue: parent must be epic
   *
   * @returns The initiative and epic IDs
   */
  async ensureHierarchy(config: RepositoryConfig): Promise<{
    initiativeId: string;
    epicId: string;
  }> {
    // If both IDs already exist, verify they're still valid
    if (config.syncInitiativeId && config.syncEpicId) {
      const check = await this.pool.query(
        `SELECT id FROM work_item WHERE id = ANY($1::uuid[])`,
        [[config.syncInitiativeId, config.syncEpicId]],
      );
      if (check.rows.length === 2) {
        return {
          initiativeId: config.syncInitiativeId,
          epicId: config.syncEpicId,
        };
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const initiativeId = await this.ensureInitiative(client, config);
      const epicId = await this.ensureEpic(client, config, initiativeId);

      // Store IDs back on project_repository
      await client.query(
        `UPDATE project_repository
         SET sync_initiative_id = $1, sync_epic_id = $2
         WHERE id = $3`,
        [initiativeId, epicId, config.id],
      );

      await client.query('COMMIT');
      return { initiativeId, epicId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Sync a page of issues from the tracker to work_items.
   *
   * Strategy behavior:
   * - github_authoritative: GitHub wins. Local changes overwritten.
   * - bidirectional: Last-write-wins via updated_at comparison.
   * - manual: Skip automatic sync.
   */
  async syncPage(
    config: RepositoryConfig,
    epicId: string,
    cursor: SyncCursor,
    perPage?: number,
  ): Promise<SyncResult> {
    if (config.syncStrategy === 'manual') {
      return { created: 0, updated: 0, unchanged: 0, skipped: 0, cursor: null, hasMore: false };
    }

    const page = await this.tracker.fetchCandidateIssues(
      config.org,
      config.repo,
      config.lastSyncedAt,
      cursor,
      perPage,
    );

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;

    for (const issue of page.items) {
      const result = await this.syncIssue(config, epicId, issue);
      switch (result) {
        case 'created':
          created++;
          break;
        case 'updated':
          updated++;
          break;
        case 'unchanged':
          unchanged++;
          break;
        case 'skipped':
          skipped++;
          break;
      }
    }

    // Update last_synced_at on project_repository
    if (page.items.length > 0) {
      const latestUpdatedAt = page.items.reduce((latest, issue) => {
        return issue.updatedAt > latest ? issue.updatedAt : latest;
      }, config.lastSyncedAt ?? '');

      if (latestUpdatedAt) {
        await this.pool.query(
          `UPDATE project_repository SET last_synced_at = $1 WHERE id = $2`,
          [latestUpdatedAt, config.id],
        );
      }
    }

    return {
      created,
      updated,
      unchanged,
      skipped,
      cursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  /**
   * Reconcile active runs against current tracker state.
   * For each running issue with a github_issue_sync record:
   * - Terminal state (closed) -> mark run as cancelled with cleanup reason
   * - Still active -> keep running
   * - Fetch failure -> keep running, retry next tick
   */
  async reconcileActiveRuns(
    config: RepositoryConfig,
  ): Promise<ReconciliationResult> {
    if (!config.syncEpicId) {
      return { checked: 0, terminal: 0, active: 0, failed: 0 };
    }

    // Find active runs whose work_items have github_issue_sync records
    const activeRuns = await this.pool.query<{
      run_id: string;
      work_item_id: string;
      github_issue_number: number;
    }>(
      `SELECT sr.id AS run_id, sr.work_item_id, gis.github_issue_number
       FROM symphony_run sr
       JOIN github_issue_sync gis ON gis.work_item_id = sr.work_item_id
       WHERE sr.namespace = $1
         AND sr.status NOT IN ('succeeded', 'failed', 'cancelled', 'timed_out')
         AND gis.project_repository_id = $2`,
      [config.namespace, config.id],
    );

    if (activeRuns.rows.length === 0) {
      return { checked: 0, terminal: 0, active: 0, failed: 0 };
    }

    const issueIds = activeRuns.rows.map((r) => r.github_issue_number);

    let stateMap: ReadonlyMap<number, NormalizedIssueState>;

    try {
      stateMap = await this.tracker.fetchIssueStatesByIds(
        config.org,
        config.repo,
        issueIds,
      );
    } catch {
      // State refresh failure -> keep workers, retry next tick
      return { checked: activeRuns.rows.length, terminal: 0, active: activeRuns.rows.length, failed: 0 };
    }

    let terminal = 0;
    let active = 0;
    let failed = 0;

    for (const run of activeRuns.rows) {
      const state = stateMap.get(run.github_issue_number);
      if (state === undefined) {
        failed++;
        continue;
      }

      if (state === 'closed') {
        await this.pool.query(
          `UPDATE symphony_run SET status = 'cancelled', error_message = 'GitHub issue closed'
           WHERE id = $1 AND status NOT IN ('succeeded', 'failed', 'cancelled', 'timed_out')`,
          [run.run_id],
        );
        // Update sync record state too
        await this.pool.query(
          `UPDATE github_issue_sync SET github_state = 'closed'
           WHERE work_item_id = $1 AND project_repository_id = $2`,
          [run.work_item_id, config.id],
        );
        terminal++;
      } else {
        active++;
      }
    }

    return { checked: activeRuns.rows.length, terminal, active, failed };
  }

  // ─────────────────────────────────────────────────────────────
  // Private: Hierarchy management
  // ─────────────────────────────────────────────────────────────

  private async ensureInitiative(
    client: PoolClient,
    config: RepositoryConfig,
  ): Promise<string> {
    if (config.syncInitiativeId) {
      const check = await client.query(
        `SELECT id FROM work_item WHERE id = $1`,
        [config.syncInitiativeId],
      );
      if (check.rows.length > 0) return config.syncInitiativeId;
    }

    const initiativeName = `GitHub Sync: ${config.org}/${config.repo}`;

    // Idempotent lookup
    const existing = await client.query(
      `SELECT id FROM work_item
       WHERE namespace = $1 AND kind = 'initiative' AND title = $2
       AND parent_id IS NULL
       LIMIT 1`,
      [config.namespace, initiativeName],
    );

    if (existing.rows.length > 0) {
      return (existing.rows[0] as { id: string }).id;
    }

    const result = await client.query(
      `INSERT INTO work_item (namespace, title, kind, status, description)
       VALUES ($1, $2, 'initiative', 'open', $3)
       RETURNING id`,
      [
        config.namespace,
        initiativeName,
        `Auto-created initiative for GitHub issue sync from ${config.org}/${config.repo}`,
      ],
    );
    return (result.rows[0] as { id: string }).id;
  }

  private async ensureEpic(
    client: PoolClient,
    config: RepositoryConfig,
    initiativeId: string,
  ): Promise<string> {
    if (config.syncEpicId) {
      const check = await client.query(
        `SELECT id FROM work_item WHERE id = $1`,
        [config.syncEpicId],
      );
      if (check.rows.length > 0) return config.syncEpicId;
    }

    const epicName = `GitHub Issues: ${config.org}/${config.repo}`;

    // Idempotent lookup
    const existing = await client.query(
      `SELECT id FROM work_item
       WHERE namespace = $1 AND kind = 'epic' AND title = $2
       AND parent_id = $3
       LIMIT 1`,
      [config.namespace, epicName, initiativeId],
    );

    if (existing.rows.length > 0) {
      return (existing.rows[0] as { id: string }).id;
    }

    const result = await client.query(
      `INSERT INTO work_item (namespace, title, kind, status, parent_id, description)
       VALUES ($1, $2, 'epic', 'open', $3, $4)
       RETURNING id`,
      [
        config.namespace,
        epicName,
        initiativeId,
        `Auto-created epic for synced GitHub issues from ${config.org}/${config.repo}`,
      ],
    );
    return (result.rows[0] as { id: string }).id;
  }

  // ─────────────────────────────────────────────────────────────
  // Private: Issue sync
  // ─────────────────────────────────────────────────────────────

  private async syncIssue(
    config: RepositoryConfig,
    epicId: string,
    issue: NormalizedIssue,
  ): Promise<'created' | 'updated' | 'unchanged' | 'skipped'> {
    const syncHash = computeSyncHash({
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: issue.labels.map((l) => l.name),
      assignees: issue.assignees.map((a) => a.login),
      milestone: issue.milestone?.title ?? null,
      updatedAt: issue.updatedAt,
    });

    // Check if sync record exists
    const existing = await this.pool.query<{
      id: string;
      work_item_id: string;
      sync_hash: string | null;
      external_link_id: string | null;
    }>(
      `SELECT id, work_item_id, sync_hash, external_link_id
       FROM github_issue_sync
       WHERE project_repository_id = $1 AND github_issue_number = $2`,
      [config.id, issue.externalId],
    );

    if (existing.rows.length === 0) {
      // Create new work_item + sync record + external link
      await this.createSyncedIssue(config, epicId, issue, syncHash);
      return 'created';
    }

    const syncRecord = existing.rows[0];

    // Check sync hash for drift
    if (syncRecord.sync_hash === syncHash) {
      return 'unchanged';
    }

    if (config.syncStrategy === 'github_authoritative') {
      await this.updateSyncedIssue(syncRecord.work_item_id, syncRecord.id, issue, syncHash);
      return 'updated';
    }

    if (config.syncStrategy === 'bidirectional') {
      // Check local work_item updated_at vs GitHub updated_at
      const localItem = await this.pool.query<{ updated_at: string }>(
        `SELECT updated_at::text FROM work_item WHERE id = $1`,
        [syncRecord.work_item_id],
      );

      if (localItem.rows.length > 0) {
        const localUpdated = new Date(localItem.rows[0].updated_at).toISOString();
        if (issue.updatedAt > localUpdated) {
          await this.updateSyncedIssue(syncRecord.work_item_id, syncRecord.id, issue, syncHash);
          return 'updated';
        }
      }
      return 'skipped';
    }

    return 'skipped';
  }

  private async createSyncedIssue(
    config: RepositoryConfig,
    epicId: string,
    issue: NormalizedIssue,
    syncHash: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const status = issue.state === 'open' ? 'open' : 'closed';

      // Create work_item
      const wiResult = await client.query(
        `INSERT INTO work_item (namespace, title, description, kind, status, parent_id)
         VALUES ($1, $2, $3, 'issue', $4, $5)
         RETURNING id`,
        [config.namespace, issue.title, issue.body, status, epicId],
      );
      const workItemId = (wiResult.rows[0] as { id: string }).id;

      // Create external link
      const linkResult = await client.query(
        `INSERT INTO work_item_external_link
          (work_item_id, provider, url, external_id, github_owner, github_repo, github_kind, github_number)
         VALUES ($1, 'github', $2, $3, $4, $5, 'issue', $6)
         RETURNING id`,
        [
          workItemId,
          issue.url,
          `github:${config.org}/${config.repo}#${issue.externalId}`,
          config.org,
          config.repo,
          issue.externalId,
        ],
      );
      const externalLinkId = (linkResult.rows[0] as { id: string }).id;

      // Create github_issue_sync record
      await client.query(
        `INSERT INTO github_issue_sync
          (namespace, project_repository_id, work_item_id, external_link_id,
           github_issue_number, github_issue_url, sync_hash,
           github_state, github_author, github_labels, github_assignees,
           github_milestone, github_priority,
           github_created_at, github_updated_at, github_closed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          config.namespace,
          config.id,
          workItemId,
          externalLinkId,
          issue.externalId,
          issue.url,
          syncHash,
          issue.state,
          issue.author.login,
          JSON.stringify(issue.labels.map((l) => l.name)),
          JSON.stringify(issue.assignees.map((a) => a.login)),
          issue.milestone?.title ?? null,
          issue.priority,
          issue.createdAt,
          issue.updatedAt,
          issue.closedAt,
        ],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async updateSyncedIssue(
    workItemId: string,
    syncRecordId: string,
    issue: NormalizedIssue,
    syncHash: string,
  ): Promise<void> {
    const status = issue.state === 'open' ? 'open' : 'closed';

    // Update work_item
    await this.pool.query(
      `UPDATE work_item
       SET title = $1, description = $2, status = $3, updated_at = NOW()
       WHERE id = $4`,
      [issue.title, issue.body, status, workItemId],
    );

    // Update github_issue_sync record
    await this.pool.query(
      `UPDATE github_issue_sync
       SET sync_hash = $1, github_state = $2, github_author = $3,
           github_labels = $4, github_assignees = $5,
           github_milestone = $6, github_priority = $7,
           github_updated_at = $8, github_closed_at = $9,
           last_synced_at = NOW()
       WHERE id = $10`,
      [
        syncHash,
        issue.state,
        issue.author.login,
        JSON.stringify(issue.labels.map((l) => l.name)),
        JSON.stringify(issue.assignees.map((a) => a.login)),
        issue.milestone?.title ?? null,
        issue.priority,
        issue.updatedAt,
        issue.closedAt,
        syncRecordId,
      ],
    );
  }
}
