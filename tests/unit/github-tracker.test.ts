/**
 * Unit tests for GitHub tracker — normalization, sync hash, pagination.
 * Epic #2186, Issue #2202 — GitHub Issue Sync.
 *
 * These tests are pure (no DB), run in the unit test project.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeIssue,
  normalizeLabel,
  normalizeUser,
  normalizeMilestone,
  extractPriority,
  isPullRequest,
  type GitHubIssue,
  type GitHubLabel,
  type GitHubUser,
  type GitHubMilestone,
} from '../../src/api/symphony/tracker/github/normalize.ts';
import { computeSyncHash } from '../../src/api/symphony/tracker/sync-hash.ts';
import { parseLinkHeader, RateLimitExhaustedError, GitHubTracker } from '../../src/api/symphony/tracker/github/adapter.ts';
import { MockRateLimitBudget } from '../../src/api/symphony/tracker/rate-limit-mock.ts';
import type { SyncHashInput } from '../../src/api/symphony/tracker/types.ts';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function makeGitHubIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    html_url: 'https://github.com/org/repo/issues/42',
    title: 'Test Issue',
    body: 'Issue body text',
    state: 'open',
    labels: [{ id: 1, name: 'Bug', color: 'ff0000' }],
    assignees: [{ login: 'alice', avatar_url: 'https://example.com/alice.png' }],
    user: { login: 'bob', avatar_url: 'https://example.com/bob.png' },
    milestone: null,
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-02-01T12:00:00Z',
    closed_at: null,
    ...overrides,
  };
}

function makeGitHubLabel(overrides: Partial<GitHubLabel> = {}): GitHubLabel {
  return { id: 1, name: 'Bug', color: 'ff0000', ...overrides };
}

// ─────────────────────────────────────────────────────────────
// Label normalization
// ─────────────────────────────────────────────────────────────

describe('normalizeLabel', () => {
  it('converts label name to lowercase', () => {
    const result = normalizeLabel(makeGitHubLabel({ name: 'BUG' }));
    expect(result.name).toBe('bug');
  });

  it('trims whitespace', () => {
    const result = normalizeLabel(makeGitHubLabel({ name: '  Enhancement  ' }));
    expect(result.name).toBe('enhancement');
  });

  it('preserves color', () => {
    const result = normalizeLabel(makeGitHubLabel({ color: 'abcdef' }));
    expect(result.color).toBe('abcdef');
  });

  it('handles string labels', () => {
    const result = normalizeLabel('My Label');
    expect(result.name).toBe('my label');
    expect(result.color).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// User normalization
// ─────────────────────────────────────────────────────────────

describe('normalizeUser', () => {
  it('maps login and avatar_url', () => {
    const result = normalizeUser({ login: 'alice', avatar_url: 'https://example.com/a.png' });
    expect(result.login).toBe('alice');
    expect(result.avatarUrl).toBe('https://example.com/a.png');
  });

  it('handles missing avatar_url', () => {
    const result = normalizeUser({ login: 'bob' });
    expect(result.login).toBe('bob');
    expect(result.avatarUrl).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Milestone normalization
// ─────────────────────────────────────────────────────────────

describe('normalizeMilestone', () => {
  it('normalizes open milestone', () => {
    const ms: GitHubMilestone = { id: 1, number: 1, title: 'v1.0', state: 'open', due_on: '2026-06-01T00:00:00Z' };
    const result = normalizeMilestone(ms);
    expect(result.id).toBe('1');
    expect(result.title).toBe('v1.0');
    expect(result.state).toBe('open');
    expect(result.dueOn).toBe('2026-06-01T00:00:00Z');
  });

  it('normalizes closed milestone without due date', () => {
    const ms: GitHubMilestone = { id: 2, number: 2, title: 'v0.9', state: 'closed', due_on: null };
    const result = normalizeMilestone(ms);
    expect(result.state).toBe('closed');
    expect(result.dueOn).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Priority extraction
// ─────────────────────────────────────────────────────────────

describe('extractPriority', () => {
  it('returns 5 (none) when no priority labels', () => {
    expect(extractPriority([makeGitHubLabel({ name: 'bug' })])).toBe(5);
  });

  it('recognizes priority: critical', () => {
    expect(extractPriority([makeGitHubLabel({ name: 'priority: critical' })])).toBe(1);
  });

  it('recognizes priority: high', () => {
    expect(extractPriority([makeGitHubLabel({ name: 'priority: high' })])).toBe(2);
  });

  it('recognizes priority: medium', () => {
    expect(extractPriority([makeGitHubLabel({ name: 'priority: medium' })])).toBe(3);
  });

  it('recognizes priority: low', () => {
    expect(extractPriority([makeGitHubLabel({ name: 'priority: low' })])).toBe(4);
  });

  it('recognizes P0 label', () => {
    expect(extractPriority([makeGitHubLabel({ name: 'P0' })])).toBe(1);
  });

  it('recognizes P1 label', () => {
    expect(extractPriority([makeGitHubLabel({ name: 'P1' })])).toBe(1);
  });

  it('recognizes P2 label', () => {
    expect(extractPriority([makeGitHubLabel({ name: 'P2' })])).toBe(2);
  });

  it('recognizes P3 label', () => {
    expect(extractPriority([makeGitHubLabel({ name: 'P3' })])).toBe(3);
  });

  it('recognizes P4 label', () => {
    expect(extractPriority([makeGitHubLabel({ name: 'P4' })])).toBe(4);
  });

  it('first match wins when multiple priority labels exist', () => {
    expect(extractPriority([
      makeGitHubLabel({ name: 'priority: low' }),
      makeGitHubLabel({ name: 'P0' }),
    ])).toBe(4); // priority: low matches first
  });

  it('handles string labels', () => {
    expect(extractPriority(['priority: high'])).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// Pull request detection
// ─────────────────────────────────────────────────────────────

describe('isPullRequest', () => {
  it('returns false for regular issues', () => {
    expect(isPullRequest(makeGitHubIssue())).toBe(false);
  });

  it('returns true for PRs', () => {
    expect(isPullRequest(makeGitHubIssue({ pull_request: { url: 'https://...' } }))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Issue normalization
// ─────────────────────────────────────────────────────────────

describe('normalizeIssue', () => {
  it('normalizes a complete GitHub issue', () => {
    const issue = makeGitHubIssue({
      labels: [makeGitHubLabel({ name: 'Bug' }), makeGitHubLabel({ name: 'Priority: High' })],
      milestone: { id: 5, number: 1, title: 'Sprint 1', state: 'open', due_on: null },
    });
    const result = normalizeIssue(issue);
    expect(result).not.toBeNull();
    expect(result!.externalId).toBe(42);
    expect(result!.title).toBe('Test Issue');
    expect(result!.state).toBe('open');
    expect(result!.priority).toBe(2); // priority: high
    expect(result!.labels).toHaveLength(2);
    expect(result!.labels[0].name).toBe('bug'); // lowercase
    expect(result!.assignees[0].login).toBe('alice');
    expect(result!.author.login).toBe('bob');
    expect(result!.milestone?.title).toBe('Sprint 1');
    expect(result!.createdAt).toBe('2026-01-15T10:00:00Z');
  });

  it('returns null for pull requests', () => {
    const pr = makeGitHubIssue({ pull_request: { url: 'x' } });
    expect(normalizeIssue(pr)).toBeNull();
  });

  it('maps closed state', () => {
    const issue = makeGitHubIssue({ state: 'closed', closed_at: '2026-03-01T00:00:00Z' });
    const result = normalizeIssue(issue)!;
    expect(result.state).toBe('closed');
    expect(result.closedAt).toBe('2026-03-01T00:00:00Z');
  });

  it('handles null user', () => {
    const issue = makeGitHubIssue({ user: null });
    const result = normalizeIssue(issue)!;
    expect(result.author.login).toBe('unknown');
  });

  it('handles null milestone', () => {
    const result = normalizeIssue(makeGitHubIssue())!;
    expect(result.milestone).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Sync hash
// ─────────────────────────────────────────────────────────────

describe('computeSyncHash', () => {
  const baseInput: SyncHashInput = {
    title: 'Test',
    body: 'Body',
    state: 'open',
    labels: ['bug', 'enhancement'],
    assignees: ['alice', 'bob'],
    milestone: 'v1.0',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('produces a hex string', () => {
    const hash = computeSyncHash(baseInput);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    expect(computeSyncHash(baseInput)).toBe(computeSyncHash(baseInput));
  });

  it('sorts labels for stability', () => {
    const hash1 = computeSyncHash({ ...baseInput, labels: ['bug', 'enhancement'] });
    const hash2 = computeSyncHash({ ...baseInput, labels: ['enhancement', 'bug'] });
    expect(hash1).toBe(hash2);
  });

  it('sorts assignees for stability', () => {
    const hash1 = computeSyncHash({ ...baseInput, assignees: ['alice', 'bob'] });
    const hash2 = computeSyncHash({ ...baseInput, assignees: ['bob', 'alice'] });
    expect(hash1).toBe(hash2);
  });

  it('differs when title changes', () => {
    const hash1 = computeSyncHash(baseInput);
    const hash2 = computeSyncHash({ ...baseInput, title: 'Different' });
    expect(hash1).not.toBe(hash2);
  });

  it('differs when state changes', () => {
    const hash1 = computeSyncHash(baseInput);
    const hash2 = computeSyncHash({ ...baseInput, state: 'closed' });
    expect(hash1).not.toBe(hash2);
  });

  it('handles null body and milestone', () => {
    const hash = computeSyncHash({ ...baseInput, body: null, milestone: null });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ─────────────────────────────────────────────────────────────
// Link header parsing
// ─────────────────────────────────────────────────────────────

describe('parseLinkHeader', () => {
  it('extracts next page number from Link header', () => {
    const header = '<https://api.github.com/repos/org/repo/issues?page=3&per_page=100>; rel="next", <https://api.github.com/repos/org/repo/issues?page=10&per_page=100>; rel="last"';
    expect(parseLinkHeader(header)).toBe('3');
  });

  it('returns null when no next link', () => {
    const header = '<https://api.github.com/repos/org/repo/issues?page=1&per_page=100>; rel="prev"';
    expect(parseLinkHeader(header)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(parseLinkHeader(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseLinkHeader('')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// RateLimitExhaustedError
// ─────────────────────────────────────────────────────────────

describe('RateLimitExhaustedError', () => {
  it('has correct properties', () => {
    const err = new RateLimitExhaustedError('2026-01-01T01:00:00Z', 0);
    expect(err.name).toBe('RateLimitExhaustedError');
    expect(err.resetsAt).toBe('2026-01-01T01:00:00Z');
    expect(err.remaining).toBe(0);
    expect(err.message).toContain('rate limit exhausted');
  });
});

// ─────────────────────────────────────────────────────────────
// MockRateLimitBudget
// ─────────────────────────────────────────────────────────────

describe('MockRateLimitBudget', () => {
  it('defaults to generous budget', async () => {
    const budget = new MockRateLimitBudget();
    const status = await budget.checkRateLimit('ns', 'core');
    expect(status.remaining).toBe(5000);
    expect(status.isExhausted).toBe(false);
  });

  it('reserves budget', async () => {
    const budget = new MockRateLimitBudget();
    const ok = await budget.reserveBudget('ns', 'core', 100);
    expect(ok).toBe(true);
    const status = await budget.checkRateLimit('ns', 'core');
    expect(status.remaining).toBe(4900);
  });

  it('rejects budget when insufficient', async () => {
    const budget = new MockRateLimitBudget();
    budget.setStatus('ns', 'core', {
      remaining: 5,
      limit: 5000,
      resetsAt: new Date().toISOString(),
      isExhausted: false,
    });
    const ok = await budget.reserveBudget('ns', 'core', 10);
    expect(ok).toBe(false);
  });

  it('records API call updates', async () => {
    const budget = new MockRateLimitBudget();
    await budget.recordApiCall('ns', 'core', 4500, 5000, '2026-01-01T02:00:00Z');
    const status = await budget.checkRateLimit('ns', 'core');
    expect(status.remaining).toBe(4500);
    expect(status.limit).toBe(5000);
  });
});

// ─────────────────────────────────────────────────────────────
// GitHubTracker (with mock fetch)
// ─────────────────────────────────────────────────────────────

describe('GitHubTracker', () => {
  function createMockResponse(
    body: unknown,
    headers: Record<string, string> = {},
    status = 200,
  ): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      headers: new Headers({
        'X-RateLimit-Remaining': '4999',
        'X-RateLimit-Limit': '5000',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
        ...headers,
      }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }

  it('fetches candidate issues with pagination', async () => {
    const issues: GitHubIssue[] = [
      makeGitHubIssue({ number: 1 }),
      makeGitHubIssue({ number: 2 }),
    ];

    const mockFetch = async (url: string) => {
      expect(url).toContain('/repos/org/repo/issues');
      expect(url).toContain('state=all');
      return createMockResponse(issues, {
        Link: '<https://api.github.com/repos/org/repo/issues?page=2>; rel="next"',
      });
    };

    const tracker = new GitHubTracker({
      token: 'test-token',
      rateLimitBudget: new MockRateLimitBudget(),
      namespace: 'testns',
      fetchFn: mockFetch as typeof fetch,
    });

    const page = await tracker.fetchCandidateIssues('org', 'repo', null, null);
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('2');
  });

  it('passes since parameter', async () => {
    const mockFetch = async (url: string) => {
      // URLSearchParams encodes colons as %3A
      const parsed = new URL(url);
      expect(parsed.searchParams.get('since')).toBe('2026-01-01T00:00:00Z');
      return createMockResponse([]);
    };

    const tracker = new GitHubTracker({
      token: 'test-token',
      rateLimitBudget: new MockRateLimitBudget(),
      namespace: 'testns',
      fetchFn: mockFetch as typeof fetch,
    });

    await tracker.fetchCandidateIssues('org', 'repo', '2026-01-01T00:00:00Z', null);
  });

  it('passes cursor as page parameter', async () => {
    const mockFetch = async (url: string) => {
      expect(url).toContain('page=3');
      return createMockResponse([]);
    };

    const tracker = new GitHubTracker({
      token: 'test-token',
      rateLimitBudget: new MockRateLimitBudget(),
      namespace: 'testns',
      fetchFn: mockFetch as typeof fetch,
    });

    await tracker.fetchCandidateIssues('org', 'repo', null, '3');
  });

  it('filters out pull requests', async () => {
    const issues: GitHubIssue[] = [
      makeGitHubIssue({ number: 1 }),
      makeGitHubIssue({ number: 2, pull_request: { url: 'x' } }),
    ];

    const mockFetch = async () => createMockResponse(issues);

    const tracker = new GitHubTracker({
      token: 'test-token',
      rateLimitBudget: new MockRateLimitBudget(),
      namespace: 'testns',
      fetchFn: mockFetch as typeof fetch,
    });

    const page = await tracker.fetchCandidateIssues('org', 'repo', null, null);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].externalId).toBe(1);
  });

  it('throws RateLimitExhaustedError when budget is low', async () => {
    const budget = new MockRateLimitBudget();
    budget.setStatus('testns', 'core', {
      remaining: 50,
      limit: 5000,
      resetsAt: '2026-01-01T02:00:00Z',
      isExhausted: false,
    });

    const tracker = new GitHubTracker({
      token: 'test-token',
      rateLimitBudget: budget,
      namespace: 'testns',
      fetchFn: async () => createMockResponse([]),
    });

    await expect(
      tracker.fetchCandidateIssues('org', 'repo', null, null),
    ).rejects.toThrow(RateLimitExhaustedError);
  });

  it('fetches issue states by IDs', async () => {
    let callCount = 0;
    const mockFetch = async (url: string) => {
      callCount++;
      const issueNum = url.match(/\/issues\/(\d+)/)?.[1];
      return createMockResponse({
        number: Number(issueNum),
        state: Number(issueNum) === 1 ? 'open' : 'closed',
      });
    };

    const tracker = new GitHubTracker({
      token: 'test-token',
      rateLimitBudget: new MockRateLimitBudget(),
      namespace: 'testns',
      fetchFn: mockFetch as typeof fetch,
    });

    const states = await tracker.fetchIssueStatesByIds('org', 'repo', [1, 2]);
    expect(states.get(1)).toBe('open');
    expect(states.get(2)).toBe('closed');
    expect(callCount).toBe(2);
  });

  it('returns empty map for empty issue IDs', async () => {
    const tracker = new GitHubTracker({
      token: 'test-token',
      rateLimitBudget: new MockRateLimitBudget(),
      namespace: 'testns',
      fetchFn: async () => createMockResponse([]),
    });

    const states = await tracker.fetchIssueStatesByIds('org', 'repo', []);
    expect(states.size).toBe(0);
  });

  it('fetches issues by states', async () => {
    const mockFetch = async (url: string) => {
      expect(url).toContain('state=open');
      return createMockResponse([makeGitHubIssue()]);
    };

    const tracker = new GitHubTracker({
      token: 'test-token',
      rateLimitBudget: new MockRateLimitBudget(),
      namespace: 'testns',
      fetchFn: mockFetch as typeof fetch,
    });

    const page = await tracker.fetchIssuesByStates('org', 'repo', ['open'], null);
    expect(page.items).toHaveLength(1);
  });

  it('uses state=all when multiple states requested', async () => {
    const mockFetch = async (url: string) => {
      expect(url).toContain('state=all');
      return createMockResponse([]);
    };

    const tracker = new GitHubTracker({
      token: 'test-token',
      rateLimitBudget: new MockRateLimitBudget(),
      namespace: 'testns',
      fetchFn: mockFetch as typeof fetch,
    });

    await tracker.fetchIssuesByStates('org', 'repo', ['open', 'closed'], null);
  });
});
