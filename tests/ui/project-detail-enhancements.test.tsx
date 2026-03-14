/**
 * @vitest-environment jsdom
 * Tests for #2299: Project detail page enhancements
 *
 * Validates:
 * - Breadcrumb navigation renders
 * - Hierarchy-aware "Add" button
 * - Progress bar renders with rollup data
 * - View mode tabs render and switch
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock API client ──────────────────────────────────────────────────
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

// ── Mock namespace context ───────────────────────────────────────────
vi.mock('@/ui/contexts/namespace-context', () => ({
  useNamespaceSafe: () => ({
    grants: [{ namespace: 'default' }],
    activeNamespace: 'default',
    setActiveNamespace: vi.fn(),
    hasMultipleNamespaces: false,
  }),
}));

// ── Mock sonner ──────────────────────────────────────────────────────
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Mock work-item-utils bootstrap ───────────────────────────────────
vi.mock('@/ui/lib/work-item-utils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    readBootstrap: () => ({ participants: [] }),
  };
});

import { ProjectDetailPage } from '@/ui/pages/ProjectDetailPage';

// ── Test data ────────────────────────────────────────────────────────
const projectDetail = {
  id: 'proj-1',
  title: 'Renovation',
  description: 'Home renovation project',
  status: 'in_progress',
  priority: 'P1',
  kind: 'project',
  parent_id: null,
  parent: null,
  not_before: '2026-01-01',
  not_after: '2026-06-01',
  estimate_minutes: 4800,
  actual_minutes: 120,
  created_at: '2026-01-01',
  updated_at: '2026-02-01',
  dependencies: { blocks: [], blocked_by: [] },
};

const treeData = {
  items: [
    {
      id: 'proj-1',
      title: 'Renovation',
      kind: 'project',
      status: 'in_progress',
      priority: 'P1',
      parent_id: null,
      children_count: 2,
      children: [
        {
          id: 'init-1',
          title: 'Phase 1',
          kind: 'initiative',
          status: 'in_progress',
          priority: 'P1',
          parent_id: 'proj-1',
          children_count: 1,
          children: [
            {
              id: 'epic-1',
              title: 'Plumbing',
              kind: 'epic',
              status: 'done',
              priority: 'P2',
              parent_id: 'init-1',
              children_count: 0,
              children: [],
            },
          ],
        },
        {
          id: 'issue-1',
          title: 'Fix roof leak',
          kind: 'issue',
          status: 'not_started',
          priority: 'P0',
          parent_id: 'proj-1',
          children_count: 0,
          children: [],
        },
      ],
    },
  ],
};

// ── Helper ───────────────────────────────────────────────────────────
function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderProjectDetailPage() {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/work-items/tree')) {
      return Promise.resolve(treeData);
    }
    if (url.match(/\/work-items\/proj-1$/)) {
      return Promise.resolve(projectDetail);
    }
    if (url.includes('/memories')) {
      return Promise.resolve({ memories: [] });
    }
    return Promise.resolve({ items: [] });
  });

  const qc = createQueryClient();
  const routes: RouteObject[] = [
    {
      path: 'projects/:project_id',
      element: (
        <QueryClientProvider client={qc}>
          <ProjectDetailPage />
        </QueryClientProvider>
      ),
    },
    {
      path: 'projects/:project_id/:view',
      element: (
        <QueryClientProvider client={qc}>
          <ProjectDetailPage />
        </QueryClientProvider>
      ),
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: ['/projects/proj-1'] });
  return { ...render(<RouterProvider router={router} />), queryClient: qc };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ProjectDetailPage breadcrumbs (#2299)', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders breadcrumb with Projects link', async () => {
    renderProjectDetailPage();
    await waitFor(() => {
      expect(screen.getByTestId('project-breadcrumb')).toBeInTheDocument();
    });
    const breadcrumb = screen.getByTestId('project-breadcrumb');
    expect(breadcrumb).toHaveTextContent(/Projects/i);
  });

  it('renders project name in breadcrumb', async () => {
    renderProjectDetailPage();
    await waitFor(() => {
      expect(screen.getByTestId('project-breadcrumb')).toBeInTheDocument();
    });
    const breadcrumb = screen.getByTestId('project-breadcrumb');
    expect(breadcrumb).toHaveTextContent('Renovation');
  });
});

describe('ProjectDetailPage hierarchy-aware add (#2299)', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders add child button for project', async () => {
    renderProjectDetailPage();
    await waitFor(() => {
      expect(screen.getByTestId('add-child-button')).toBeInTheDocument();
    });
    const addBtn = screen.getByTestId('add-child-button');
    expect(addBtn).toHaveTextContent(/add.*initiative/i);
  });
});

describe('ProjectDetailPage progress (#2299)', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders progress bar', async () => {
    renderProjectDetailPage();
    await waitFor(() => {
      expect(screen.getByTestId('progress-bar')).toBeInTheDocument();
    });
  });

  it('shows item count text', async () => {
    renderProjectDetailPage();
    await waitFor(() => {
      // tree has 3 descendants: Phase 1, Plumbing, Fix roof leak
      // 1 done (Plumbing) of 3 total
      expect(screen.getByText(/1 of 3 items done/)).toBeInTheDocument();
    });
  });
});

describe('ProjectDetailPage view tabs (#2299)', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders all view mode tabs', async () => {
    renderProjectDetailPage();
    await waitFor(() => {
      expect(screen.getByTestId('project-breadcrumb')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: /list/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /board/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /tree/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /calendar/i })).toBeInTheDocument();
  });

  it('defaults to list view', async () => {
    renderProjectDetailPage();
    await waitFor(() => {
      expect(screen.getByTestId('view-list')).toBeInTheDocument();
    });
  });
});
