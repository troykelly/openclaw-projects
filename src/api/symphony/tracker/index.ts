/**
 * Symphony tracker module — pluggable issue tracker integration.
 * Epic #2186, Issue #2202 — GitHub Issue Sync.
 */
export type {
  NormalizedIssue,
  NormalizedIssueState,
  NormalizedLabel,
  NormalizedMilestone,
  NormalizedPriority,
  NormalizedUser,
  RateLimitBudget,
  RateLimitStatus,
  SyncCursor,
  SyncHashInput,
  SyncStrategy,
  Tracker,
  TrackerPage,
} from './types.ts';

export { computeSyncHash } from './sync-hash.ts';
export { MockRateLimitBudget } from './rate-limit-mock.ts';
export { GitHubTracker, RateLimitExhaustedError, parseLinkHeader, validateApiBaseUrl } from './github/adapter.ts';
export { normalizeIssue, normalizeLabel, normalizeUser, normalizeMilestone, extractPriority, isPullRequest } from './github/normalize.ts';
export type { GitHubIssue, GitHubLabel, GitHubUser, GitHubMilestone } from './github/normalize.ts';
export { SyncService } from './sync-service.ts';
export type { SyncResult, RepositoryConfig, ReconciliationResult } from './sync-service.ts';
