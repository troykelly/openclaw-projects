/**
 * @vitest-environment jsdom
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { routes } from '@/ui/routes.js';

// Pre-resolve all lazy-loaded components so React.lazy resolves synchronously
// during tests. Under full suite load, chained dynamic imports
// (AppLayout → redirect → DashboardPage) can exceed the default waitFor
// timeout when hundreds of test files run sequentially.
beforeAll(async () => {
  await Promise.all([
    import('@/ui/layouts/app-layout.js'),
    import('@/ui/pages/DashboardPage.js'),
    import('@/ui/pages/ActivityPage.js'),
    import('@/ui/pages/ProjectListPage.js'),
    import('@/ui/pages/WorkItemDetailPage.js'),
    import('@/ui/pages/ItemTimelinePage.js'),
    import('@/ui/pages/DependencyGraphPage.js'),
    import('@/ui/pages/KanbanPage.js'),
    import('@/ui/pages/GlobalTimelinePage.js'),
    import('@/ui/pages/ContactsPage.js'),
    import('@/ui/pages/SettingsPage.js'),
    import('@/ui/pages/SearchPage.js'),
    import('@/ui/pages/NotFoundPage.js'),
  ]);
});

// Mock the api-client to prevent real network requests
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn().mockRejectedValue(new Error('Not implemented in test')),
    post: vi.fn().mockRejectedValue(new Error('Not implemented in test')),
    patch: vi.fn().mockRejectedValue(new Error('Not implemented in test')),
    delete: vi.fn().mockRejectedValue(new Error('Not implemented in test')),
  },
}));

// Mock user context to simulate an authenticated user (issue #1166).
// Without this, the auth guard in AppLayout blocks all route rendering.
vi.mock('@/ui/contexts/user-context', () => ({
  useUser: () => ({ email: 'test@example.com', isLoading: false, isAuthenticated: true }),
  useUserEmail: () => 'test@example.com',
  UserProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock command palette to avoid cmdk jsdom rendering issues in route tests
vi.mock('@/ui/components/command-palette', () => ({
  CommandPalette: () => null,
}));

/** Generous timeout for waitFor under full-suite load. */
const WAIT_OPTS = { timeout: 5_000 };

/**
 * Helper to render with a MemoryRouter at the given initial path,
 * wrapped in QueryClientProvider for TanStack Query hooks.
 */
function renderWithRouter(initialPath = '/') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const router = createMemoryRouter(routes, {
    initialEntries: [initialPath],
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Route rendering tests
// ---------------------------------------------------------------------------
describe('Route configuration', () => {
  it('redirects root to /dashboard', async () => {
    renderWithRouter('/');
    await waitFor(() => {
      expect(screen.getByTestId('page-dashboard')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('renders ActivityPage at /activity', async () => {
    renderWithRouter('/activity');
    await waitFor(() => {
      expect(screen.getByTestId('page-activity')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('renders ProjectListPage at /work-items', async () => {
    renderWithRouter('/work-items');
    await waitFor(() => {
      expect(screen.getByTestId('page-project-list')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('renders WorkItemDetailPage at /work-items/:id', async () => {
    renderWithRouter('/work-items/item-42');
    await waitFor(() => {
      expect(screen.getByTestId('page-work-item-detail')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('renders ItemTimelinePage at /work-items/:id/timeline', async () => {
    renderWithRouter('/work-items/item-42/timeline');
    await waitFor(() => {
      expect(screen.getByTestId('page-item-timeline')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('renders DependencyGraphPage at /work-items/:id/graph', async () => {
    renderWithRouter('/work-items/item-42/graph');
    await waitFor(() => {
      expect(screen.getByTestId('page-dependency-graph')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('renders KanbanPage at /kanban', async () => {
    renderWithRouter('/kanban');
    await waitFor(() => {
      expect(screen.getByTestId('page-kanban')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('renders GlobalTimelinePage at /timeline', async () => {
    renderWithRouter('/timeline');
    await waitFor(() => {
      expect(screen.getByTestId('page-global-timeline')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('renders ContactsPage at /contacts', async () => {
    renderWithRouter('/contacts');
    await waitFor(() => {
      expect(screen.getByTestId('page-contacts')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('renders SettingsPage at /settings', async () => {
    renderWithRouter('/settings');
    await waitFor(() => {
      expect(screen.getByTestId('page-settings')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('renders SearchPage at /search', async () => {
    renderWithRouter('/search');
    await waitFor(() => {
      expect(screen.getByTestId('page-search')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('renders NotFoundPage for unknown routes', async () => {
    renderWithRouter('/this-does-not-exist');
    await waitFor(() => {
      expect(screen.getByTestId('page-not-found')).toBeInTheDocument();
    }, WAIT_OPTS);
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText(/this-does-not-exist/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Navigation tests
// ---------------------------------------------------------------------------
describe('Navigation', () => {
  it('NotFoundPage links back to /activity', async () => {
    renderWithRouter('/unknown-page');

    await waitFor(() => {
      expect(screen.getByTestId('page-not-found')).toBeInTheDocument();
    }, WAIT_OPTS);

    const link = screen.getByRole('link', { name: /go to activity/i });
    expect(link).toBeInTheDocument();

    fireEvent.click(link);

    await waitFor(() => {
      expect(screen.getByTestId('page-activity')).toBeInTheDocument();
    }, WAIT_OPTS);
  });
});
