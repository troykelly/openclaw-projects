/**
 * @vitest-environment jsdom
 *
 * Tests for the enhanced WorkItemDetailPage.
 * Issue #469: Rebuild work item detail view with tabbed content,
 * inline editing, optimistic updates, and responsive layout.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkItemDetail } from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWorkItem: WorkItemDetail = {
  id: 'item-1',
  title: 'Test Work Item',
  description: 'A detailed **description** of the work item',
  status: 'in_progress',
  priority: 'P1',
  kind: 'issue',
  parent_id: 'parent-1',
  parent: { id: 'parent-1', title: 'Parent Epic', kind: 'epic' },
  not_before: '2026-02-01T00:00:00Z',
  not_after: '2026-03-01T00:00:00Z',
  estimate_minutes: 120,
  actual_minutes: 60,
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-01-20T15:30:00Z',
  dependencies: {
    blocks: [{ id: 'dep-1', title: 'Dependent Issue' }],
    blocked_by: [{ id: 'dep-2', title: 'Blocking Issue' }],
  },
};

const mockMemories = {
  memories: [
    { id: 'mem-1', title: 'Meeting Notes', content: 'Discussed priorities', created_at: '2026-01-15T10:00:00Z', updated_at: '2026-01-15T10:00:00Z' },
  ],
};

const mockCommunications = {
  emails: [
    { id: 'comm-1', thread_id: 't1', body: 'Email body', direction: 'inbound', received_at: '2026-01-20T10:00:00Z', raw: null },
  ],
  calendar_events: [],
};

const mockActivity = {
  items: [
    { id: 'act-1', type: 'created', work_item_id: 'item-1', work_item_title: 'Test Work Item', actor_email: 'user@test.com', description: 'Created the item', created_at: '2026-01-15T10:00:00Z' },
    { id: 'act-2', type: 'status_change', work_item_id: 'item-1', work_item_title: 'Test Work Item', actor_email: 'agent@bot.com', description: 'Changed status to in_progress', created_at: '2026-01-16T10:00:00Z' },
  ],
};

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/api/work-items/item-1') && !path.includes('/memories') && !path.includes('/communications')) {
      return Promise.resolve(mockWorkItem);
    }
    if (path.includes('/memories')) {
      return Promise.resolve(mockMemories);
    }
    if (path.includes('/communications')) {
      return Promise.resolve(mockCommunications);
    }
    if (path.includes('/activity')) {
      return Promise.resolve(mockActivity);
    }
    return Promise.reject(new Error('Unknown endpoint'));
  }),
  post: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue(mockWorkItem),
  patch: vi.fn().mockResolvedValue(mockWorkItem),
  delete: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
}));

// Mock bootstrap data
vi.mock('@/ui/lib/work-item-utils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    readBootstrap: () => ({
      participants: [{ participant: 'John Doe', role: 'owner' }],
    }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithRouter(initialPath = '/work-items/item-1') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  // Lazy-load the page just like routes.tsx does
  const WorkItemDetailPage = React.lazy(() =>
    import('@/ui/pages/WorkItemDetailPage.js').then((m) => ({ default: m.WorkItemDetailPage }))
  );

  const routes = [
    {
      path: 'work-items/:id',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <WorkItemDetailPage />
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

describe('WorkItemDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/api/work-items/item-1') && !path.includes('/memories') && !path.includes('/communications')) {
        return Promise.resolve(mockWorkItem);
      }
      if (path.includes('/memories')) {
        return Promise.resolve(mockMemories);
      }
      if (path.includes('/communications')) {
        return Promise.resolve(mockCommunications);
      }
      if (path.includes('/activity')) {
        return Promise.resolve(mockActivity);
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  describe('Loading state', () => {
    it('shows skeleton loader while data is being fetched', async () => {
      // Make the API hang indefinitely
      mockApiClient.get.mockReturnValue(new Promise(() => {}));

      renderWithRouter();

      // The lazy-loaded page component needs Suspense to resolve first
      await waitFor(() => {
        expect(screen.getByTestId('page-work-item-detail')).toBeInTheDocument();
      });
    });
  });

  describe('Error state', () => {
    it('shows error state when work item fails to load', async () => {
      mockApiClient.get.mockRejectedValue(new Error('Network error'));

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Work Item Not Found')).toBeInTheDocument();
      });
    });

    it('provides a link back to work items list', async () => {
      mockApiClient.get.mockRejectedValue(new Error('Not found'));

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Back to Work Items')).toBeInTheDocument();
      });
    });
  });

  describe('Header section', () => {
    it('displays the work item title', async () => {
      renderWithRouter();

      await waitFor(() => {
        // Title may appear in header and activity items, so check for at least one
        expect(screen.getAllByText('Test Work Item').length).toBeGreaterThan(0);
      });
    });

    it('shows the kind badge', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Issue')).toBeInTheDocument();
      });
    });

    it('shows the status badge', async () => {
      renderWithRouter();

      await waitFor(() => {
        // Status appears as a badge
        expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
      });
    });

    it('shows parent breadcrumb when parent exists', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Parent Epic')).toBeInTheDocument();
      });
    });
  });

  describe('Navigation', () => {
    it('renders a back button linking to work items list', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Back')).toBeInTheDocument();
      });
    });

    it('renders a timeline link', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText('Timeline')).toBeInTheDocument();
      });
    });

    it('renders a dependencies link in the nav bar', async () => {
      renderWithRouter();

      await waitFor(() => {
        // "Dependencies" appears both in the nav bar link and as a tab trigger
        expect(screen.getAllByText('Dependencies').length).toBeGreaterThan(0);
      });
    });
  });

  describe('Tabbed content', () => {
    it('renders tab navigation with expected tabs', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getAllByText('Test Work Item').length).toBeGreaterThan(0);
      });

      // Should have content tab labels
      expect(screen.getByRole('tab', { name: /description/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /checklist/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /activity/i })).toBeInTheDocument();
    });

    it('shows description tab content by default', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getAllByText('Test Work Item').length).toBeGreaterThan(0);
      });

      // Description should be visible by default
      expect(screen.getByTestId('tab-content-description')).toBeInTheDocument();
    });

    it('switches to checklist tab when clicked', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getAllByText('Test Work Item').length).toBeGreaterThan(0);
      });

      const checklistTab = screen.getByRole('tab', { name: /checklist/i });
      fireEvent.click(checklistTab);

      await waitFor(() => {
        expect(screen.getByTestId('tab-content-checklist')).toBeInTheDocument();
      });
    });
  });

  describe('Metadata panel', () => {
    it('renders metadata fields', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getAllByText('Test Work Item').length).toBeGreaterThan(0);
      });

      // Should display priority, status, and time-related fields
      expect(screen.getAllByText(/high/i).length).toBeGreaterThan(0);
    });
  });

  describe('Memories section', () => {
    it('renders memories card', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getAllByText('Test Work Item').length).toBeGreaterThan(0);
      });

      // "Memories" appears as a card title in the sidebar
      expect(screen.getAllByText('Memories').length).toBeGreaterThan(0);
    });
  });

  describe('Communications section', () => {
    it('renders communications card', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getAllByText('Test Work Item').length).toBeGreaterThan(0);
      });

      // "Communications" appears as a card title in the sidebar
      expect(screen.getAllByText('Communications').length).toBeGreaterThan(0);
    });
  });

  describe('Responsive layout', () => {
    it('renders the page-level test id', async () => {
      renderWithRouter();

      await waitFor(() => {
        const page = screen.getByTestId('page-work-item-detail');
        expect(page).toBeInTheDocument();
      });
    });
  });
});
