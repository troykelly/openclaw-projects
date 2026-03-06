/**
 * Pluggable tracker interface — abstract types for issue tracking systems.
 * Epic #2186, Issue #2202 — GitHub Issue Sync.
 *
 * Trackers normalize external issues into a common format that can be
 * synced to openclaw-projects work_items.
 */

// ─────────────────────────────────────────────────────────────
// Normalized issue types (tracker-agnostic)
// ─────────────────────────────────────────────────────────────

/** Normalized issue state across trackers */
export type NormalizedIssueState = 'open' | 'closed';

/** Priority as an integer (1=critical, 2=high, 3=medium, 4=low, 5=none) */
export type NormalizedPriority = 1 | 2 | 3 | 4 | 5;

/** A normalized label (always lowercase, trimmed) */
export interface NormalizedLabel {
  readonly name: string;
  readonly color?: string;
}

/** A normalized user reference */
export interface NormalizedUser {
  readonly login: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
}

/** A normalized milestone */
export interface NormalizedMilestone {
  readonly id: string;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly dueOn?: string; // ISO-8601
}

/**
 * A normalized issue from any tracker.
 * All timestamps are ISO-8601 strings.
 * Labels are lowercase. Priority is an integer.
 */
export interface NormalizedIssue {
  /** External issue number/ID (e.g., GitHub issue number) */
  readonly externalId: number;
  /** External issue URL */
  readonly url: string;
  /** Issue title */
  readonly title: string;
  /** Issue body/description (may be null) */
  readonly body: string | null;
  /** Normalized state */
  readonly state: NormalizedIssueState;
  /** Normalized priority (derived from labels or tracker-specific fields) */
  readonly priority: NormalizedPriority;
  /** Normalized labels (lowercase) */
  readonly labels: readonly NormalizedLabel[];
  /** Assignees */
  readonly assignees: readonly NormalizedUser[];
  /** Author */
  readonly author: NormalizedUser;
  /** Milestone (if any) */
  readonly milestone: NormalizedMilestone | null;
  /** Creation timestamp (ISO-8601) */
  readonly createdAt: string;
  /** Last update timestamp (ISO-8601) */
  readonly updatedAt: string;
  /** Closed timestamp (ISO-8601, null if open) */
  readonly closedAt: string | null;
}

// ─────────────────────────────────────────────────────────────
// Pagination / cursor types
// ─────────────────────────────────────────────────────────────

/** Opaque cursor for resumable pagination */
export type SyncCursor = string | null;

/** Result page from a tracker fetch */
export interface TrackerPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: SyncCursor;
  readonly hasMore: boolean;
}

// ─────────────────────────────────────────────────────────────
// Sync strategy
// ─────────────────────────────────────────────────────────────

/**
 * Sync strategy for a project_repository.
 * - github_authoritative: GitHub is source of truth. Local changes overwritten on sync.
 * - bidirectional: Changes propagate both ways. Conflict resolution: last-write-wins via sync_hash.
 * - manual: No automatic sync. User triggers explicitly.
 */
export type SyncStrategy = 'github_authoritative' | 'bidirectional' | 'manual';

// ─────────────────────────────────────────────────────────────
// Tracker interface
// ─────────────────────────────────────────────────────────────

/**
 * Abstract tracker interface.
 * Each tracker implementation (GitHub, GitLab, Jira, etc.) implements this.
 */
export interface Tracker {
  /** Tracker name (e.g., 'github', 'gitlab') */
  readonly name: string;

  /**
   * Fetch candidate issues for sync (paginated).
   * Returns issues updated since `since` (ISO-8601) or all if null.
   *
   * @param org - Organization/owner
   * @param repo - Repository name
   * @param since - Only fetch issues updated after this timestamp
   * @param cursor - Pagination cursor from previous call
   * @param perPage - Items per page (default 100)
   */
  fetchCandidateIssues(
    org: string,
    repo: string,
    since: string | null,
    cursor: SyncCursor,
    perPage?: number,
  ): Promise<TrackerPage<NormalizedIssue>>;

  /**
   * Fetch current states for specific issue IDs.
   * Used for reconciliation of active runs.
   *
   * @param org - Organization/owner
   * @param repo - Repository name
   * @param issueIds - External issue numbers to check
   */
  fetchIssueStatesByIds(
    org: string,
    repo: string,
    issueIds: readonly number[],
  ): Promise<ReadonlyMap<number, NormalizedIssueState>>;

  /**
   * Fetch issues by their states.
   *
   * @param org - Organization/owner
   * @param repo - Repository name
   * @param states - States to filter by
   * @param cursor - Pagination cursor
   * @param perPage - Items per page
   */
  fetchIssuesByStates(
    org: string,
    repo: string,
    states: readonly NormalizedIssueState[],
    cursor: SyncCursor,
    perPage?: number,
  ): Promise<TrackerPage<NormalizedIssue>>;
}

// ─────────────────────────────────────────────────────────────
// Rate limit interface (consumed from #2203)
// ─────────────────────────────────────────────────────────────

/**
 * Rate limit check result.
 * Consumed from the rate limit management module (#2203).
 * If that module isn't available yet, a mock is used.
 */
export interface RateLimitStatus {
  readonly remaining: number;
  readonly limit: number;
  readonly resetsAt: string; // ISO-8601
  readonly isExhausted: boolean;
}

/**
 * Rate limit budget interface.
 * Sync operations call checkRateLimit() before GitHub API calls
 * and reserveBudget() to claim capacity.
 */
export interface RateLimitBudget {
  /** Check current rate limit status for a resource */
  checkRateLimit(namespace: string, resource: string): Promise<RateLimitStatus>;

  /** Reserve API call budget. Returns false if insufficient budget. */
  reserveBudget(namespace: string, resource: string, count: number): Promise<boolean>;

  /** Record an API call (update remaining count from response headers) */
  recordApiCall(
    namespace: string,
    resource: string,
    remaining: number,
    limit: number,
    resetsAt: string,
  ): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// Sync hash utility type
// ─────────────────────────────────────────────────────────────

/** Fields used to compute sync hash for drift detection */
export interface SyncHashInput {
  readonly title: string;
  readonly body: string | null;
  readonly state: NormalizedIssueState;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  readonly milestone: string | null;
  readonly updatedAt: string;
}
