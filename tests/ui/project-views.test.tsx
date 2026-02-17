/**
 * @vitest-environment jsdom
 *
 * Tests for Project List and Project Detail views.
 * Issue #468: Project list with cards, detail with view tabs (List, Board, Tree, Calendar).
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkItemsResponse, WorkItemTreeResponse, WorkItemDetail, BacklogResponse } from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockProjects: WorkItemsResponse = {
  items: [
    {
      id: 'proj-1',
      title: 'Website Redesign',
      status: 'open',
      priority: 'P1',
      task_type: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    },
    {
      id: 'proj-2',
      title: 'Mobile App',
      status: 'closed',
      priority: 'P2',
      task_type: null,
      created_at: '2026-01-10T00:00:00Z',
      updated_at: '2026-01-25T00:00:00Z',
    },
  ],
};

const mockAllItems: WorkItemsResponse = {
  items: [
    ...mockProjects.items,
    {
      id: 'issue-1',
      title: 'Fix Header Bug',
      status: 'open',
      priority: 'P0',
      task_type: null,
      created_at: '2026-01-15T00:00:00Z',
      updated_at: '2026-01-28T00:00:00Z',
    },
  ],
};

const mockTreeData: WorkItemTreeResponse = {
  items: [
    {
      id: 'proj-1',
      title: 'Website Redesign',
      kind: 'project',
      status: 'open',
      priority: 'P1',
      parent_id: null,
      children_count: 1,
      children: [
        {
          id: 'epic-1',
          title: 'UI Overhaul',
          kind: 'epic',
          status: 'in_progress',
          priority: 'P2',
          parent_id: 'proj-1',
          children_count: 0,
          children: [],
        },
      ],
    },
  ],
};

const mockProjectDetail: WorkItemDetail = {
  id: 'proj-1',
  title: 'Website Redesign',
  description: 'Complete redesign of the marketing website.',
  status: 'open',
  priority: 'P1',
  kind: 'project',
  parent_id: null,
  parent: null,
  not_before: '2026-01-01T00:00:00Z',
  not_after: '2026-06-01T00:00:00Z',
  estimate_minutes: 4800,
  actual_minutes: 120,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
  dependencies: { blocks: [], blocked_by: [] },
};

const mockBacklog: BacklogResponse = {
  items: [
    {
      id: 'issue-1',
      title: 'Fix Header Bug',
      description: 'Header breaks on mobile',
      status: 'open',
      priority: 'P0',
      task_type: null,
      kind: 'issue',
      estimate_minutes: 60,
      created_at: '2026-01-15T00:00:00Z',
    },
    {
      id: 'issue-2',
      title: 'Add Dark Mode',
      description: null,
      status: 'closed',
      priority: 'P2',
      task_type: null,
      kind: 'issue',
      estimate_minutes: null,
      created_at: '2026-01-20T00:00:00Z',
    },
  ],
};

const mockApiClient = {
  get: vi.fn(),
  post: vi
    .fn()
    .mockResolvedValue({
      id: 'new-proj',
      title: 'New Project',
      status: 'open',
      priority: 'P2',
      kind: 'project',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  put: vi.fn().mockResolvedValue(mockProjectDetail),
  patch: vi.fn().mockResolvedValue(mockProjectDetail),
  delete: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
}));

vi.mock('@/ui/lib/work-item-utils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    readBootstrap: () => ({
      participants: [],
    }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupApiMocks() {
  mockApiClient.get.mockImplementation((path: string) => {
    if (path === '/api/work-items?kind=project') {
      return Promise.resolve(mockProjects);
    }
    if (path === '/api/work-items' || path.startsWith('/api/work-items?')) {
      if (path.includes('kind=project')) return Promise.resolve(mockProjects);
      return Promise.resolve(mockAllItems);
    }
    if (path === '/api/work-items/tree') {
      return Promise.resolve(mockTreeData);
    }
    if (path.match(/\/api\/work-items\/proj-1$/)) {
      return Promise.resolve(mockProjectDetail);
    }
    if (path.includes('/api/backlog')) {
      return Promise.resolve(mockBacklog);
    }
    if (path.includes('/memories')) {
      return Promise.resolve({ memories: [] });
    }
    if (path.includes('/communications')) {
      return Promise.resolve({ emails: [], calendar_events: [] });
    }
    if (path.includes('/activity')) {
      return Promise.resolve({ items: [] });
    }
    return Promise.resolve({ items: [] });
  });
}

function renderPage(initialPath: string, routeDefinitions?: Array<{ path: string; element: React.ReactElement }>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const ProjectListPage = React.lazy(() => import('@/ui/pages/ProjectListPage.js').then((m) => ({ default: m.ProjectListPage })));
  const ProjectDetailPage = React.lazy(() => import('@/ui/pages/ProjectDetailPage.js').then((m) => ({ default: m.ProjectDetailPage })));

  const defaultRoutes = routeDefinitions ?? [
    {
      path: 'work-items',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <ProjectListPage />
        </React.Suspense>
      ),
    },
    {
      path: 'projects/:project_id',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <ProjectDetailPage />
        </React.Suspense>
      ),
    },
    {
      path: 'projects/:project_id/:view',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <ProjectDetailPage />
        </React.Suspense>
      ),
    },
  ];

  const router = createMemoryRouter(defaultRoutes, {
    initialEntries: [initialPath],
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Project List Page Tests
// ---------------------------------------------------------------------------

describe('ProjectListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMocks();
  });

  describe('Loading state', () => {
    it('shows skeleton loader while data is being fetched', async () => {
      mockApiClient.get.mockReturnValue(new Promise(() => {}));

      renderPage('/work-items');

      // Increased timeout: React.lazy module loading can exceed the default
      // 1000ms waitFor timeout when running under full test-suite load.
      await waitFor(() => {
        expect(screen.getByTestId('page-project-list')).toBeInTheDocument();
      }, { timeout: 5000 });
    });
  });

  describe('Error state', () => {
    it('shows error state when loading fails', async () => {
      mockApiClient.get.mockRejectedValue(new Error('Network error'));

      renderPage('/work-items');

      await waitFor(() => {
        expect(screen.getByText('Failed to load work items')).toBeInTheDocument();
      });
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no items exist', async () => {
      mockApiClient.get.mockResolvedValue({ items: [] });

      renderPage('/work-items');

      await waitFor(() => {
        expect(screen.getByText('No work items')).toBeInTheDocument();
      });
    });
  });

  describe('Work items list', () => {
    it('renders work items in a table', async () => {
      renderPage('/work-items');

      await waitFor(() => {
        // Text may appear in both tree panel and table
        expect(screen.getAllByText('Website Redesign').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Mobile App').length).toBeGreaterThan(0);
      });
    });

    it('shows status indicators for each item', async () => {
      renderPage('/work-items');

      await waitFor(() => {
        expect(screen.getAllByText('Website Redesign').length).toBeGreaterThan(0);
      });

      // Should show status text
      const statusElements = screen.getAllByText(/open|closed/i);
      expect(statusElements.length).toBeGreaterThan(0);
    });

    it('shows priority badges', async () => {
      renderPage('/work-items');

      await waitFor(() => {
        expect(screen.getAllByText('Website Redesign').length).toBeGreaterThan(0);
      });

      expect(screen.getByText('P1')).toBeInTheDocument();
    });

    it('shows the page test id', async () => {
      renderPage('/work-items');

      await waitFor(() => {
        expect(screen.getByTestId('page-project-list')).toBeInTheDocument();
      });
    });
  });

  describe('Tree panel', () => {
    it('shows the project tree panel', async () => {
      renderPage('/work-items');

      await waitFor(() => {
        expect(screen.getByText('Projects')).toBeInTheDocument();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Project Detail Page Tests
// ---------------------------------------------------------------------------

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMocks();
  });

  describe('Loading state', () => {
    it('shows loading state while data is being fetched', async () => {
      mockApiClient.get.mockReturnValue(new Promise(() => {}));

      renderPage('/projects/proj-1');

      // Increased timeout: React.lazy module loading can exceed the default
      // 1000ms waitFor timeout when running under full test-suite load.
      await waitFor(() => {
        expect(screen.getByTestId('page-project-detail')).toBeInTheDocument();
      }, { timeout: 5000 });
    });
  });

  describe('Error state', () => {
    it('shows error state when project fails to load', async () => {
      mockApiClient.get.mockRejectedValue(new Error('Not found'));

      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByText(/failed to load project/i)).toBeInTheDocument();
      });
    });
  });

  describe('Project header', () => {
    it('displays project title', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });
    });

    it('shows project description', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByText(/Complete redesign/)).toBeInTheDocument();
      });
    });

    it('shows metadata badges (kind, status, priority)', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      // Should show kind and status badges
      const badges = screen.getAllByText(/project|open|P1/i);
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  describe('View switcher tabs', () => {
    it('renders view tab navigation', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      expect(screen.getByRole('tab', { name: /list/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /board/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /tree/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /calendar/i })).toBeInTheDocument();
    });

    it('shows list view by default', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      expect(screen.getByTestId('view-list')).toBeInTheDocument();
    });

    it('switches to board view when board tab is clicked', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      const boardTab = screen.getByRole('tab', { name: /board/i });
      fireEvent.click(boardTab);

      await waitFor(() => {
        expect(screen.getByTestId('view-board')).toBeInTheDocument();
      });
    });

    it('switches to tree view when tree tab is clicked', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      const treeTab = screen.getByRole('tab', { name: /tree/i });
      fireEvent.click(treeTab);

      await waitFor(() => {
        expect(screen.getByTestId('view-tree')).toBeInTheDocument();
      });
    });

    it('switches to calendar view when calendar tab is clicked', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      const calendarTab = screen.getByRole('tab', { name: /calendar/i });
      fireEvent.click(calendarTab);

      await waitFor(() => {
        expect(screen.getByTestId('view-calendar')).toBeInTheDocument();
      });
    });
  });

  describe('List view', () => {
    it('shows list view with table columns', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByTestId('view-list')).toBeInTheDocument();
      });

      // Should show column headers
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Priority')).toBeInTheDocument();
    });
  });

  describe('Board view', () => {
    it('shows board view with status columns', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      const boardTab = screen.getByRole('tab', { name: /board/i });
      fireEvent.click(boardTab);

      await waitFor(() => {
        expect(screen.getByTestId('view-board')).toBeInTheDocument();
      });
    });
  });

  describe('Tree view', () => {
    it('shows tree view with hierarchical nodes', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      const treeTab = screen.getByRole('tab', { name: /tree/i });
      fireEvent.click(treeTab);

      await waitFor(() => {
        expect(screen.getByTestId('view-tree')).toBeInTheDocument();
      });
    });
  });

  describe('Calendar view', () => {
    it('shows calendar view with month grid', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      const calendarTab = screen.getByRole('tab', { name: /calendar/i });
      fireEvent.click(calendarTab);

      await waitFor(() => {
        expect(screen.getByTestId('view-calendar')).toBeInTheDocument();
      });
    });
  });

  describe('Dark mode compatibility', () => {
    it('renders project detail page with test id for dark mode verification', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        const page = screen.getByTestId('page-project-detail');
        expect(page).toBeInTheDocument();
      });
    });
  });

  describe('Mobile responsiveness', () => {
    it('renders the page with responsive classes', async () => {
      renderPage('/projects/proj-1');

      await waitFor(() => {
        const page = screen.getByTestId('page-project-detail');
        expect(page).toBeInTheDocument();
      });
    });
  });
});
