/**
 * GitHub API response normalization.
 * Epic #2186, Issue #2202 — GitHub Issue Sync.
 *
 * Converts GitHub REST API issue objects into NormalizedIssue format:
 * - Labels → lowercase
 * - Priority → integer (derived from priority labels)
 * - Timestamps → ISO-8601 (already ISO-8601 from GitHub)
 */
import type {
  NormalizedIssue,
  NormalizedLabel,
  NormalizedMilestone,
  NormalizedPriority,
  NormalizedUser,
} from '../types.ts';

// ─────────────────────────────────────────────────────────────
// GitHub API types (subset we use)
// ─────────────────────────────────────────────────────────────

/** GitHub REST API label object */
export interface GitHubLabel {
  readonly id: number;
  readonly name: string;
  readonly color?: string;
}

/** GitHub REST API user object */
export interface GitHubUser {
  readonly login: string;
  readonly avatar_url?: string;
}

/** GitHub REST API milestone object */
export interface GitHubMilestone {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly due_on: string | null;
}

/** GitHub REST API issue object (partial — fields we consume) */
export interface GitHubIssue {
  readonly number: number;
  readonly html_url: string;
  readonly title: string;
  readonly body: string | null;
  readonly state: string;
  readonly labels: readonly (GitHubLabel | string)[];
  readonly assignees: readonly GitHubUser[];
  readonly user: GitHubUser | null;
  readonly milestone: GitHubMilestone | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly closed_at: string | null;
  readonly pull_request?: unknown;
}

// ─────────────────────────────────────────────────────────────
// Priority label mapping
// ─────────────────────────────────────────────────────────────

/**
 * Map of label name patterns to priority integers.
 * Checked in order; first match wins.
 */
const PRIORITY_LABEL_MAP: ReadonlyArray<readonly [RegExp, NormalizedPriority]> = [
  [/^priority:\s*critical$/i, 1],
  [/^priority:\s*high$/i, 2],
  [/^priority:\s*medium$/i, 3],
  [/^priority:\s*low$/i, 4],
  [/^p[0-1]$/i, 1],
  [/^p2$/i, 2],
  [/^p3$/i, 3],
  [/^p4$/i, 4],
];

/**
 * Extract priority from GitHub labels.
 * Returns 5 (none) if no priority label is found.
 */
export function extractPriority(labels: readonly (GitHubLabel | string)[]): NormalizedPriority {
  for (const label of labels) {
    const name = typeof label === 'string' ? label : label.name;
    for (const [pattern, priority] of PRIORITY_LABEL_MAP) {
      if (pattern.test(name)) {
        return priority;
      }
    }
  }
  return 5;
}

// ─────────────────────────────────────────────────────────────
// Normalization functions
// ─────────────────────────────────────────────────────────────

/** Normalize a GitHub label to lowercase */
export function normalizeLabel(label: GitHubLabel | string): NormalizedLabel {
  if (typeof label === 'string') {
    return { name: label.toLowerCase().trim() };
  }
  return {
    name: label.name.toLowerCase().trim(),
    color: label.color ?? undefined,
  };
}

/** Normalize a GitHub user */
export function normalizeUser(user: GitHubUser): NormalizedUser {
  return {
    login: user.login,
    avatarUrl: user.avatar_url,
  };
}

/** Normalize a GitHub milestone */
export function normalizeMilestone(milestone: GitHubMilestone): NormalizedMilestone {
  return {
    id: String(milestone.id),
    title: milestone.title,
    state: milestone.state === 'open' ? 'open' : 'closed',
    dueOn: milestone.due_on ?? undefined,
  };
}

/**
 * Check if a GitHub issue is actually a pull request.
 * GitHub API includes PRs in the issues endpoint; we filter them out.
 */
export function isPullRequest(issue: GitHubIssue): boolean {
  return issue.pull_request !== undefined && issue.pull_request !== null;
}

/**
 * Normalize a GitHub issue to the common NormalizedIssue format.
 * Returns null for pull requests (filtered out).
 */
export function normalizeIssue(issue: GitHubIssue): NormalizedIssue | null {
  if (isPullRequest(issue)) {
    return null;
  }

  const labels = issue.labels.map(normalizeLabel);
  const assignees = issue.assignees.map(normalizeUser);
  const author = issue.user ? normalizeUser(issue.user) : { login: 'unknown' };
  const milestone = issue.milestone ? normalizeMilestone(issue.milestone) : null;
  const priority = extractPriority(issue.labels);

  return {
    externalId: issue.number,
    url: issue.html_url,
    title: issue.title,
    body: issue.body,
    state: issue.state === 'open' ? 'open' : 'closed',
    priority,
    labels,
    assignees,
    author,
    milestone,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
  };
}
