/**
 * @vitest-environment jsdom
 *
 * Tests for the HomeAutomationPage component.
 * Issue #1752: Home Automation routines page.
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

function renderPage(initialPath = '/home-automation') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const HomeAutomationPage = React.lazy(() =>
    import('@/ui/pages/HomeAutomationPage.js').then((m) => ({ default: m.HomeAutomationPage })),
  );

  const routes = [
    {
      path: 'home-automation',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <HomeAutomationPage />
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

describe('HomeAutomationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page with header', async () => {
    mockApiClient.get.mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('page-home-automation')).toBeInTheDocument();
    });

    expect(screen.getByText('Home Automation')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockApiClient.get.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows empty state when no routines', async () => {
    mockApiClient.get.mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No routines detected yet.')).toBeInTheDocument();
    });
  });

  it('renders routines when data is available', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url.includes('/anomalies')) {
        return Promise.resolve({ data: [], total: 0, limit: 50, offset: 0 });
      }
      return Promise.resolve({
        data: [
          {
            id: 'r1',
            title: 'Morning Coffee',
            description: 'Make coffee at 7am',
            status: 'confirmed',
            confidence: 0.95,
            sequence: [{ entity_id: 'switch.coffee_maker' }],
            created_at: '2026-02-20T07:00:00Z',
            updated_at: '2026-02-20T07:00:00Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Morning Coffee')).toBeInTheDocument();
    });
  });

  it('shows status badges for routines', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url.includes('/anomalies')) {
        return Promise.resolve({ data: [], total: 0, limit: 50, offset: 0 });
      }
      return Promise.resolve({
        data: [
          {
            id: 'r1',
            title: 'Morning Coffee',
            description: null,
            status: 'tentative',
            confidence: 0.7,
            sequence: [],
            created_at: '2026-02-20T07:00:00Z',
            updated_at: '2026-02-20T07:00:00Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('tentative')).toBeInTheDocument();
    });
  });
});
