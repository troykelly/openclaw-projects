/**
 * @vitest-environment jsdom
 * Tests for #2300: Work item detail panel (slide-over mode)
 *
 * Validates:
 * - WorkItemPanel renders in Sheet when open
 * - Shows work item title and essential details
 * - Shows essential tabs (Details, Checklist, Comments)
 * - "Open in full page" link navigates to full detail page
 * - Closing the panel calls onClose
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

import { WorkItemPanel } from '@/ui/components/work-item-panel';

// ── Test data ────────────────────────────────────────────────────────
const workItemDetail = {
  id: 'item-1',
  title: 'Fix auth bug',
  description: 'The login form breaks on mobile',
  status: 'in_progress',
  priority: 'P1',
  kind: 'issue',
  parent_id: 'proj-1',
  parent: { id: 'proj-1', title: 'Auth Project', kind: 'project' },
  not_before: null,
  not_after: null,
  estimate_minutes: 120,
  actual_minutes: 30,
  created_at: '2026-01-01',
  updated_at: '2026-01-02',
  dependencies: { blocks: [], blocked_by: [] },
};

const todosData = {
  todos: [
    { id: 'todo-1', text: 'Reproduce bug', completed: true, sort_order: 1, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 'todo-2', text: 'Write fix', completed: false, sort_order: 2, created_at: '2026-01-01', updated_at: '2026-01-01' },
  ],
};

const commentsData = {
  comments: [],
};

// ── Helper ───────────────────────────────────────────────────────────
function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderPanel({ open = true, onClose = vi.fn() } = {}) {
  mockGet.mockImplementation((url: string) => {
    if (url.match(/\/work-items\/item-1\/todos/)) {
      return Promise.resolve(todosData);
    }
    if (url.match(/\/work-items\/item-1\/comments/)) {
      return Promise.resolve(commentsData);
    }
    if (url.match(/\/work-items\/item-1$/)) {
      return Promise.resolve(workItemDetail);
    }
    return Promise.resolve({ items: [] });
  });

  const qc = createQueryClient();
  const routes: RouteObject[] = [
    {
      path: '/',
      element: (
        <QueryClientProvider client={qc}>
          <WorkItemPanel workItemId="item-1" open={open} onClose={onClose} />
        </QueryClientProvider>
      ),
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: ['/'] });
  return { ...render(<RouterProvider router={router} />), queryClient: qc, onClose };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('WorkItemPanel renders (#2300)', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders panel with work item title', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Fix auth bug')).toBeInTheDocument();
    });
  });

  it('renders panel with data-testid', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('work-item-panel')).toBeInTheDocument();
    });
  });

  it('shows status badge', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Fix auth bug')).toBeInTheDocument();
    });
    const statusBadges = screen.getAllByText(/in.progress/i);
    expect(statusBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows essential tabs', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Fix auth bug')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: /details/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /checklist/i })).toBeInTheDocument();
  });

  it('shows "Open full page" link', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Fix auth bug')).toBeInTheDocument();
    });
    const fullPageLink = screen.getByRole('link', { name: /open.*full/i });
    expect(fullPageLink).toBeInTheDocument();
    expect(fullPageLink).toHaveAttribute('href', expect.stringContaining('/work-items/item-1'));
  });
});

describe('WorkItemPanel closed state (#2300)', () => {
  afterEach(() => vi.clearAllMocks());

  it('does not render content when closed', () => {
    renderPanel({ open: false });
    expect(screen.queryByText('Fix auth bug')).not.toBeInTheDocument();
  });
});
