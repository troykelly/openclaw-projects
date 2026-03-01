/**
 * @vitest-environment jsdom
 *
 * Tests for the enhanced ActivityPage.
 * Issue #470: Rebuild activity feed with filters, day grouping,
 * type icons, and responsive layout.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, configure } from '@testing-library/react';

// Increase asyncUtilTimeout — React.lazy module resolution is slower
// under resource contention in parallel test workers.
configure({ asyncUtilTimeout: 5000 });
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ActivityResponse } from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const today = new Date();
const yesterday = new Date(today.getTime() - 86400000);
const twoDaysAgo = new Date(today.getTime() - 86400000 * 2);

const mockActivityData: ActivityResponse = {
  items: [
    {
      id: 'act-1',
      type: 'created',
      work_item_id: 'wi-1',
      work_item_title: 'Implement login flow',
      actor_email: 'dev@example.com',
      description: 'Created the work item',
      created_at: today.toISOString(),
    },
    {
      id: 'act-2',
      type: 'status_change',
      work_item_id: 'wi-1',
      work_item_title: 'Implement login flow',
      actor_email: 'agent@openclaw.ai',
      description: 'Changed status to in_progress',
      created_at: today.toISOString(),
    },
    {
      id: 'act-3',
      type: 'updated',
      work_item_id: 'wi-2',
      work_item_title: 'Fix database migration',
      actor_email: 'dev@example.com',
      description: 'Updated priority to P1',
      created_at: yesterday.toISOString(),
    },
    {
      id: 'act-4',
      type: 'commented',
      work_item_id: 'wi-3',
      work_item_title: 'Design system review',
      actor_email: null,
      description: 'System generated a comment',
      created_at: twoDaysAgo.toISOString(),
    },
  ],
};

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/api/activity')) {
      return Promise.resolve(mockActivityData);
    }
    return Promise.reject(new Error('Unknown endpoint'));
  }),
  post: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithRouter(initialPath = '/activity') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const ActivityPage = React.lazy(() => import('@/ui/pages/ActivityPage.js').then((m) => ({ default: m.ActivityPage })));

  const routes = [
    {
      path: 'activity',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <ActivityPage />
        </React.Suspense>
      ),
    },
  ];

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
// Tests
// ---------------------------------------------------------------------------

describe('ActivityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/api/activity')) {
        return Promise.resolve(mockActivityData);
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  describe('Loading state', () => {
    it('shows skeleton loader while loading', async () => {
      mockApiClient.get.mockReturnValue(new Promise(() => {}));

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByTestId('page-activity')).toBeInTheDocument();
      });
    });
  });

  describe('Error state', () => {
    it('shows error state when API fails', async () => {
      mockApiClient.get.mockRejectedValue(new Error('Server error'));

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Failed to load activity')).toBeInTheDocument();
      });
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no activities', async () => {
      mockApiClient.get.mockResolvedValue({ items: [] });

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('No activity yet')).toBeInTheDocument();
      });
    });
  });

  describe('Header', () => {
    it('renders the page title', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Activity Feed')).toBeInTheDocument();
      });
    });

    it('renders a subtitle', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/recent updates/i)).toBeInTheDocument();
      });
    });
  });

  describe('Filter bar', () => {
    it('renders filter buttons for activity types', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Activity Feed')).toBeInTheDocument();
      });

      // Should have an "All" filter option
      expect(screen.getByRole('button', { name: /all/i })).toBeInTheDocument();
    });

    it('renders work items filter', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Activity Feed')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /work items/i })).toBeInTheDocument();
    });
  });

  describe('Activity items', () => {
    it('renders activity items from the feed', async () => {
      renderWithRouter();

      await waitFor(() => {
        // Multiple items may reference the same work item title
        expect(screen.getAllByText('Implement login flow').length).toBeGreaterThan(0);
      });
    });

    it('renders multiple activity items', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Fix database migration')).toBeInTheDocument();
      });
    });

    it('displays actor names', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getAllByText('dev@example.com').length).toBeGreaterThan(0);
      });
    });

    it('displays action descriptions', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Created the work item')).toBeInTheDocument();
      });
    });
  });

  describe('Day grouping', () => {
    it('groups activities by date with separators', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getAllByText('Implement login flow').length).toBeGreaterThan(0);
      });

      // Should have date separator elements
      const dateSeparators = screen.getAllByTestId('date-separator');
      expect(dateSeparators.length).toBeGreaterThan(0);
    });
  });

  describe('Activity type icons', () => {
    it('renders distinctive icons per activity type', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getAllByText('Implement login flow').length).toBeGreaterThan(0);
      });

      // Each activity item should have an icon indicator
      const icons = screen.getAllByTestId('activity-type-icon');
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  describe('Responsive layout', () => {
    it('renders the page-level test id', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByTestId('page-activity')).toBeInTheDocument();
      });
    });
  });

  describe('Work item links', () => {
    it('renders links to work items', async () => {
      renderWithRouter();

      await waitFor(() => {
        const links = screen.getAllByText('Implement login flow');
        // At least one should be a link to the work item
        const anchor = links.find((el) => el.closest('a'));
        expect(anchor).toBeDefined();
        expect(anchor!.closest('a')).toHaveAttribute('href', '/work-items/wi-1');
      });
    });
  });
});
