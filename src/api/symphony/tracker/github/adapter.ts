/**
 * GitHub tracker adapter — implements the Tracker interface for GitHub.
 * Epic #2186, Issue #2202 — GitHub Issue Sync.
 *
 * Uses the GitHub REST API with paginated, resumable sync.
 * Rate-limit-aware: consumes the RateLimitBudget interface from #2203.
 */
import type {
  NormalizedIssue,
  NormalizedIssueState,
  RateLimitBudget,
  SyncCursor,
  Tracker,
  TrackerPage,
} from '../types.ts';
import { normalizeIssue, type GitHubIssue } from './normalize.ts';

/** Default items per page for GitHub API */
const DEFAULT_PER_PAGE = 100;

/** Minimum remaining rate limit before deferring sync */
const RATE_LIMIT_RESERVE = 100;

/** GitHub API resource name for rate limiting */
const GITHUB_RESOURCE = 'core';

/**
 * Parse GitHub Link header to extract the next page cursor.
 * GitHub uses page-based pagination via Link headers.
 * Returns the page number as a string cursor, or null if no next page.
 */
export function parseLinkHeader(linkHeader: string | null): SyncCursor {
  if (!linkHeader) return null;

  const nextMatch = linkHeader.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="next"/);
  if (nextMatch?.[1]) {
    return nextMatch[1];
  }
  return null;
}

/**
 * Error thrown when rate limit is exhausted.
 * Sync should be deferred until the reset time.
 */
export class RateLimitExhaustedError extends Error {
  constructor(
    public readonly resetsAt: string,
    public readonly remaining: number,
  ) {
    super(`GitHub rate limit exhausted (remaining: ${remaining}). Resets at ${resetsAt}`);
    this.name = 'RateLimitExhaustedError';
  }
}

/** Options for creating a GitHubTracker */
export interface GitHubTrackerOptions {
  /** GitHub personal access token */
  readonly token: string;
  /** GitHub API base URL (default: https://api.github.com) */
  readonly apiBaseUrl?: string;
  /** Rate limit budget interface */
  readonly rateLimitBudget: RateLimitBudget;
  /** Namespace for rate limit tracking */
  readonly namespace: string;
  /** Custom fetch function (for testing) */
  readonly fetchFn?: typeof fetch;
}

/**
 * GitHub implementation of the Tracker interface.
 * Paginated, resumable, rate-limit-aware.
 */
export class GitHubTracker implements Tracker {
  readonly name = 'github';

  private readonly token: string;
  private readonly apiBaseUrl: string;
  private readonly rateLimitBudget: RateLimitBudget;
  private readonly namespace: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: GitHubTrackerOptions) {
    this.token = options.token;
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://api.github.com';
    this.rateLimitBudget = options.rateLimitBudget;
    this.namespace = options.namespace;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async fetchCandidateIssues(
    org: string,
    repo: string,
    since: string | null,
    cursor: SyncCursor,
    perPage: number = DEFAULT_PER_PAGE,
  ): Promise<TrackerPage<NormalizedIssue>> {
    await this.ensureRateBudget(1);

    const params = new URLSearchParams({
      state: 'all',
      sort: 'updated',
      direction: 'asc',
      per_page: String(perPage),
    });

    if (since) {
      params.set('since', since);
    }
    if (cursor) {
      params.set('page', cursor);
    }

    const url = `${this.apiBaseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/issues?${params.toString()}`;
    const response = await this.githubFetch(url);
    const issues = (await response.json()) as GitHubIssue[];

    const normalized: NormalizedIssue[] = [];
    for (const issue of issues) {
      const n = normalizeIssue(issue);
      if (n) normalized.push(n);
    }

    const nextCursor = parseLinkHeader(response.headers.get('Link'));
    await this.recordRateLimitFromHeaders(response.headers);

    return {
      items: normalized,
      nextCursor,
      hasMore: nextCursor !== null,
    };
  }

  async fetchIssueStatesByIds(
    org: string,
    repo: string,
    issueIds: readonly number[],
  ): Promise<ReadonlyMap<number, NormalizedIssueState>> {
    const stateMap = new Map<number, NormalizedIssueState>();

    if (issueIds.length === 0) return stateMap;

    // Fetch each issue individually (GitHub doesn't have a batch endpoint)
    await this.ensureRateBudget(issueIds.length);

    for (const issueId of issueIds) {
      const url = `${this.apiBaseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/issues/${issueId}`;
      try {
        const response = await this.githubFetch(url);
        const issue = (await response.json()) as GitHubIssue;
        stateMap.set(issueId, issue.state === 'open' ? 'open' : 'closed');
        await this.recordRateLimitFromHeaders(response.headers);
      } catch (err) {
        // If a specific issue fails (404, etc.), skip it
        if (err instanceof RateLimitExhaustedError) throw err;
        // Record the failure but continue with other issues
      }
    }

    return stateMap;
  }

  async fetchIssuesByStates(
    org: string,
    repo: string,
    states: readonly NormalizedIssueState[],
    cursor: SyncCursor,
    perPage: number = DEFAULT_PER_PAGE,
  ): Promise<TrackerPage<NormalizedIssue>> {
    await this.ensureRateBudget(1);

    // GitHub only supports 'open', 'closed', or 'all'
    let ghState: string;
    if (states.length === 1) {
      ghState = states[0];
    } else {
      ghState = 'all';
    }

    const params = new URLSearchParams({
      state: ghState,
      sort: 'updated',
      direction: 'asc',
      per_page: String(perPage),
    });

    if (cursor) {
      params.set('page', cursor);
    }

    const url = `${this.apiBaseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/issues?${params.toString()}`;
    const response = await this.githubFetch(url);
    const issues = (await response.json()) as GitHubIssue[];

    const normalized: NormalizedIssue[] = [];
    for (const issue of issues) {
      const n = normalizeIssue(issue);
      if (n) normalized.push(n);
    }

    const nextCursor = parseLinkHeader(response.headers.get('Link'));
    await this.recordRateLimitFromHeaders(response.headers);

    return {
      items: normalized,
      nextCursor,
      hasMore: nextCursor !== null,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────

  /** Make an authenticated GitHub API request */
  private async githubFetch(url: string): Promise<Response> {
    const response = await this.fetchFn(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (response.status === 403) {
      const remaining = parseInt(response.headers.get('X-RateLimit-Remaining') ?? '0', 10);
      const resetEpoch = parseInt(response.headers.get('X-RateLimit-Reset') ?? '0', 10);
      if (remaining === 0) {
        throw new RateLimitExhaustedError(
          new Date(resetEpoch * 1000).toISOString(),
          remaining,
        );
      }
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText} for ${url}`);
    }

    return response;
  }

  /** Ensure we have enough rate limit budget before making calls */
  private async ensureRateBudget(callCount: number): Promise<void> {
    const status = await this.rateLimitBudget.checkRateLimit(this.namespace, GITHUB_RESOURCE);

    if (status.isExhausted || status.remaining < RATE_LIMIT_RESERVE) {
      throw new RateLimitExhaustedError(status.resetsAt, status.remaining);
    }

    const reserved = await this.rateLimitBudget.reserveBudget(
      this.namespace,
      GITHUB_RESOURCE,
      callCount,
    );

    if (!reserved) {
      throw new RateLimitExhaustedError(status.resetsAt, status.remaining);
    }
  }

  /** Record rate limit info from response headers */
  private async recordRateLimitFromHeaders(headers: Headers): Promise<void> {
    const remaining = headers.get('X-RateLimit-Remaining');
    const limit = headers.get('X-RateLimit-Limit');
    const reset = headers.get('X-RateLimit-Reset');

    if (remaining !== null && limit !== null && reset !== null) {
      await this.rateLimitBudget.recordApiCall(
        this.namespace,
        GITHUB_RESOURCE,
        parseInt(remaining, 10),
        parseInt(limit, 10),
        new Date(parseInt(reset, 10) * 1000).toISOString(),
      );
    }
  }
}
