/**
 * @vitest-environment jsdom
 * Tests for #2298: List detail page — todo-based lists
 *
 * Validates:
 * - ListDetailPage renders list title and todos
 * - Inline add creates new todo via API
 * - Checking a todo marks it completed
 * - Progress bar reflects completion ratio
 * - Empty list shows prompt
 * - Completed section toggles visibility
 * - Delete todo removes it from list
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

import { ListDetailPage } from '@/ui/pages/ListDetailPage';

// ── Test data ────────────────────────────────────────────────────────
const listItem = {
  id: 'list-1',
  title: 'Shopping List',
  kind: 'list',
  status: 'not_started',
  description: 'Weekly groceries',
};

const todosData = {
  todos: [
    { id: 'todo-1', text: 'Asparagus', completed: false, sort_order: 1, priority: 'P2', created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 'todo-2', text: 'Milk', completed: false, sort_order: 2, priority: 'P2', created_at: '2026-01-02', updated_at: '2026-01-02' },
    { id: 'todo-3', text: 'Bread', completed: true, sort_order: 3, priority: 'P2', created_at: '2026-01-03', completed_at: '2026-01-03', updated_at: '2026-01-03' },
    { id: 'todo-4', text: 'Eggs', completed: true, sort_order: 4, priority: 'P2', created_at: '2026-01-04', completed_at: '2026-01-04', updated_at: '2026-01-04' },
    { id: 'todo-5', text: 'Butter', completed: true, sort_order: 5, priority: 'P2', created_at: '2026-01-05', completed_at: '2026-01-05', updated_at: '2026-01-05' },
  ],
};

const emptyTodos = { todos: [] };

// ── Helper ───────────────────────────────────────────────────────────
function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderListDetailPage(listData = listItem, todos = todosData) {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/work-items/list-1/todos')) {
      return Promise.resolve(todos);
    }
    if (url.includes('/work-items/list-1')) {
      return Promise.resolve(listData);
    }
    return Promise.resolve({ items: [] });
  });

  const qc = createQueryClient();
  const routes: RouteObject[] = [
    {
      path: 'lists/:id',
      element: (
        <QueryClientProvider client={qc}>
          <ListDetailPage />
        </QueryClientProvider>
      ),
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: ['/lists/list-1'] });
  return { ...render(<RouterProvider router={router} />), queryClient: qc };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ListDetailPage renders list and todos (#2298)', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders page with data-testid=list-detail-page', async () => {
    renderListDetailPage();
    await waitFor(() => {
      expect(screen.getByTestId('list-detail-page')).toBeInTheDocument();
    });
  });

  it('renders list title', async () => {
    renderListDetailPage();
    await waitFor(() => {
      expect(screen.getByText('Shopping List')).toBeInTheDocument();
    });
  });

  it('renders todo items', async () => {
    renderListDetailPage();
    await waitFor(() => {
      expect(screen.getByText('Asparagus')).toBeInTheDocument();
      expect(screen.getByText('Milk')).toBeInTheDocument();
    });
  });

  it('renders progress bar with correct ratio', async () => {
    renderListDetailPage();
    await waitFor(() => {
      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toBeInTheDocument();
      expect(progressBar).toHaveAttribute('aria-valuenow', '3');
      expect(progressBar).toHaveAttribute('aria-valuemax', '5');
    });
  });

  it('renders completion count text', async () => {
    renderListDetailPage();
    await waitFor(() => {
      expect(screen.getByText('3/5 completed')).toBeInTheDocument();
    });
  });
});

describe('ListDetailPage inline add (#2298)', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders add item input', async () => {
    renderListDetailPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/add.*item/i)).toBeInTheDocument();
    });
  });

  it('creates todo on Enter key', async () => {
    mockPost.mockResolvedValue({ id: 'new-1', text: 'Cheese', completed: false });
    renderListDetailPage();

    const input = await screen.findByPlaceholderText(/add.*item/i);
    fireEvent.change(input, { target: { value: 'Cheese' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/work-items/list-1/todos',
        expect.objectContaining({ text: 'Cheese' }),
      );
    });
  });
});

describe('ListDetailPage toggle completion (#2298)', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders checkboxes for uncompleted todos', async () => {
    renderListDetailPage();
    await waitFor(() => {
      expect(screen.getByText('Asparagus')).toBeInTheDocument();
    });
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
  });

  it('toggles todo completion via API on checkbox click', async () => {
    mockPatch.mockResolvedValue({ id: 'todo-1', completed: true });
    renderListDetailPage();

    await waitFor(() => {
      expect(screen.getByText('Asparagus')).toBeInTheDocument();
    });

    const checkbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        '/work-items/list-1/todos/todo-1',
        expect.objectContaining({ completed: true }),
      );
    });
  });
});

describe('ListDetailPage empty state (#2298)', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows empty prompt when no todos', async () => {
    renderListDetailPage(listItem, emptyTodos);
    await waitFor(() => {
      expect(screen.getByText(/add your first item|no items yet/i)).toBeInTheDocument();
    });
  });
});

describe('ListDetailPage completed section (#2298)', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders completed items section', async () => {
    renderListDetailPage();
    await waitFor(() => {
      // Both the count text and the toggle button contain "completed"
      const completedElements = screen.getAllByText(/completed/i);
      expect(completedElements.length).toBeGreaterThanOrEqual(1);
    });
    // Completed items should be visible by default
    expect(screen.getByText('Bread')).toBeInTheDocument();
  });

  it('toggles completed section visibility', async () => {
    renderListDetailPage();
    await waitFor(() => {
      expect(screen.getByText('Bread')).toBeInTheDocument();
    });

    // Find and click the hide button
    const toggleBtn = screen.getByRole('button', { name: /hide completed|show completed/i });
    fireEvent.click(toggleBtn);

    // After hiding, completed items should not be visible
    expect(screen.queryByText('Bread')).not.toBeInTheDocument();
  });
});

describe('ListDetailPage delete todo (#2298)', () => {
  afterEach(() => vi.clearAllMocks());

  it('deletes a todo via API', async () => {
    mockDelete.mockResolvedValue({});
    renderListDetailPage();

    await waitFor(() => {
      expect(screen.getByText('Asparagus')).toBeInTheDocument();
    });

    // Find delete button for first todo
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    expect(deleteButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/work-items/list-1/todos/todo-1');
    });
  });
});
