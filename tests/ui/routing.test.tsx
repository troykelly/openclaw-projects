/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from '@/ui/routes.js';

// Mock the api-client to prevent real network requests
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn().mockRejectedValue(new Error('Not implemented in test')),
    post: vi.fn().mockRejectedValue(new Error('Not implemented in test')),
    patch: vi.fn().mockRejectedValue(new Error('Not implemented in test')),
    delete: vi.fn().mockRejectedValue(new Error('Not implemented in test')),
  },
}));

// Mock command palette to avoid cmdk jsdom rendering issues in route tests
vi.mock('@/ui/components/command-palette', () => ({
  CommandPalette: () => null,
}));

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
    });
  });

  it('renders ActivityPage at /activity', async () => {
    renderWithRouter('/activity');
    await waitFor(() => {
      expect(screen.getByTestId('page-activity')).toBeInTheDocument();
    });
  });

  it('renders ProjectListPage at /work-items', async () => {
    renderWithRouter('/work-items');
    await waitFor(() => {
      expect(screen.getByTestId('page-project-list')).toBeInTheDocument();
    });
  });

  it('renders WorkItemDetailPage at /work-items/:id', async () => {
    renderWithRouter('/work-items/item-42');
    await waitFor(() => {
      expect(screen.getByTestId('page-work-item-detail')).toBeInTheDocument();
    });
  });

  it('renders ItemTimelinePage at /work-items/:id/timeline', async () => {
    renderWithRouter('/work-items/item-42/timeline');
    await waitFor(() => {
      expect(screen.getByTestId('page-item-timeline')).toBeInTheDocument();
    });
  });

  it('renders DependencyGraphPage at /work-items/:id/graph', async () => {
    renderWithRouter('/work-items/item-42/graph');
    await waitFor(() => {
      expect(screen.getByTestId('page-dependency-graph')).toBeInTheDocument();
    });
  });

  it('renders KanbanPage at /kanban', async () => {
    renderWithRouter('/kanban');
    await waitFor(() => {
      expect(screen.getByTestId('page-kanban')).toBeInTheDocument();
    });
  });

  it('renders GlobalTimelinePage at /timeline', async () => {
    renderWithRouter('/timeline');
    await waitFor(() => {
      expect(screen.getByTestId('page-global-timeline')).toBeInTheDocument();
    });
  });

  it('renders ContactsPage at /contacts', async () => {
    renderWithRouter('/contacts');
    await waitFor(() => {
      expect(screen.getByTestId('page-contacts')).toBeInTheDocument();
    });
  });

  it('renders SettingsPage at /settings', async () => {
    renderWithRouter('/settings');
    await waitFor(() => {
      expect(screen.getByTestId('page-settings')).toBeInTheDocument();
    });
  });

  it('renders SearchPage at /search', async () => {
    renderWithRouter('/search');
    await waitFor(() => {
      expect(screen.getByTestId('page-search')).toBeInTheDocument();
    });
  });

  it('renders NotFoundPage for unknown routes', async () => {
    renderWithRouter('/this-does-not-exist');
    await waitFor(() => {
      expect(screen.getByTestId('page-not-found')).toBeInTheDocument();
    });
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
    });

    const link = screen.getByRole('link', { name: /go to activity/i });
    expect(link).toBeInTheDocument();

    fireEvent.click(link);

    await waitFor(() => {
      expect(screen.getByTestId('page-activity')).toBeInTheDocument();
    });
  });
});
