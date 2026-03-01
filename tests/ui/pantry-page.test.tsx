/**
 * @vitest-environment jsdom
 *
 * Tests for the PantryPage component.
 * Issue #1753: Pantry management page.
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

function renderPage(initialPath = '/pantry') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const PantryPage = React.lazy(() =>
    import('@/ui/pages/PantryPage.js').then((m) => ({ default: m.PantryPage })),
  );

  const routes = [
    {
      path: 'pantry',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <PantryPage />
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

describe('PantryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page with header and add button', async () => {
    mockApiClient.get.mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('page-pantry')).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.getByText('Pantry')).toBeInTheDocument();
    expect(screen.getByTestId('add-pantry-item-button')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockApiClient.get.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows empty state when no items', async () => {
    mockApiClient.get.mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Your pantry is empty.')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('renders pantry items when data is available', async () => {
    mockApiClient.get.mockResolvedValue({
      data: [
        {
          id: 'p1',
          name: 'Organic Milk',
          location: 'Fridge',
          quantity: '1L',
          category: 'dairy',
          is_leftover: false,
          use_by_date: '2026-03-01',
          use_soon: false,
          is_depleted: false,
          created_at: '2026-02-20T10:00:00Z',
          updated_at: '2026-02-20T10:00:00Z',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Organic Milk')).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.getByText('Fridge')).toBeInTheDocument();
  });

  it('highlights items expiring soon', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    mockApiClient.get.mockResolvedValue({
      data: [
        {
          id: 'p2',
          name: 'Yogurt',
          location: 'Fridge',
          quantity: '500g',
          category: 'dairy',
          is_leftover: false,
          use_by_date: tomorrow.toISOString().split('T')[0],
          use_soon: true,
          is_depleted: false,
          created_at: '2026-02-20T10:00:00Z',
          updated_at: '2026-02-20T10:00:00Z',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Yogurt')).toBeInTheDocument();
    }, { timeout: 5000 });

    // The expiring-soon item should have a visual indicator
    expect(screen.getByTestId('expiry-warning-p2')).toBeInTheDocument();
  });
});
