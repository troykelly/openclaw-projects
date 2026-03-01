/**
 * @vitest-environment jsdom
 *
 * Tests for the RecipesPage component.
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

function renderPage(initialPath = '/recipes') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const RecipesPage = React.lazy(() =>
    import('@/ui/pages/RecipesPage.js').then((m) => ({ default: m.RecipesPage })),
  );

  const routes = [
    {
      path: 'recipes',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <RecipesPage />
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

describe('RecipesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page with header and create button', async () => {
    mockApiClient.get.mockResolvedValue({ recipes: [], total: 0 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('page-recipes')).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.getByText('Recipes')).toBeInTheDocument();
    expect(screen.getByTestId('create-recipe-button')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    // Never resolve the query so it stays in loading
    mockApiClient.get.mockReturnValue(new Promise(() => {}));

    renderPage();

    // The Suspense fallback or the component's own loading state should be present
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows empty state when no recipes', async () => {
    mockApiClient.get.mockResolvedValue({ recipes: [], total: 0 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No recipes found.')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('renders recipe list when data is available', async () => {
    mockApiClient.get.mockResolvedValue({
      recipes: [
        { id: 'r1', title: 'Spaghetti Bolognese', cuisine: 'Italian', total_time_min: 45, is_favourite: false },
        { id: 'r2', title: 'Pad Thai', cuisine: 'Thai', total_time_min: 30, is_favourite: true },
      ],
      total: 2,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Spaghetti Bolognese')).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(screen.getByText('Pad Thai')).toBeInTheDocument();
  });
});
