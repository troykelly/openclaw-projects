/**
 * @vitest-environment jsdom
 *
 * Tests for Symphony integration in existing pages.
 * Issue #2211: Existing Page Modifications for Symphony
 *
 * Tests:
 * - DevSessionsPage: orchestrated filter + badge
 * - SessionsListPage: purpose badge + read-only indicator
 * - ProjectDetailPage: Symphony tab
 * - WorkItemDetailPage: Symphony run history section
 * - Graceful handling when Symphony is not enabled / API errors
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiClient = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
}));

vi.mock('@/ui/lib/work-item-utils', () => ({
  mapApiTreeToTreeItems: () => [],
  priorityColors: {},
  mapApiPriority: (p: string) => p,
  mapPriorityToApi: (p: string) => p,
  readBootstrap: () => ({ participants: [], me: { email: 'test@test.com' } }),
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeDevSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ds-1',
    user_email: 'test@test.com',
    project_id: null,
    session_name: 'Fix auth bug',
    node: 'claude-code-1',
    container: null,
    container_user: null,
    repo_org: null,
    repo_name: null,
    branch: null,
    status: 'active',
    task_summary: null,
    task_prompt: null,
    linked_issues: [],
    linked_prs: [],
    context_pct: null,
    last_capture: null,
    last_capture_at: null,
    webhook_id: null,
    completion_summary: null,
    started_at: '2026-03-01T10:00:00Z',
    completed_at: null,
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    symphony_run_id: null,
    orchestrated: false,
    agent_type: null,
    ...overrides,
  };
}

function makeTerminalSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ts-1',
    namespace: 'default',
    connection_id: 'conn-1',
    tmux_session_name: 'session-1',
    worker_id: null,
    status: 'active',
    cols: 120,
    rows: 40,
    capture_interval_s: 30,
    capture_on_command: false,
    embed_commands: false,
    embed_scrollback: false,
    started_at: '2026-03-01T10:00:00Z',
    last_activity_at: '2026-03-01T11:00:00Z',
    terminated_at: null,
    exit_code: null,
    error_message: null,
    tags: [],
    notes: null,
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    connection: { name: 'host-1' },
    ...overrides,
  };
}

function makeSymphonyRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    namespace: 'default',
    work_item_id: 'wi-1',
    project_id: 'proj-1',
    work_item_title: null,
    github_issue_number: null,
    github_repo: null,
    github_org: null,
    status: 'succeeded',
    stage: 'terminal',
    trigger: null,
    host_id: null,
    session_id: null,
    agent_type: null,
    token_count: 50000,
    estimated_cost_usd: 0.05,
    error_message: null,
    retry_count: 1,
    max_retries: 3,
    priority: 0,
    dispatch_reasoning: null,
    terminal_output_snapshot: null,
    claimed_at: null,
    started_at: '2026-03-01T10:00:00Z',
    completed_at: '2026-03-01T10:30:00Z',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:30:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderWithRouter(
  element: React.ReactElement,
  path: string,
  initialPath: string,
) {
  const queryClient = createTestQueryClient();
  const routes = [{ path, element }];
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// ===========================================================================
// 1. DevSessionsPage — Orchestrated filter + badge
// ===========================================================================

describe('DevSessionsPage — Symphony integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function renderDevSessions() {
    const DevSessionsPage = (
      await import('@/ui/pages/DevSessionsPage.js')
    ).DevSessionsPage;

    return renderWithRouter(
      <React.Suspense fallback={<div>Loading...</div>}>
        <DevSessionsPage />
      </React.Suspense>,
      'dev-sessions',
      '/dev-sessions',
    );
  }

  it('shows "orchestrated" badge on Symphony-created sessions', async () => {
    mockApiClient.get.mockResolvedValue({
      sessions: [
        makeDevSession({ id: 'ds-1', orchestrated: true, session_name: 'Orchestrated Fix' }),
        makeDevSession({ id: 'ds-2', orchestrated: false, session_name: 'Manual Fix' }),
      ],
      total: 2,
    });

    await renderDevSessions();

    await waitFor(
      () => {
        expect(screen.getByText('Orchestrated Fix')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // The orchestrated session should have a badge
    expect(screen.getByTestId('orchestrated-badge-ds-1')).toBeInTheDocument();
    // The non-orchestrated session should not
    expect(screen.queryByTestId('orchestrated-badge-ds-2')).not.toBeInTheDocument();
  });

  it('renders orchestration filter in the filters area', async () => {
    mockApiClient.get.mockResolvedValue({ sessions: [], total: 0 });

    await renderDevSessions();

    await waitFor(
      () => {
        expect(screen.getByTestId('page-dev-sessions')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    expect(screen.getByTestId('orchestrated-filter')).toBeInTheDocument();
  });

  it('links orchestrated sessions to run detail page', async () => {
    mockApiClient.get.mockResolvedValue({
      sessions: [
        makeDevSession({
          id: 'ds-3',
          orchestrated: true,
          symphony_run_id: 'run-abc',
          session_name: 'Linked Session',
        }),
      ],
      total: 1,
    });

    await renderDevSessions();

    await waitFor(
      () => {
        expect(screen.getByText('Linked Session')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    const runLink = screen.getByTestId('symphony-run-link-ds-3');
    expect(runLink).toBeInTheDocument();
    expect(runLink).toHaveAttribute('href', expect.stringContaining('/symphony/runs/run-abc'));
  });
});

// ===========================================================================
// 2. SessionsListPage — Purpose badge + read-only indicator
// ===========================================================================

describe('SessionsListPage — Symphony integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function renderSessionsList() {
    const SessionsListPage = (
      await import('@/ui/pages/terminal/SessionsListPage.js')
    ).SessionsListPage;

    return renderWithRouter(
      <React.Suspense fallback={<div>Loading...</div>}>
        <SessionsListPage />
      </React.Suspense>,
      'terminal/sessions',
      '/terminal/sessions',
    );
  }

  it('shows purpose badge for orchestrated sessions', async () => {
    // API returns sessions. We add symphony_run_terminals lookup that
    // maps terminal sessions to their purpose.
    mockApiClient.get.mockImplementation((url: string) => {
      if (url.includes('/terminal/sessions')) {
        return Promise.resolve({
          sessions: [
            makeTerminalSession({ id: 'ts-orch', tmux_session_name: 'symphony-run-1' }),
            makeTerminalSession({ id: 'ts-int', tmux_session_name: 'interactive-1' }),
          ],
        });
      }
      if (url.includes('/symphony/runs') && url.includes('terminal')) {
        return Promise.resolve({ data: [{ terminal_session_id: 'ts-orch', purpose: 'primary' }] });
      }
      return Promise.resolve({ data: [] });
    });

    await renderSessionsList();

    await waitFor(
      () => {
        expect(screen.getByText('symphony-run-1')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Orchestrated sessions show purpose badge
    expect(screen.getByTestId('purpose-badge-ts-orch')).toBeInTheDocument();
  });

  it('shows read-only indicator for orchestrated sessions', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url.includes('/terminal/sessions')) {
        return Promise.resolve({
          sessions: [
            makeTerminalSession({ id: 'ts-orch', tmux_session_name: 'symphony-run-1' }),
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    await renderSessionsList();

    await waitFor(
      () => {
        expect(screen.getByText('symphony-run-1')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Read-only indicator should be present for orchestrated sessions
    expect(screen.getByTestId('read-only-indicator-ts-orch')).toBeInTheDocument();
  });
});

// ===========================================================================
// 3. ProjectDetailPage — Symphony tab
// ===========================================================================

describe('ProjectDetailPage — Symphony tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupProjectMocks(symphonyConfig: unknown = null) {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url.includes('/work-items/tree')) {
        return Promise.resolve({
          items: [
            {
              id: 'proj-1',
              title: 'Test Project',
              status: 'in_progress',
              priority: 'medium',
              kind: 'project',
              children_count: 0,
              children: [],
            },
          ],
        });
      }
      if (url.match(/\/work-items\/[^/]+$/) && !url.includes('tree')) {
        return Promise.resolve({
          id: 'proj-1',
          title: 'Test Project',
          description: 'A test project',
          status: 'in_progress',
          priority: 'medium',
          kind: 'project',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
        });
      }
      if (url.includes('/symphony/config/proj-1')) {
        if (symphonyConfig === null) {
          const err = new Error('Not Found');
          (err as unknown as Record<string, unknown>).status = 404;
          return Promise.reject(err);
        }
        return Promise.resolve({ data: symphonyConfig });
      }
      if (url.includes('/symphony/runs')) {
        return Promise.resolve({ data: [], total: 0, limit: 20, offset: 0 });
      }
      if (url.includes('/memories')) {
        return Promise.resolve({ memories: [] });
      }
      return Promise.resolve({ data: [] });
    });
  }

  async function renderProjectDetail() {
    const ProjectDetailPage = (
      await import('@/ui/pages/ProjectDetailPage.js')
    ).ProjectDetailPage;

    return renderWithRouter(
      <React.Suspense fallback={<div>Loading...</div>}>
        <ProjectDetailPage />
      </React.Suspense>,
      'projects/:project_id/:view?',
      '/projects/proj-1',
    );
  }

  async function renderProjectDetailWithView(view: string) {
    const ProjectDetailPage = (
      await import('@/ui/pages/ProjectDetailPage.js')
    ).ProjectDetailPage;

    return renderWithRouter(
      <React.Suspense fallback={<div>Loading...</div>}>
        <ProjectDetailPage />
      </React.Suspense>,
      'projects/:project_id/:view?',
      `/projects/proj-1/${view}`,
    );
  }

  it('renders the Symphony tab alongside existing tabs', async () => {
    setupProjectMocks({
      id: 'config-1',
      project_id: 'proj-1',
      enabled: true, config: { max_concurrent_agents: 2, daily_budget_usd: 100 },
    });

    await renderProjectDetail();

    await waitFor(
      () => {
        expect(screen.getByTestId('page-project-detail')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Existing tabs
    expect(screen.getByText('List')).toBeInTheDocument();
    expect(screen.getByText('Board')).toBeInTheDocument();

    // New Symphony tab
    expect(screen.getByText('Symphony')).toBeInTheDocument();
  });

  it('shows "not enabled" message when Symphony config is not found', async () => {
    setupProjectMocks(null); // 404

    await renderProjectDetailWithView('symphony');

    // Should show not-enabled message after config 404
    await waitFor(
      () => {
        expect(screen.getByText(/not enabled/i)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it('shows config summary when Symphony is enabled', async () => {
    setupProjectMocks({
      id: 'config-1',
      project_id: 'proj-1',
      enabled: true, config: { max_concurrent_agents: 2, daily_budget_usd: 100 },
    });

    await renderProjectDetailWithView('symphony');

    // Config summary should show enabled after async load
    await waitFor(
      () => {
        expect(screen.getByTestId('symphony-config-summary')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it('shows recent runs list when Symphony is enabled', async () => {
    setupProjectMocks({
      id: 'config-1',
      project_id: 'proj-1',
      enabled: true,
      config: {},
    });

    // Override runs response
    mockApiClient.get.mockImplementation((url: string) => {
      if (url.includes('/work-items/tree')) {
        return Promise.resolve({
          items: [{
            id: 'proj-1', title: 'Test Project', status: 'in_progress',
            priority: 'medium', kind: 'project', children_count: 0, children: [],
          }],
        });
      }
      if (url.match(/\/work-items\/[^/]+$/) && !url.includes('tree')) {
        return Promise.resolve({
          id: 'proj-1', title: 'Test Project', description: 'A test project',
          status: 'in_progress', priority: 'medium', kind: 'project',
          created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
        });
      }
      if (url.includes('/symphony/config/proj-1')) {
        return Promise.resolve({
          data: { id: 'config-1', project_id: 'proj-1', enabled: true, config: {} },
        });
      }
      if (url.includes('/symphony/runs')) {
        return Promise.resolve({
          data: [makeSymphonyRun()],
          total: 1,
          limit: 20,
          offset: 0,
        });
      }
      if (url.includes('/memories')) {
        return Promise.resolve({ memories: [] });
      }
      return Promise.resolve({ data: [] });
    });

    await renderProjectDetailWithView('symphony');

    await waitFor(
      () => {
        expect(screen.getByTestId('symphony-runs-list')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });
});

// ===========================================================================
// 4. WorkItemDetailPage — Symphony run history section
// ===========================================================================

describe('WorkItemDetailPage — Symphony run history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupWorkItemMocks(runs: unknown[] = []) {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url.match(/\/work-items\/[^/]+$/) && !url.includes('tree')) {
        return Promise.resolve({
          id: 'wi-1',
          title: 'Fix login bug',
          description: 'The login form has a race condition',
          status: 'in_progress',
          priority: 'high',
          kind: 'issue',
          parent_id: 'proj-1',
          parent: { id: 'proj-1', title: 'Auth Project', kind: 'project' },
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
        });
      }
      if (url.includes('/symphony/runs')) {
        return Promise.resolve({
          data: runs,
          total: runs.length,
          limit: 20,
          offset: 0,
        });
      }
      if (url.includes('/symphony/config')) {
        return Promise.resolve({
          data: { id: 'config-1', enabled: true, config: {} },
        });
      }
      // Default: empty responses for all other endpoints
      if (url.includes('/memories')) return Promise.resolve({ memories: [] });
      if (url.includes('/communications')) return Promise.resolve({ emails: [], calendar_events: [] });
      if (url.includes('/activity')) return Promise.resolve({ activities: [] });
      if (url.includes('/comments')) return Promise.resolve({ comments: [] });
      if (url.includes('/attachments')) return Promise.resolve({ attachments: [] });
      if (url.includes('/rollup')) return Promise.resolve(null);
      if (url.includes('/recurrence')) return Promise.resolve(null);
      if (url.includes('/contacts')) return Promise.resolve({ contacts: [] });
      return Promise.resolve({ data: [] });
    });
  }

  async function renderWorkItemDetail() {
    const WorkItemDetailPage = (
      await import('@/ui/pages/WorkItemDetailPage.js')
    ).WorkItemDetailPage;

    return renderWithRouter(
      <React.Suspense fallback={<div>Loading...</div>}>
        <WorkItemDetailPage />
      </React.Suspense>,
      'work-items/:id',
      '/work-items/wi-1',
    );
  }

  it('renders Symphony section with run history', async () => {
    setupWorkItemMocks([
      makeSymphonyRun({ id: 'run-1', retry_count: 1, status: 'succeeded' }),
      makeSymphonyRun({ id: 'run-2', retry_count: 2, status: 'failed', error_message: 'Test failed' }),
    ]);

    await renderWorkItemDetail();

    await waitFor(
      () => {
        expect(screen.getByTestId('symphony-section')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Run history should be visible
    expect(screen.getByTestId('symphony-run-history')).toBeInTheDocument();
  });

  it('shows "working on now" indicator for active runs', async () => {
    setupWorkItemMocks([
      makeSymphonyRun({ id: 'run-active', status: 'executing', completed_at: null }),
    ]);

    await renderWorkItemDetail();

    await waitFor(
      () => {
        expect(screen.getByTestId('symphony-section')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    expect(screen.getByTestId('symphony-active-indicator')).toBeInTheDocument();
  });

  it('hides Symphony section when no runs and config not found', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url.match(/\/work-items\/[^/]+$/) && !url.includes('tree')) {
        return Promise.resolve({
          id: 'wi-1',
          title: 'Fix login bug',
          description: null,
          status: 'open',
          priority: 'medium',
          kind: 'issue',
          parent_id: null,
          parent: null,
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
        });
      }
      if (url.includes('/symphony/runs')) {
        return Promise.resolve({ data: [], total: 0, limit: 20, offset: 0 });
      }
      if (url.includes('/symphony/config')) {
        const err = new Error('Not Found');
        (err as unknown as Record<string, unknown>).status = 404;
        return Promise.reject(err);
      }
      if (url.includes('/memories')) return Promise.resolve({ memories: [] });
      if (url.includes('/communications')) return Promise.resolve({ emails: [], calendar_events: [] });
      if (url.includes('/activity')) return Promise.resolve({ activities: [] });
      if (url.includes('/comments')) return Promise.resolve({ comments: [] });
      if (url.includes('/attachments')) return Promise.resolve({ attachments: [] });
      if (url.includes('/rollup')) return Promise.resolve(null);
      if (url.includes('/recurrence')) return Promise.resolve(null);
      if (url.includes('/contacts')) return Promise.resolve({ contacts: [] });
      return Promise.resolve({ data: [] });
    });

    await renderWorkItemDetail();

    await waitFor(
      () => {
        expect(screen.getByText('Fix login bug')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Symphony section should not be rendered when no data
    expect(screen.queryByTestId('symphony-section')).not.toBeInTheDocument();
  });

  it('links run entries to run detail page', async () => {
    setupWorkItemMocks([
      makeSymphonyRun({ id: 'run-linked', retry_count: 1, status: 'succeeded' }),
    ]);

    await renderWorkItemDetail();

    await waitFor(
      () => {
        expect(screen.getByTestId('symphony-section')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    const link = screen.getByTestId('symphony-run-link-run-linked');
    expect(link).toHaveAttribute('href', expect.stringContaining('/symphony/runs/run-linked'));
  });

  it('handles Symphony API errors gracefully', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url.match(/\/work-items\/[^/]+$/) && !url.includes('tree')) {
        return Promise.resolve({
          id: 'wi-1',
          title: 'Fix login bug',
          description: null,
          status: 'open',
          priority: 'medium',
          kind: 'issue',
          parent_id: null,
          parent: null,
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
        });
      }
      if (url.includes('/symphony/')) {
        return Promise.reject(new Error('Service unavailable'));
      }
      if (url.includes('/memories')) return Promise.resolve({ memories: [] });
      if (url.includes('/communications')) return Promise.resolve({ emails: [], calendar_events: [] });
      if (url.includes('/activity')) return Promise.resolve({ activities: [] });
      if (url.includes('/comments')) return Promise.resolve({ comments: [] });
      if (url.includes('/attachments')) return Promise.resolve({ attachments: [] });
      if (url.includes('/rollup')) return Promise.resolve(null);
      if (url.includes('/recurrence')) return Promise.resolve(null);
      if (url.includes('/contacts')) return Promise.resolve({ contacts: [] });
      return Promise.resolve({ data: [] });
    });

    await renderWorkItemDetail();

    // Page should render without crashing
    await waitFor(
      () => {
        expect(screen.getByText('Fix login bug')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Symphony error message should appear after query fails
    await waitFor(
      () => {
        expect(screen.getByText('Unable to load Symphony data')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });
});
