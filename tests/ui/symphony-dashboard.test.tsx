/**
 * @vitest-environment jsdom
 *
 * Tests for the Symphony Dashboard Page (#2207).
 * Covers: RunCard, QueueItem, BudgetGauge, AlertBanner, dashboard page rendering.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  SymphonyRun,
  SymphonyDashboardStatus,
  SymphonyRunsResponse,
  SymphonyDashboardHostsResponse,
  SymphonyHost,
} from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/ui/lib/auth-manager', () => ({
  getAccessToken: vi.fn(() => 'mock-token'),
  refreshAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

vi.mock('@/ui/lib/api-config', () => ({
  getApiBaseUrl: vi.fn(() => ''),
  getWsBaseUrl: vi.fn(() => ''),
}));

// Mock WebSocket
const mockWsInstances: Array<{
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen?: (() => void) | null;
  onmessage?: ((e: { data: string }) => void) | null;
  onclose?: (() => void) | null;
  onerror?: (() => void) | null;
  readyState: number;
}> = [];

vi.stubGlobal('WebSocket', class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;

  send = vi.fn();
  close = vi.fn();
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;

  constructor() {
    mockWsInstances.push(this);
  }
});

import { apiClient } from '@/ui/lib/api-client';

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const makeRun = (overrides: Partial<SymphonyRun> = {}): SymphonyRun => ({
  id: 'run-1',
  namespace: 'test',
  project_id: 'proj-1',
  work_item_id: 'wi-1',
  work_item_title: 'Fix auth bug',
  github_issue_number: 42,
  github_repo: 'my-repo',
  github_org: 'my-org',
  status: 'running',
  stage: 'coding',
  trigger: 'scheduled_poll',
  host_id: 'host-1',
  session_id: 'sess-1',
  agent_type: 'claude-code',
  token_count: 15000,
  estimated_cost_usd: 0.45,
  error_message: null,
  retry_count: 0,
  max_retries: 3,
  priority: 5,
  dispatch_reasoning: 'High priority issue, coding in progress',
  terminal_output_snapshot: 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6',
  claimed_at: '2026-03-07T10:00:00Z',
  started_at: '2026-03-07T10:01:00Z',
  completed_at: null,
  created_at: '2026-03-07T09:55:00Z',
  updated_at: '2026-03-07T10:02:00Z',
  ...overrides,
});

const makeHost = (overrides: Partial<SymphonyHost> = {}): SymphonyHost => ({
  id: 'host-1',
  namespace: 'test',
  project_id: 'proj-1',
  connection_id: 'conn-1',
  connection_name: 'prod-server-1',
  priority: 10,
  max_concurrent_sessions: 3,
  health_status: 'online',
  active_runs: 1,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-07T10:00:00Z',
  ...overrides,
});

const mockStatusResponse: SymphonyDashboardStatus = {
  status_counts: { running: 2, succeeded: 5, unclaimed: 3 },
  last_heartbeat: { last_heartbeat: '2026-03-07T10:00:00Z' },
};

const mockQueueResponse: SymphonyRunsResponse = {
  data: [
    makeRun({ id: 'run-1', status: 'running', stage: 'coding' }),
    makeRun({ id: 'run-2', status: 'running', stage: 'testing', work_item_title: 'Add search' }),
    makeRun({ id: 'run-3', status: 'unclaimed', work_item_title: 'Refactor API' }),
  ],
  total: 3,
  limit: 50,
  offset: 0,
};

const mockHostsResponse: SymphonyDashboardHostsResponse = {
  data: [
    makeHost(),
    makeHost({ id: 'host-2', connection_name: 'staging-server', health_status: 'degraded', active_runs: 0 }),
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithProviders(routes: Array<{ path: string; element: React.ReactNode }>, initialPath = '/symphony') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// RunCard tests
// ---------------------------------------------------------------------------

describe('RunCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders run stage and status', async () => {
    const { RunCard } = await import('@/ui/components/symphony/run-card');
    const run = makeRun();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <RunCard run={run} index={0} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('run-stage')).toHaveTextContent('Coding');
    expect(screen.getByTestId('run-status')).toHaveTextContent('running');
  });

  it('shows GitHub issue link with correct URL', async () => {
    const { RunCard } = await import('@/ui/components/symphony/run-card');
    const run = makeRun();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <RunCard run={run} index={0} />
      </QueryClientProvider>,
    );

    const link = screen.getByTestId('github-issue-link');
    expect(link).toHaveAttribute('href', 'https://github.com/my-org/my-repo/issues/42');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveTextContent('my-org/my-repo#42');
  });

  it('shows token count and cost', async () => {
    const { RunCard } = await import('@/ui/components/symphony/run-card');
    const run = makeRun();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <RunCard run={run} index={0} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('run-tokens')).toHaveTextContent('15,000 tokens');
    expect(screen.getByTestId('run-cost')).toHaveTextContent('$0.45');
  });

  it('lazy-loads terminal preview only for first 5 runs', async () => {
    const { RunCard } = await import('@/ui/components/symphony/run-card');
    const run = makeRun();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // Index 0 — should show terminal toggle
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <RunCard run={run} index={0} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('terminal-toggle')).toBeInTheDocument();
    unmount();

    // Index 5 — should show "View terminal" text instead
    render(
      <QueryClientProvider client={queryClient}>
        <RunCard run={run} index={5} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('terminal-toggle')).not.toBeInTheDocument();
    expect(screen.getByTestId('view-terminal-link')).toBeInTheDocument();
  });

  it('expands terminal preview on click', async () => {
    const { RunCard } = await import('@/ui/components/symphony/run-card');
    const run = makeRun();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <RunCard run={run} index={0} />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId('terminal-preview')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('terminal-toggle'));
    expect(screen.getByTestId('terminal-preview')).toBeInTheDocument();
    // Shows last 5 lines only
    expect(screen.getByTestId('terminal-preview')).toHaveTextContent('line 2');
  });
});

// ---------------------------------------------------------------------------
// QueueItem tests
// ---------------------------------------------------------------------------

describe('QueueItem', () => {
  it('renders issue title and priority', async () => {
    const { QueueItem } = await import('@/ui/components/symphony/queue-item');
    const run = makeRun({ status: 'unclaimed' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <QueueItem run={run} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('queue-item-title')).toHaveTextContent('Fix auth bug');
    expect(screen.getByText('P5')).toBeInTheDocument();
  });

  it('shows drag handle by default', async () => {
    const { QueueItem } = await import('@/ui/components/symphony/queue-item');
    const run = makeRun({ status: 'unclaimed' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <QueueItem run={run} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('drag-handle')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// BudgetGauge tests
// ---------------------------------------------------------------------------

describe('BudgetGauge', () => {
  it('calculates and displays percentage correctly', async () => {
    const { BudgetGauge } = await import('@/ui/components/symphony/budget-gauge');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <BudgetGauge spent={25} limit={100} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('budget-spent')).toHaveTextContent('$25.00');
    expect(screen.getByTestId('budget-limit')).toHaveTextContent('/ $100.00');
    expect(screen.getByTestId('budget-pct')).toHaveTextContent('25% of daily budget');
  });

  it('shows red at 90% threshold', async () => {
    const { BudgetGauge } = await import('@/ui/components/symphony/budget-gauge');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <BudgetGauge spent={95} limit={100} />
      </QueryClientProvider>,
    );

    const spent = screen.getByTestId('budget-spent');
    expect(spent).toHaveClass('text-destructive');
  });

  it('caps at 100%', async () => {
    const { BudgetGauge } = await import('@/ui/components/symphony/budget-gauge');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <BudgetGauge spent={150} limit={100} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('budget-pct')).toHaveTextContent('100% of daily budget');
  });
});

// ---------------------------------------------------------------------------
// AlertBanner tests
// ---------------------------------------------------------------------------

describe('AlertBanner', () => {
  it('renders nothing when no alerts', async () => {
    const { AlertBanner } = await import('@/ui/components/symphony/alert-banner');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <AlertBanner alerts={[]} />
      </QueryClientProvider>,
    );

    expect(container.firstChild).toBeNull();
  });

  it('orders alerts by severity (errors first)', async () => {
    const { buildAlerts } = await import('@/ui/components/symphony/alert-banner');

    const runs = [
      makeRun({ id: 'r1', status: 'paused' }),
      makeRun({ id: 'r2', status: 'cleanup_failed' }),
    ];
    const hosts = [
      makeHost({ id: 'h1', health_status: 'offline' }),
    ];

    const alerts = buildAlerts(runs, hosts, 50);

    // Errors should come first
    expect(alerts[0].severity).toBe('error');
    expect(alerts[alerts.length - 1].severity).toBe('warning');
  });

  it('generates budget warning at 90%+', async () => {
    const { buildAlerts } = await import('@/ui/components/symphony/alert-banner');

    const alerts = buildAlerts([], [], 95);
    expect(alerts.some(a => a.id === 'budget-warning')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dashboard page integration tests
// ---------------------------------------------------------------------------

describe('SymphonyDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWsInstances.length = 0;
  });

  it('renders loading state', async () => {
    mockGet.mockImplementation(() => new Promise(() => {})); // Never resolves

    const { SymphonyDashboardPage } = await import('@/ui/pages/SymphonyDashboardPage');

    renderWithProviders([{ path: '/symphony', element: <SymphonyDashboardPage /> }]);

    await waitFor(() => {
      expect(screen.getByTestId('page-symphony-dashboard')).toBeInTheDocument();
    });
  });

  it('renders active runs and queue after data loads', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('dashboard/status')) return Promise.resolve(mockStatusResponse);
      if (url.includes('dashboard/queue')) return Promise.resolve(mockQueueResponse);
      if (url.includes('dashboard/hosts')) return Promise.resolve(mockHostsResponse);
      if (url.includes('dashboard/health')) return Promise.resolve({ status: 'healthy' });
      return Promise.resolve({ data: [] });
    });

    const { SymphonyDashboardPage } = await import('@/ui/pages/SymphonyDashboardPage');

    renderWithProviders([{ path: '/symphony', element: <SymphonyDashboardPage /> }]);

    // Wait for active runs to render (data loaded)
    await waitFor(() => {
      expect(screen.getByTestId('active-runs-list')).toBeInTheDocument();
    }, { timeout: 3000 });

    // Stats bar shows active count
    expect(screen.getByTestId('stat-active')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-completed')).toHaveTextContent('5');

    // Active runs section
    const runCards = screen.getAllByTestId('run-card');
    expect(runCards.length).toBe(2);

    // Queue section
    expect(screen.getByTestId('queue-list')).toBeInTheDocument();
    const queueItems = screen.getAllByTestId('queue-item');
    expect(queueItems.length).toBe(1);
  });

  it('shows empty state when no runs', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('dashboard/status')) return Promise.resolve({ status_counts: {}, last_heartbeat: null });
      if (url.includes('dashboard/queue')) return Promise.resolve({ data: [], total: 0, limit: 50, offset: 0 });
      if (url.includes('dashboard/hosts')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    const { SymphonyDashboardPage } = await import('@/ui/pages/SymphonyDashboardPage');

    renderWithProviders([{ path: '/symphony', element: <SymphonyDashboardPage /> }]);

    await waitFor(() => {
      expect(screen.getByTestId('no-active-runs')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByTestId('no-queued-runs')).toBeInTheDocument();
  });

  it('displays WebSocket status indicator', async () => {
    mockGet.mockImplementation(() => Promise.resolve({ data: [], status_counts: {}, total: 0, limit: 50, offset: 0, last_heartbeat: null }));

    const { SymphonyDashboardPage } = await import('@/ui/pages/SymphonyDashboardPage');

    renderWithProviders([{ path: '/symphony', element: <SymphonyDashboardPage /> }]);

    await waitFor(() => {
      expect(screen.getByTestId('ws-status')).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
