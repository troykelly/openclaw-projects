/**
 * @vitest-environment jsdom
 *
 * Tests for the Symphony Host Health Page.
 * Issue #2210: Host health with status cards, drain/activate controls,
 * disk usage, container inventory, circuit breaker state.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  SymphonyHostsResponse,
} from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockHosts: SymphonyHostsResponse = {
  hosts: [
    {
      id: 'host-001',
      namespace: 'test-ns',
      connection_id: 'conn-001',
      connection_name: 'dev-host-1',
      status: 'online',
      priority: 1,
      active_sessions: 2,
      max_concurrent_sessions: 5,
      disk_usage_bytes: 50_000_000_000,
      disk_total_bytes: 100_000_000_000,
      containers: [
        { id: 'ctr-1', name: 'project-alpha', status: 'running', ttl_remaining_s: 3600, run_id: 'run-001' },
        { id: 'ctr-2', name: 'project-beta', status: 'running', ttl_remaining_s: 1800, run_id: 'run-002' },
      ],
      cleanup_items: [
        { id: 'cl-1', resource_type: 'container', resource_id: 'ctr-old', status: 'pending', created_at: '2026-03-07T08:00:00Z' },
      ],
      circuit_breaker_state: 'closed',
      circuit_breaker_failures: 0,
      is_draining: false,
      last_health_check_at: '2026-03-07T10:00:00Z',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-07T10:00:00Z',
    },
    {
      id: 'host-002',
      namespace: 'test-ns',
      connection_id: 'conn-002',
      connection_name: 'dev-host-2',
      status: 'degraded',
      priority: 2,
      active_sessions: 4,
      max_concurrent_sessions: 5,
      disk_usage_bytes: 85_000_000_000,
      disk_total_bytes: 100_000_000_000,
      containers: [],
      cleanup_items: [],
      circuit_breaker_state: 'half_open',
      circuit_breaker_failures: 3,
      is_draining: false,
      last_health_check_at: '2026-03-07T09:55:00Z',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-07T09:55:00Z',
    },
    {
      id: 'host-003',
      namespace: 'test-ns',
      connection_id: 'conn-003',
      connection_name: 'dev-host-3',
      status: 'offline',
      priority: 3,
      active_sessions: 0,
      max_concurrent_sessions: 5,
      disk_usage_bytes: null,
      disk_total_bytes: null,
      containers: [],
      cleanup_items: [],
      circuit_breaker_state: 'open',
      circuit_breaker_failures: 10,
      is_draining: true,
      last_health_check_at: null,
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-06T12:00:00Z',
    },
  ],
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/symphony/hosts')) return Promise.resolve(mockHosts);
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

function renderWithRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const HostHealthPage = React.lazy(() =>
    import('@/ui/pages/symphony/HostHealthPage.js').then((m) => ({ default: m.HostHealthPage })),
  );

  const routes = [
    {
      path: 'symphony/hosts',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <HostHealthPage />
        </React.Suspense>
      ),
    },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: ['/symphony/hosts'],
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

describe('HostHealthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/symphony/hosts')) return Promise.resolve(mockHosts);
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });
  });

  it('renders the host health page', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('page-symphony-hosts')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('renders host status cards for all hosts', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getAllByTestId(/^host-card-/)).toHaveLength(3);
    }, { timeout: 5000 });
  });

  it('shows online status indicator', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('host-card-host-001')).toBeInTheDocument();
    }, { timeout: 5000 });

    const card = screen.getByTestId('host-card-host-001');
    expect(within(card).getByTestId('host-status-badge')).toHaveTextContent(/online/i);
  });

  it('shows degraded status indicator', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('host-card-host-002')).toBeInTheDocument();
    }, { timeout: 5000 });

    const card = screen.getByTestId('host-card-host-002');
    expect(within(card).getByTestId('host-status-badge')).toHaveTextContent(/degraded/i);
  });

  it('shows offline status indicator', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('host-card-host-003')).toBeInTheDocument();
    }, { timeout: 5000 });

    const card = screen.getByTestId('host-card-host-003');
    expect(within(card).getByTestId('host-status-badge')).toHaveTextContent(/offline/i);
  });

  it('displays active sessions and capacity', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('host-card-host-001')).toBeInTheDocument();
    }, { timeout: 5000 });

    const card = screen.getByTestId('host-card-host-001');
    expect(within(card).getByTestId('host-sessions')).toHaveTextContent(/2.*\/.*5/);
  });

  it('displays disk usage', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('host-card-host-001')).toBeInTheDocument();
    }, { timeout: 5000 });

    const card = screen.getByTestId('host-card-host-001');
    expect(within(card).getByTestId('host-disk-usage')).toBeInTheDocument();
  });

  it('shows container inventory', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('host-card-host-001')).toBeInTheDocument();
    }, { timeout: 5000 });

    const card = screen.getByTestId('host-card-host-001');
    expect(within(card).getAllByTestId(/^container-/)).toHaveLength(2);
  });

  it('shows circuit breaker state', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('host-card-host-002')).toBeInTheDocument();
    }, { timeout: 5000 });

    const card = screen.getByTestId('host-card-host-002');
    expect(within(card).getByTestId('circuit-breaker-state')).toHaveTextContent(/half_open/i);
  });

  it('shows drain button for active hosts', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('host-card-host-001')).toBeInTheDocument();
    }, { timeout: 5000 });

    const card = screen.getByTestId('host-card-host-001');
    expect(within(card).getByTestId('drain-host-button')).toBeInTheDocument();
  });

  it('shows activate button for draining hosts', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('host-card-host-003')).toBeInTheDocument();
    }, { timeout: 5000 });

    const card = screen.getByTestId('host-card-host-003');
    expect(within(card).getByTestId('activate-host-button')).toBeInTheDocument();
  });

  it('calls drain API when drain button is clicked', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('host-card-host-001')).toBeInTheDocument();
    }, { timeout: 5000 });

    const card = screen.getByTestId('host-card-host-001');
    fireEvent.click(within(card).getByTestId('drain-host-button'));

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        expect.stringContaining('/symphony/hosts/host-001/drain'),
        expect.anything(),
      );
    });
  });
});
