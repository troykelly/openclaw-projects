/**
 * @vitest-environment jsdom
 *
 * Tests for the Symphony Run Detail Page.
 * Issue #2209: Run detail with provisioning timeline, terminal preview,
 * event log, token/cost, failure aggregation, actions, manifest.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  SymphonyRunDetail,
} from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockRunDetail: SymphonyRunDetail = {
  id: 'run-001',
  namespace: 'test-ns',
  project_id: 'proj-001',
  work_item_id: 'wi-001',
  work_item_title: 'Fix login bug',
  host_id: 'host-001',
  host_name: 'dev-host-1',
  tool_config_id: 'tool-001',
  tool_name: 'claude-code',
  status: 'running',
  stage: 'coding',
  trigger: 'manual',
  attempt_number: 1,
  branch_name: 'issue/42-fix-login',
  pr_url: 'https://github.com/org/repo/pull/123',
  pr_number: 123,
  issue_url: 'https://github.com/org/repo/issues/42',
  terminal_session_id: 'sess-001',
  provisioning_steps: [
    { step: 'disk_check', status: 'completed', started_at: '2026-03-07T10:00:00Z', completed_at: '2026-03-07T10:00:02Z', duration_ms: 2000, error: null },
    { step: 'ssh_connect', status: 'completed', started_at: '2026-03-07T10:00:02Z', completed_at: '2026-03-07T10:00:05Z', duration_ms: 3000, error: null },
    { step: 'repo_check', status: 'completed', started_at: '2026-03-07T10:00:05Z', completed_at: '2026-03-07T10:00:15Z', duration_ms: 10000, error: null },
    { step: 'env_sync', status: 'completed', started_at: '2026-03-07T10:00:15Z', completed_at: '2026-03-07T10:00:18Z', duration_ms: 3000, error: null },
    { step: 'devcontainer_up', status: 'completed', started_at: '2026-03-07T10:00:18Z', completed_at: '2026-03-07T10:02:18Z', duration_ms: 120000, error: null },
    { step: 'container_exec', status: 'completed', started_at: '2026-03-07T10:02:18Z', completed_at: '2026-03-07T10:02:20Z', duration_ms: 2000, error: null },
    { step: 'agent_verify', status: 'completed', started_at: '2026-03-07T10:02:20Z', completed_at: '2026-03-07T10:02:30Z', duration_ms: 10000, error: null },
    { step: 'worktree_setup', status: 'completed', started_at: '2026-03-07T10:02:30Z', completed_at: '2026-03-07T10:02:45Z', duration_ms: 15000, error: null },
  ],
  events: [
    { id: 'evt-1', run_id: 'run-001', event_type: 'state_change', from_state: 'unclaimed', to_state: 'claimed', trigger: 'manual', detail: null, created_at: '2026-03-07T10:00:00Z' },
    { id: 'evt-2', run_id: 'run-001', event_type: 'state_change', from_state: 'claimed', to_state: 'provisioning', trigger: 'worker', detail: null, created_at: '2026-03-07T10:00:01Z' },
    { id: 'evt-3', run_id: 'run-001', event_type: 'state_change', from_state: 'provisioning', to_state: 'running', trigger: 'worker', detail: null, created_at: '2026-03-07T10:02:45Z' },
  ],
  token_breakdown: {
    model: 'claude-opus-4-6',
    input_tokens: 50000,
    output_tokens: 12000,
    estimated_cost_usd: 3.45,
    project_average_cost_usd: 2.80,
  },
  failure_history: [],
  manifest: {
    tool_versions: { 'claude-code': '1.2.3', 'node': '22.0.0' },
    prompt_hash: 'abc123def456',
    secret_versions: { 'GITHUB_TOKEN': 'v2', 'OP_VAULT': 'v1' },
    branch_sha: 'deadbeef1234',
  },
  error_message: null,
  failure_class: null,
  started_at: '2026-03-07T10:00:00Z',
  completed_at: null,
  created_at: '2026-03-07T09:59:00Z',
  updated_at: '2026-03-07T10:05:00Z',
};

const mockFailedRun: SymphonyRunDetail = {
  ...mockRunDetail,
  id: 'run-002',
  status: 'failed',
  error_message: 'SSH connection lost during execution',
  failure_class: 'ssh_lost',
  provisioning_steps: [
    ...mockRunDetail.provisioning_steps.slice(0, 3),
    { step: 'env_sync', status: 'failed', started_at: '2026-03-07T10:00:15Z', completed_at: '2026-03-07T10:00:20Z', duration_ms: 5000, error: 'Vault not reachable' },
    { step: 'devcontainer_up', status: 'pending', started_at: null, completed_at: null, duration_ms: null, error: null },
    { step: 'container_exec', status: 'pending', started_at: null, completed_at: null, duration_ms: null, error: null },
    { step: 'agent_verify', status: 'pending', started_at: null, completed_at: null, duration_ms: null, error: null },
    { step: 'worktree_setup', status: 'pending', started_at: null, completed_at: null, duration_ms: null, error: null },
  ],
  failure_history: [
    { run_id: 'run-000', attempt_number: 1, status: 'failed', failure_class: 'ssh_lost', error_summary: 'Connection reset by peer', tokens_used: 8000, created_at: '2026-03-06T15:00:00Z' },
    { run_id: 'run-001', attempt_number: 2, status: 'failed', failure_class: 'docker_unavailable', error_summary: 'Docker daemon not responding', tokens_used: 2500, created_at: '2026-03-06T16:00:00Z' },
  ],
};

const mockPausedRun: SymphonyRunDetail = {
  ...mockRunDetail,
  id: 'run-003',
  status: 'paused',
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/symphony/runs/run-001')) return Promise.resolve(mockRunDetail);
    if (path.includes('/symphony/runs/run-002')) return Promise.resolve(mockFailedRun);
    if (path.includes('/symphony/runs/run-003')) return Promise.resolve(mockPausedRun);
    return Promise.reject(new Error(`Unknown endpoint: ${path}`));
  }),
  post: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
}));

vi.mock('@/ui/lib/api-config', () => ({
  getApiBaseUrl: () => 'http://localhost:3000',
}));

vi.mock('@/ui/lib/auth-manager', () => ({
  getAccessToken: () => 'test-token',
  refreshAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithRouter(runId = 'run-001') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const RunDetailPage = React.lazy(() =>
    import('@/ui/pages/symphony/RunDetailPage.js').then((m) => ({ default: m.RunDetailPage })),
  );

  const routes = [
    {
      path: 'symphony/runs/:id',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <RunDetailPage />
        </React.Suspense>
      ),
    },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: [`/symphony/runs/${runId}`],
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/symphony/runs/run-001')) return Promise.resolve(mockRunDetail);
      if (path.includes('/symphony/runs/run-002')) return Promise.resolve(mockFailedRun);
      if (path.includes('/symphony/runs/run-003')) return Promise.resolve(mockPausedRun);
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });
  });

  it('renders the run detail page', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('page-symphony-run-detail')).toBeInTheDocument();
    });
  });

  it('displays the run status badge', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('run-status-badge')).toBeInTheDocument();
    });

    expect(screen.getByTestId('run-status-badge')).toHaveTextContent(/running/i);
  });

  it('renders the provisioning timeline with all 8 steps', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('provisioning-timeline')).toBeInTheDocument();
    });

    const timeline = screen.getByTestId('provisioning-timeline');
    const steps = within(timeline).getAllByTestId(/^provisioning-step-/);
    expect(steps).toHaveLength(8);
  });

  it('shows step status indicators in provisioning timeline', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('provisioning-step-disk_check')).toBeInTheDocument();
    });

    expect(screen.getByTestId('provisioning-step-disk_check')).toHaveTextContent(/completed/i);
  });

  it('renders the event log', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('run-event-log')).toBeInTheDocument();
    });
  });

  it('renders token/cost breakdown', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('token-cost-breakdown')).toBeInTheDocument();
    });

    expect(screen.getByTestId('token-cost-breakdown')).toHaveTextContent(/3\.45/);
  });

  it('renders the run manifest', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('run-manifest')).toBeInTheDocument();
    });

    expect(screen.getByTestId('run-manifest')).toHaveTextContent(/claude-code/);
  });

  it('renders action buttons for running state', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('run-actions')).toBeInTheDocument();
    });

    expect(screen.getByTestId('cancel-run-button')).toBeInTheDocument();
  });

  it('shows view PR link when PR exists', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('view-pr-link')).toBeInTheDocument();
    });
  });

  it('shows view issue link when issue exists', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('view-issue-link')).toBeInTheDocument();
    });
  });

  it('displays failure history for failed runs', async () => {
    renderWithRouter('run-002');

    await waitFor(() => {
      expect(screen.getByTestId('failure-aggregation')).toBeInTheDocument();
    });

    const failureSection = screen.getByTestId('failure-aggregation');
    expect(within(failureSection).getAllByTestId(/^failure-attempt-/)).toHaveLength(2);
  });

  it('shows error message for failed runs', async () => {
    renderWithRouter('run-002');

    await waitFor(() => {
      expect(screen.getByTestId('run-error-message')).toBeInTheDocument();
    });

    expect(screen.getByTestId('run-error-message')).toHaveTextContent(/SSH connection lost/);
  });

  it('shows failed step with error in provisioning timeline', async () => {
    renderWithRouter('run-002');

    await waitFor(() => {
      expect(screen.getByTestId('provisioning-step-env_sync')).toBeInTheDocument();
    });

    expect(screen.getByTestId('provisioning-step-env_sync')).toHaveTextContent(/failed/i);
  });

  it('shows retry button for paused runs', async () => {
    renderWithRouter('run-003');

    await waitFor(() => {
      expect(screen.getByTestId('retry-run-button')).toBeInTheDocument();
    });
  });

  it('shows cancel confirmation dialog when cancel is clicked', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('cancel-run-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('cancel-run-button'));

    await waitFor(() => {
      expect(screen.getByTestId('cancel-confirm-dialog')).toBeInTheDocument();
    });
  });

  it('displays event log entries with timestamps', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('run-event-log')).toBeInTheDocument();
    });

    const eventLog = screen.getByTestId('run-event-log');
    const entries = within(eventLog).getAllByTestId(/^event-entry-/);
    expect(entries.length).toBeGreaterThanOrEqual(3);
  });

  it('renders work item title', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Fix login bug')).toBeInTheDocument();
    });
  });
});
