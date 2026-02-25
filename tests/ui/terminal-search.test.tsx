/**
 * @vitest-environment jsdom
 *
 * Tests for the Terminal Search Page.
 * Issue #1695: Cross-session semantic search.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TerminalConnectionsResponse } from '@/ui/lib/api-types';

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

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/api/terminal/connections')) return Promise.resolve(mockConnections);
    return Promise.reject(new Error(`Unknown endpoint: ${path}`));
  }),
  post: vi.fn().mockResolvedValue({ results: [], total: 0 }),
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

function renderWithRouter(initialPath = '/terminal/search') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const TerminalSearchPage = React.lazy(() =>
    import('@/ui/pages/terminal/TerminalSearchPage.js').then((m) => ({ default: m.TerminalSearchPage })),
  );

  const routes = [
    {
      path: 'terminal/search',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <TerminalSearchPage />
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

describe('TerminalSearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/api/terminal/connections')) return Promise.resolve(mockConnections);
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });
  });

  it('renders search page with filters', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('page-terminal-search')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId('terminal-search-filters')).toBeInTheDocument();
    });
  });

  it('renders search query input', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('search-query-input')).toBeInTheDocument();
    });
  });

  it('shows page heading', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Terminal Search')).toBeInTheDocument();
    });
  });
});
