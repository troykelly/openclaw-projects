/**
 * @vitest-environment jsdom
 *
 * Tests for the Terminal Search Page.
 * Issue #1695: Cross-session semantic search.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    if (path.includes('/terminal/connections')) return Promise.resolve(mockConnections);
    return Promise.reject(new Error(`Unknown endpoint: ${path}`));
  }),
  post: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0, search_mode: 'semantic' }),
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
      if (path.includes('/terminal/connections')) return Promise.resolve(mockConnections);
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });
  });

  it('renders search page with filters', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('page-terminal-search')).toBeInTheDocument();
    }, { timeout: 5000 });

    await waitFor(() => {
      expect(screen.getByTestId('terminal-search-filters')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('renders search query input', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('search-query-input')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('shows page heading', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Terminal Search')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  // Issue #2132: kind filter must send string[] to backend
  it('TerminalSearchParams.kind accepts string[] matching backend contract', async () => {
    const mod = await import('@/ui/hooks/queries/use-terminal-search');
    expect(mod.useTerminalSearch).toBeDefined();

    // If kind were still typed as `string`, this assignment would fail at build time.
    type Params = Parameters<ReturnType<typeof mod.useTerminalSearch>['mutate']>[0];
    const params: Params = { query: 'test', kind: ['command', 'output'] };
    expect(Array.isArray(params.kind)).toBe(true);
    expect(params.kind).toEqual(['command', 'output']);
  });

  it('sends kind as undefined when "all" is selected (no filter)', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('terminal-search-filters')).toBeInTheDocument();
    }, { timeout: 5000 });

    const input = screen.getByTestId('search-query-input');
    fireEvent.change(input, { target: { value: 'test query' } });

    const searchButton = screen.getByRole('button', { name: /search/i });
    fireEvent.click(searchButton);

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/terminal/search',
        expect.objectContaining({ query: 'test query' }),
      );
      // When "all" is selected, kind should be undefined (not sent as string or empty array)
      const callArgs = mockApiClient.post.mock.calls[0][1];
      expect(callArgs.kind).toBeUndefined();
    }, { timeout: 5000 });
  });
});
