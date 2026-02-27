/**
 * @vitest-environment jsdom
 *
 * Tests for the Terminal Dashboard Page.
 * Issue #1691: Terminal dashboard with stats, session list, empty state.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  TerminalSessionsResponse,
  TerminalConnectionsResponse,
  TerminalTunnelsResponse,
  TerminalDashboardStats,
} from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockStats: TerminalDashboardStats = {
  active_sessions: 3,
  total_connections: 5,
  active_tunnels: 2,
  recent_errors: 1,
};

const mockSessions: TerminalSessionsResponse = {
  sessions: [
    {
      id: 'sess-1',
      namespace: 'test',
      connection_id: 'conn-1',
      tmux_session_name: 'dev-server',
      worker_id: 'w1',
      status: 'active',
      cols: 120,
      rows: 40,
      capture_interval_s: 30,
      capture_on_command: true,
      embed_commands: true,
      embed_scrollback: false,
      started_at: '2026-02-25T10:00:00Z',
      last_activity_at: '2026-02-25T11:00:00Z',
      terminated_at: null,
      exit_code: null,
      error_message: null,
      tags: ['production'],
      notes: null,
      created_at: '2026-02-25T10:00:00Z',
      updated_at: '2026-02-25T11:00:00Z',
      connection: {
        id: 'conn-1',
        namespace: 'test',
        name: 'prod-web-1',
        host: '192.168.1.100',
        port: 22,
        username: 'root',
        auth_method: 'key',
        credential_id: null,
        proxy_jump_id: null,
        is_local: false,
        env: null,
        connect_timeout_s: 30,
        keepalive_interval: 60,
        idle_timeout_s: null,
        max_sessions: null,
        host_key_policy: 'strict',
        tags: [],
        notes: null,
        last_connected_at: '2026-02-25T10:00:00Z',
        last_error: null,
        deleted_at: null,
        created_at: '2026-02-24T00:00:00Z',
        updated_at: '2026-02-24T00:00:00Z',
      },
    },
  ],
};

const mockConnections: TerminalConnectionsResponse = {
  connections: [
    {
      id: 'conn-1',
      namespace: 'test',
      name: 'prod-web-1',
      host: '192.168.1.100',
      port: 22,
      username: 'root',
      auth_method: 'key',
      credential_id: null,
      proxy_jump_id: null,
      is_local: false,
      env: null,
      connect_timeout_s: 30,
      keepalive_interval: 60,
      idle_timeout_s: null,
      max_sessions: null,
      host_key_policy: 'strict',
      tags: ['production'],
      notes: null,
      last_connected_at: '2026-02-25T10:00:00Z',
      last_error: null,
      deleted_at: null,
      created_at: '2026-02-24T00:00:00Z',
      updated_at: '2026-02-24T00:00:00Z',
    },
  ],
};

const mockTunnels: TerminalTunnelsResponse = {
  tunnels: [],
};

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/api/terminal/stats')) return Promise.resolve(mockStats);
    if (path.includes('/api/terminal/sessions')) return Promise.resolve(mockSessions);
    if (path.includes('/api/terminal/connections')) return Promise.resolve(mockConnections);
    if (path.includes('/api/terminal/tunnels')) return Promise.resolve(mockTunnels);
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

function renderWithRouter(initialPath = '/terminal') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const TerminalDashboardPage = React.lazy(() =>
    import('@/ui/pages/terminal/TerminalDashboardPage.js').then((m) => ({ default: m.TerminalDashboardPage })),
  );

  const routes = [
    {
      path: 'terminal',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <TerminalDashboardPage />
        </React.Suspense>
      ),
    },
  ];

  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/api/terminal/stats')) return Promise.resolve(mockStats);
      if (path.includes('/api/terminal/sessions')) return Promise.resolve(mockSessions);
      if (path.includes('/api/terminal/connections')) return Promise.resolve(mockConnections);
      if (path.includes('/api/terminal/tunnels')) return Promise.resolve(mockTunnels);
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });
  });

  it('renders dashboard with stats cards', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('page-terminal-dashboard')).toBeInTheDocument();
    }, { timeout: 5000 });

    await waitFor(() => {
      expect(screen.getByTestId('terminal-stats')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('renders session card', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('dev-server')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('shows empty state when no connections', async () => {
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/api/terminal/stats')) return Promise.resolve({ active_sessions: 0, total_connections: 0, active_tunnels: 0, recent_errors: 0 });
      if (path.includes('/api/terminal/sessions')) return Promise.resolve({ sessions: [] });
      if (path.includes('/api/terminal/connections')) return Promise.resolve({ connections: [] });
      if (path.includes('/api/terminal/tunnels')) return Promise.resolve({ tunnels: [] });
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('terminal-empty-state')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('renders quick connect button', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('quick-connect-button')).toBeInTheDocument();
    }, { timeout: 5000 });
  });
});
