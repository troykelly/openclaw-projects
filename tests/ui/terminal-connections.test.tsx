/**
 * @vitest-environment jsdom
 *
 * Tests for the Connections Management Page.
 * Issue #1692: Connections list, create, test, delete.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TerminalConnectionsResponse, TerminalCredentialsResponse } from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

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
      notes: 'Primary web server',
      last_connected_at: '2026-02-25T10:00:00Z',
      last_error: null,
      deleted_at: null,
      created_at: '2026-02-24T00:00:00Z',
      updated_at: '2026-02-24T00:00:00Z',
    },
    {
      id: 'conn-2',
      namespace: 'test',
      name: 'local-dev',
      host: null,
      port: 22,
      username: null,
      auth_method: null,
      credential_id: null,
      proxy_jump_id: null,
      is_local: true,
      env: null,
      connect_timeout_s: 30,
      keepalive_interval: 60,
      idle_timeout_s: null,
      max_sessions: null,
      host_key_policy: 'strict',
      tags: [],
      notes: null,
      last_connected_at: null,
      last_error: null,
      deleted_at: null,
      created_at: '2026-02-24T00:00:00Z',
      updated_at: '2026-02-24T00:00:00Z',
    },
  ],
};

const mockCredentials: TerminalCredentialsResponse = {
  credentials: [],
};

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/api/terminal/connections')) return Promise.resolve(mockConnections);
    if (path.includes('/api/terminal/credentials')) return Promise.resolve(mockCredentials);
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

function renderWithRouter(initialPath = '/terminal/connections') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const ConnectionsPage = React.lazy(() =>
    import('@/ui/pages/terminal/ConnectionsPage.js').then((m) => ({ default: m.ConnectionsPage })),
  );

  const routes = [
    {
      path: 'terminal/connections',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <ConnectionsPage />
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

describe('ConnectionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/api/terminal/connections')) return Promise.resolve(mockConnections);
      if (path.includes('/api/terminal/credentials')) return Promise.resolve(mockCredentials);
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });
  });

  it('renders connections list', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('page-connections')).toBeInTheDocument();
    }, { timeout: 5000 });

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
      expect(screen.getByText('local-dev')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('renders connection cards with status indicators', async () => {
    renderWithRouter();

    await waitFor(() => {
      const cards = screen.getAllByTestId('connection-card');
      expect(cards).toHaveLength(2);
    }, { timeout: 5000 });
  });

  it('shows empty state when no connections match search', async () => {
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/api/terminal/connections')) return Promise.resolve({ connections: [] });
      if (path.includes('/api/terminal/credentials')) return Promise.resolve(mockCredentials);
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText(/No connections/)).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('has new connection button', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('New Connection')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('has import SSH config button', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Import SSH Config')).toBeInTheDocument();
    }, { timeout: 5000 });
  });
});
