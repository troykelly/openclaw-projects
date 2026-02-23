/**
 * @vitest-environment jsdom
 *
 * Tests for the DevSessionsPage component.
 * Issue #1611: Add routes for recipes, meal-log, and dev-sessions pages.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiClient = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage(initialPath = '/dev-sessions') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const DevSessionsPage = React.lazy(() =>
    import('@/ui/pages/DevSessionsPage.js').then((m) => ({ default: m.DevSessionsPage })),
  );

  const routes = [
    {
      path: 'dev-sessions',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <DevSessionsPage />
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

describe('DevSessionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page with header and create button', async () => {
    mockApiClient.get.mockResolvedValue({ sessions: [], total: 0 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('page-dev-sessions')).toBeInTheDocument();
    });

    expect(screen.getByText('Dev Sessions')).toBeInTheDocument();
    expect(screen.getByTestId('create-session-button')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockApiClient.get.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows empty state when no sessions', async () => {
    mockApiClient.get.mockResolvedValue({ sessions: [], total: 0 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No dev sessions found.')).toBeInTheDocument();
    });
  });

  it('renders sessions when data is available', async () => {
    mockApiClient.get.mockResolvedValue({
      sessions: [
        {
          id: 's1',
          session_name: 'Fix auth bug',
          status: 'active',
          node: 'claude-code-1',
          started_at: '2026-02-23T10:00:00Z',
          linked_issues: [],
          linked_prs: [],
        },
      ],
      total: 1,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Fix auth bug')).toBeInTheDocument();
    });
  });

  it('shows status filter control', async () => {
    mockApiClient.get.mockResolvedValue({ sessions: [], total: 0 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('status-filter')).toBeInTheDocument();
    });
  });
});
