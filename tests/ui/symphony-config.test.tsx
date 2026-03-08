/**
 * @vitest-environment jsdom
 *
 * Tests for the Symphony Config Page (#2208).
 * Covers: orchestration toggle, repos section, hosts section, agent/budget/advanced settings.
 *
 * Note: Radix Tabs don't fully work in jsdom (no PointerEvent support), so
 * we test the default tab (repos) and test the toggle + error states at page level.
 * Each sub-section component is tested independently.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  SymphonyConfig,
  SymphonyRepo,
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

import { apiClient } from '@/ui/lib/api-client';

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockPut = apiClient.put as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as ReturnType<typeof vi.fn>;
const mockDelete = apiClient.delete as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockConfig: SymphonyConfig = {
  id: 'cfg-1',
  namespace: 'test',
  project_id: 'proj-1',
  enabled: true,
  config: {
    daily_budget_usd: 50,
    per_run_token_limit: 100000,
    polling_interval_seconds: 300,
    max_concurrent_agents: 3,
    retry_backoff_max_seconds: 3600,
    max_retry_attempts: 3,
    cancellation_policy: 'graceful',
    implementation_agent: 'claude-code',
    review_agent: 'codex',
    triage_agent: 'claude-code',
    notification_rules: [
      { event_type: 'run_failed', channel: 'in_app' },
    ],
  },
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-07T10:00:00Z',
};

const mockRepos: SymphonyRepo[] = [
  {
    id: 'repo-1',
    namespace: 'test',
    project_id: 'proj-1',
    org: 'troykelly',
    repo: 'openclaw-projects',
    default_branch: 'main',
    sync_strategy: 'mirror',
    last_synced_at: '2026-03-07T09:00:00Z',
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-07T09:00:00Z',
  },
];

const mockHosts: SymphonyHost[] = [
  {
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
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderConfigPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const router = createMemoryRouter(
    [
      {
        path: '/projects/:id/symphony',
        lazy: async () => {
          const { SymphonyConfigPage } = await import('@/ui/pages/SymphonyConfigPage');
          return { Component: SymphonyConfigPage };
        },
      },
    ],
    { initialEntries: ['/projects/proj-1/symphony'] },
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function setupMocks() {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/symphony/projects/') && url.includes('/repos')) return Promise.resolve({ data: mockRepos });
    if (url.includes('/symphony/projects/') && url.includes('/hosts')) return Promise.resolve({ data: mockHosts });
    if (url.includes('/symphony/config/')) return Promise.resolve({ data: mockConfig });
    if (url.includes('/symphony/tools')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });

  mockPut.mockResolvedValue({ data: mockConfig });
  mockPost.mockResolvedValue({ data: {} });
  mockDelete.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Component-level tests
// ---------------------------------------------------------------------------

describe('HostStatusBadge', () => {
  it('renders correct variant for each status', async () => {
    const { HostStatusBadge } = await import('@/ui/components/symphony/host-status-badge');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <HostStatusBadge status="online" />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('host-status-badge')).toHaveTextContent('online');

    rerender(
      <QueryClientProvider client={queryClient}>
        <HostStatusBadge status="degraded" />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('host-status-badge')).toHaveTextContent('degraded');

    rerender(
      <QueryClientProvider client={queryClient}>
        <HostStatusBadge status="offline" />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('host-status-badge')).toHaveTextContent('offline');
  });
});

// ---------------------------------------------------------------------------
// Page-level tests
// ---------------------------------------------------------------------------

describe('SymphonyConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', async () => {
    mockGet.mockImplementation(() => new Promise(() => {}));
    renderConfigPage();

    await waitFor(() => {
      expect(screen.getByTestId('page-symphony-config')).toBeInTheDocument();
    });
  });

  it('renders orchestration toggle after load', async () => {
    setupMocks();
    renderConfigPage();

    await waitFor(() => {
      expect(screen.getByTestId('orchestration-toggle')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('shows confirmation dialog when toggling orchestration', async () => {
    setupMocks();
    renderConfigPage();

    await waitFor(() => {
      expect(screen.getByTestId('orchestration-toggle')).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByTestId('orchestration-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('toggle-confirm-dialog')).toBeInTheDocument();
    });

    expect(screen.getByText('Disable Orchestration?')).toBeInTheDocument();
  });

  it('renders repos section (default tab) with existing repos', async () => {
    setupMocks();
    renderConfigPage();

    await waitFor(() => {
      expect(screen.getByTestId('repos-section')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByTestId('repo-item')).toBeInTheDocument();
    expect(screen.getByText('troykelly/openclaw-projects')).toBeInTheDocument();
  });

  it('opens add repo dialog', async () => {
    setupMocks();
    renderConfigPage();

    await waitFor(() => {
      expect(screen.getByTestId('add-repo-button')).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByTestId('add-repo-button'));

    await waitFor(() => {
      expect(screen.getByTestId('add-repo-dialog')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    renderConfigPage();

    await waitFor(() => {
      expect(screen.getByTestId('config-error')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('renders config tabs', async () => {
    setupMocks();
    renderConfigPage();

    await waitFor(() => {
      expect(screen.getByTestId('config-tabs')).toBeInTheDocument();
    }, { timeout: 3000 });

    // All tab triggers should be present
    expect(screen.getByRole('tab', { name: /Repositories/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Hosts/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Agents/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Budget/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Notifications/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Advanced/i })).toBeInTheDocument();
  });

  it('shows remove repo button', async () => {
    setupMocks();
    renderConfigPage();

    await waitFor(() => {
      expect(screen.getByTestId('repo-item')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByTestId('remove-repo')).toBeInTheDocument();
  });

  it('renders orchestration status badge', async () => {
    setupMocks();
    renderConfigPage();

    await waitFor(() => {
      expect(screen.getByTestId('orchestration-toggle')).toBeInTheDocument();
    }, { timeout: 3000 });

    // The toggle should show "Enabled" badge
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });
});
