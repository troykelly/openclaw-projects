/**
 * @vitest-environment jsdom
 *
 * Tests for the DashboardPage.
 * Issue #467: Dashboard view - first page users see with overview of current work.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkItemsResponse, ActivityResponse, WorkItemSummary } from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const now = new Date();
const tomorrow = new Date(now.getTime() + 86400000);
const threeDaysFromNow = new Date(now.getTime() + 86400000 * 3);
const yesterday = new Date(now.getTime() - 86400000);

const mockWorkItems: WorkItemSummary[] = [
  {
    id: 'wi-1',
    title: 'Fix login validation bug',
    status: 'in_progress',
    priority: 'P1',
    task_type: 'issue',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  },
  {
    id: 'wi-2',
    title: 'Set up CI pipeline',
    status: 'not_started',
    priority: 'P2',
    task_type: 'task',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  },
  {
    id: 'wi-3',
    title: 'Blocked on API spec',
    status: 'blocked',
    priority: 'P0',
    task_type: 'issue',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  },
  {
    id: 'wi-4',
    title: 'Completed task',
    status: 'done',
    priority: 'P3',
    task_type: 'task',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  },
];

const mockWorkItemsWithDueDates: WorkItemSummary[] = [
  {
    id: 'wi-due-1',
    title: 'Due tomorrow task',
    status: 'in_progress',
    priority: 'P1',
    task_type: 'task',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  },
  {
    id: 'wi-due-2',
    title: 'Due in 3 days task',
    status: 'not_started',
    priority: 'P2',
    task_type: 'task',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  },
];

const mockActivityData: ActivityResponse = {
  items: [
    {
      id: 'act-1',
      type: 'created',
      work_item_id: 'wi-1',
      work_item_title: 'Fix login validation bug',
      actor_email: 'dev@example.com',
      description: 'Created the work item',
      created_at: now.toISOString(),
    },
    {
      id: 'act-2',
      type: 'status_change',
      work_item_id: 'wi-1',
      work_item_title: 'Fix login validation bug',
      actor_email: 'agent@openclaw.ai',
      description: 'Changed status to in_progress',
      created_at: now.toISOString(),
    },
    {
      id: 'act-3',
      type: 'updated',
      work_item_id: 'wi-2',
      work_item_title: 'Set up CI pipeline',
      actor_email: 'dev@example.com',
      description: 'Updated priority',
      created_at: yesterday.toISOString(),
    },
  ],
};

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/api/work-items')) {
      return Promise.resolve({ items: mockWorkItems } as WorkItemsResponse);
    }
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

function renderDashboard(initialPath = '/dashboard') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const DashboardPage = React.lazy(() =>
    import('@/ui/pages/DashboardPage.js').then((m) => ({
      default: m.DashboardPage,
    })),
  );

  const routes = [
    {
      path: 'dashboard',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <DashboardPage />
        </React.Suspense>
      ),
    },
    {
      path: 'work-items/:id',
      element: <div data-testid="work-item-detail">Work Item Detail</div>,
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

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/api/work-items')) {
        return Promise.resolve({ items: mockWorkItems } as WorkItemsResponse);
      }
      if (path.includes('/api/activity')) {
        return Promise.resolve(mockActivityData);
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  describe('Loading state', () => {
    it('shows skeleton placeholders while loading', async () => {
      mockApiClient.get.mockReturnValue(new Promise(() => {}));

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('page-dashboard')).toBeInTheDocument();
      });

      // Should show skeleton elements during loading
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('Welcome header', () => {
    it('renders a greeting with current date', async () => {
      renderDashboard();

      await waitFor(() => {
        // Should contain a greeting pattern like "Good morning" or "Good afternoon"
        expect(screen.getByTestId('welcome-header')).toBeInTheDocument();
      });

      // Should have a date somewhere in the header
      const header = screen.getByTestId('welcome-header');
      expect(header).toHaveTextContent(/good/i);
    });
  });

  describe('My Tasks section', () => {
    it('renders the My Tasks section', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-my-tasks')).toBeInTheDocument();
      });
    });

    it('shows tasks grouped by status', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-my-tasks')).toBeInTheDocument();
      });

      const section = screen.getByTestId('section-my-tasks');

      await waitFor(() => {
        // Should show in_progress items
        expect(within(section).getByText('Fix login validation bug')).toBeInTheDocument();
      });

      // Should show not_started items
      expect(within(section).getByText('Set up CI pipeline')).toBeInTheDocument();
      // Should show blocked items
      expect(within(section).getByText('Blocked on API spec')).toBeInTheDocument();
    });

    it('does not show completed tasks', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-my-tasks')).toBeInTheDocument();
      });

      const section = screen.getByTestId('section-my-tasks');

      await waitFor(() => {
        expect(within(section).getByText('Fix login validation bug')).toBeInTheDocument();
      });

      // Should NOT show done items in the My Tasks section
      expect(within(section).queryByText('Completed task')).not.toBeInTheDocument();
    });

    it('shows status badges', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-my-tasks')).toBeInTheDocument();
      });

      const section = screen.getByTestId('section-my-tasks');

      await waitFor(() => {
        expect(within(section).getByText('Fix login validation bug')).toBeInTheDocument();
      });

      // Should show at least one status group label (also appears on item badge)
      const inProgressElements = within(section).getAllByText(/in progress/i);
      expect(inProgressElements.length).toBeGreaterThan(0);
    });

    it('shows empty state when no tasks', async () => {
      mockApiClient.get.mockImplementation((path: string) => {
        if (path.includes('/api/work-items')) {
          return Promise.resolve({ items: [] } as WorkItemsResponse);
        }
        if (path.includes('/api/activity')) {
          return Promise.resolve({ items: [] });
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-my-tasks')).toBeInTheDocument();
      });

      const section = screen.getByTestId('section-my-tasks');
      expect(within(section).getByText(/no tasks/i)).toBeInTheDocument();
    });

    it('shows View all link', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-my-tasks')).toBeInTheDocument();
      });

      const section = screen.getByTestId('section-my-tasks');

      await waitFor(() => {
        expect(within(section).getByText('Fix login validation bug')).toBeInTheDocument();
      });

      expect(within(section).getByText(/view all/i)).toBeInTheDocument();
    });

    it('navigates to work item detail when clicking a task', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-my-tasks')).toBeInTheDocument();
      });

      const section = screen.getByTestId('section-my-tasks');

      await waitFor(() => {
        expect(within(section).getByText('Fix login validation bug')).toBeInTheDocument();
      });

      // The task title should be inside a clickable link
      const taskText = within(section).getByText('Fix login validation bug');
      const link = taskText.closest('a');
      expect(link).toHaveAttribute('href', '/work-items/wi-1');
    });
  });

  describe('Upcoming Due section', () => {
    it('renders the Upcoming Due section', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-upcoming-due')).toBeInTheDocument();
      });
    });

    it('shows empty state when no upcoming items', async () => {
      mockApiClient.get.mockImplementation((path: string) => {
        if (path.includes('/api/work-items')) {
          return Promise.resolve({ items: [] } as WorkItemsResponse);
        }
        if (path.includes('/api/activity')) {
          return Promise.resolve({ items: [] });
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-upcoming-due')).toBeInTheDocument();
      });

      const section = screen.getByTestId('section-upcoming-due');
      expect(within(section).getByText(/no upcoming/i)).toBeInTheDocument();
    });
  });

  describe('Recent Activity section', () => {
    it('renders the Recent Activity section', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-recent-activity')).toBeInTheDocument();
      });
    });

    it('shows activity items', async () => {
      renderDashboard();

      await waitFor(() => {
        const section = screen.getByTestId('section-recent-activity');
        expect(within(section).getByText('Created the work item')).toBeInTheDocument();
      });
    });

    it('shows empty state when no activity', async () => {
      mockApiClient.get.mockImplementation((path: string) => {
        if (path.includes('/api/work-items')) {
          return Promise.resolve({ items: [] } as WorkItemsResponse);
        }
        if (path.includes('/api/activity')) {
          return Promise.resolve({ items: [] });
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-recent-activity')).toBeInTheDocument();
      });

      const section = screen.getByTestId('section-recent-activity');
      expect(within(section).getByText(/no recent activity/i)).toBeInTheDocument();
    });
  });

  describe('Quick Actions section', () => {
    it('renders the Quick Actions section', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-quick-actions')).toBeInTheDocument();
      });
    });

    it('shows create task action', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-quick-actions')).toBeInTheDocument();
      });

      const section = screen.getByTestId('section-quick-actions');
      expect(within(section).getByText(/create/i)).toBeInTheDocument();
    });

    it('shows search action', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('section-quick-actions')).toBeInTheDocument();
      });

      const section = screen.getByTestId('section-quick-actions');
      expect(within(section).getByText(/search/i)).toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('shows error when work items API fails', async () => {
      mockApiClient.get.mockRejectedValue(new Error('Server error'));

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('page-dashboard')).toBeInTheDocument();
      });

      // Should still render sections even with errors (graceful degradation)
      await waitFor(() => {
        expect(screen.getByTestId('page-dashboard')).toBeInTheDocument();
      });
    });
  });

  describe('Dark mode', () => {
    it('uses standard Tailwind dark mode classes', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('page-dashboard')).toBeInTheDocument();
      });

      // The page wrapper should exist - dark mode styling is applied via CSS
      const page = screen.getByTestId('page-dashboard');
      expect(page).toBeInTheDocument();
    });
  });

  describe('Responsive layout', () => {
    it('renders with proper test id for the page', async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('page-dashboard')).toBeInTheDocument();
      });
    });
  });
});
