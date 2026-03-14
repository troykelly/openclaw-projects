/**
 * @vitest-environment jsdom
 *
 * Tests for the MealLogPage component.
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

function renderPage(initialPath = '/meal-log') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const MealLogPage = React.lazy(() =>
    import('@/ui/pages/MealLogPage.js').then((m) => ({ default: m.MealLogPage })),
  );

  const routes = [
    {
      path: 'meal-log',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <MealLogPage />
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

describe('MealLogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page with header and log button', async () => {
    mockApiClient.get.mockResolvedValue({ meals: [], total: 0 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('page-meal-log')).toBeInTheDocument();
    });

    expect(screen.getByText('Meal Log')).toBeInTheDocument();
    expect(screen.getByTestId('log-meal-button')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockApiClient.get.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows empty state when no meals', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url.includes('/stats')) {
        return Promise.resolve({ total: 0, days: 30, by_source: [], by_cuisine: [] });
      }
      return Promise.resolve({ meals: [], total: 0 });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No meals logged yet.')).toBeInTheDocument();
    });
  });

  it('renders meals when data is available', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url.includes('/stats')) {
        return Promise.resolve({ total: 1, days: 30, by_source: [{ source: 'home_cooked', count: 1 }], by_cuisine: [] });
      }
      return Promise.resolve({
        meals: [
          { id: 'm1', title: 'Pad Thai', meal_type: 'dinner', source: 'home_cooked', meal_date: '2026-02-23', cuisine: 'Thai' },
        ],
        total: 1,
      });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Pad Thai')).toBeInTheDocument();
    });
  });
});
