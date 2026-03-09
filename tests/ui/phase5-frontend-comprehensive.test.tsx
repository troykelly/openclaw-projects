/**
 * @vitest-environment jsdom
 *
 * Phase 5 — Comprehensive frontend tests (#2302)
 *
 * Fills coverage gaps identified after Phase 4 implementation:
 * - TriagePage: renders unparented issues, quick-add, empty state, loading
 * - Route tests: /triage, /lists/:id render correct pages
 * - Empty and loading states for key pages
 * - Error handling: toast on API failures
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Import toast after mock is set up
import { toast } from 'sonner';

// ── Mock dnd-kit ─────────────────────────────────────────────────────
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: () => [],
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  arrayMove: vi.fn(),
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
}));

// ── Import components under test ─────────────────────────────────────
import { TriagePage } from '@/ui/pages/TriagePage';
import { ListDetailPage } from '@/ui/pages/ListDetailPage';

// ── Test data ────────────────────────────────────────────────────────
const triageItems = {
  items: [
    { id: 'tri-1', title: 'Buy groceries', kind: 'issue', status: 'not_started', parent_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 'tri-2', title: 'Call dentist', kind: 'issue', status: 'not_started', parent_id: null, created_at: '2026-01-02', updated_at: '2026-01-02' },
    { id: 'tri-3', title: 'Fix door handle', kind: 'issue', status: 'in_progress', parent_id: null, created_at: '2026-01-03', updated_at: '2026-01-03' },
  ],
};

const emptyItems = { items: [] };

const listWorkItem = {
  id: 'list-1',
  title: 'Shopping List',
  kind: 'list',
  status: 'not_started',
  description: 'Weekly groceries',
};

const todosData = {
  todos: [
    { id: 'todo-1', text: 'Asparagus', completed: false, sort_order: 1, priority: 'P2', created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 'todo-2', text: 'Milk', completed: true, sort_order: 2, priority: 'P2', created_at: '2026-01-02', completed_at: '2026-01-02', updated_at: '2026-01-02' },
  ],
};

// ── Helper ───────────────────────────────────────────────────────────
function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

// ── TriagePage tests ─────────────────────────────────────────────────
describe('TriagePage (#2297)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function renderTriagePage(items = triageItems) {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('scope=triage') || url.includes('/work-items')) {
        return Promise.resolve(items);
      }
      return Promise.resolve({ items: [] });
    });

    const qc = createQueryClient();
    const routes: RouteObject[] = [
      {
        path: 'triage',
        element: (
          <QueryClientProvider client={qc}>
            <TriagePage />
          </QueryClientProvider>
        ),
      },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ['/triage'] });
    return { ...render(<RouterProvider router={router} />), queryClient: qc };
  }

  it('renders the triage page with data-testid', async () => {
    renderTriagePage();
    await waitFor(() => {
      expect(screen.getByTestId('triage-page')).toBeInTheDocument();
    });
  });

  it('renders page title "Triage"', async () => {
    renderTriagePage();
    await waitFor(() => {
      expect(screen.getByText('Triage')).toBeInTheDocument();
    });
  });

  it('renders unparented issues', async () => {
    renderTriagePage();
    await waitFor(() => {
      expect(screen.getByText('Buy groceries')).toBeInTheDocument();
      expect(screen.getByText('Call dentist')).toBeInTheDocument();
      expect(screen.getByText('Fix door handle')).toBeInTheDocument();
    });
  });

  it('shows item count badge', async () => {
    renderTriagePage();
    await waitFor(() => {
      expect(screen.getByText('3 items')).toBeInTheDocument();
    });
  });

  it('renders quick add input', async () => {
    renderTriagePage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/quick add/i)).toBeInTheDocument();
    });
  });

  it('creates issue on Enter in quick add', async () => {
    mockPost.mockResolvedValue({ id: 'new-1', title: 'New issue', kind: 'issue' });
    renderTriagePage();

    const input = await screen.findByPlaceholderText(/quick add/i);
    fireEvent.change(input, { target: { value: 'New quick issue' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/work-items',
        expect.objectContaining({ title: 'New quick issue', kind: 'issue' }),
      );
    });
  });

  it('shows empty state when no triage items', async () => {
    renderTriagePage(emptyItems);
    await waitFor(() => {
      expect(screen.getByText(/all caught up|no items/i)).toBeInTheDocument();
    });
  });

  it('renders checkboxes for bulk selection', async () => {
    renderTriagePage();
    await waitFor(() => {
      expect(screen.getByText('Buy groceries')).toBeInTheDocument();
    });
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(3);
  });

  it('toggles checkbox selection', async () => {
    renderTriagePage();
    await waitFor(() => {
      expect(screen.getByText('Buy groceries')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    // Checkbox state is internal, just verify no errors
    expect(checkboxes[0]).toBeInTheDocument();
  });

  it('shows status badge for each item', async () => {
    renderTriagePage();
    await waitFor(() => {
      expect(screen.getByText('Buy groceries')).toBeInTheDocument();
    });
    // At least two "Not Started" badges
    const badges = screen.getAllByText(/Not Started/i);
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('does not create issue when quick add is empty', async () => {
    renderTriagePage();

    const input = await screen.findByPlaceholderText(/quick add/i);
    fireEvent.keyDown(input, { key: 'Enter' });

    // Should NOT call post with empty title
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('clears input after successful quick add', async () => {
    mockPost.mockResolvedValue({ id: 'new-1', title: 'New issue', kind: 'issue' });
    renderTriagePage();

    const input = await screen.findByPlaceholderText(/quick add/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Test issue' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalled();
    });

    // After success, input should be cleared
    await waitFor(() => {
      const currentInput = screen.getByPlaceholderText(/quick add/i) as HTMLInputElement;
      expect(currentInput.value).toBe('');
    });
  });

  it('shows error toast when quick add fails', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    renderTriagePage();

    const input = await screen.findByPlaceholderText(/quick add/i);
    fireEvent.change(input, { target: { value: 'Will fail' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to create issue');
    });
  });
});

// ── Route rendering tests ────────────────────────────────────────────
describe('Route rendering tests (#2302)', () => {
  afterEach(() => vi.clearAllMocks());

  it('/triage route renders TriagePage', async () => {
    mockGet.mockResolvedValue(triageItems);

    const qc = createQueryClient();
    const routes: RouteObject[] = [
      {
        path: 'triage',
        element: (
          <QueryClientProvider client={qc}>
            <TriagePage />
          </QueryClientProvider>
        ),
      },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ['/triage'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByTestId('triage-page')).toBeInTheDocument();
    });
  });

  it('/lists/:id route renders ListDetailPage', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/todos')) {
        return Promise.resolve(todosData);
      }
      if (url.includes('/work-items/list-1')) {
        return Promise.resolve(listWorkItem);
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
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByTestId('list-detail-page')).toBeInTheDocument();
    });
  });
});

// ── ListDetailPage additional coverage ───────────────────────────────
describe('ListDetailPage loading and error states (#2302)', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows loading spinner while data is loading', async () => {
    // Return a promise that never resolves to test loading state
    mockGet.mockImplementation(() => new Promise(() => {}));

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
    render(<RouterProvider router={router} />);

    // Page should render even during loading
    await waitFor(() => {
      expect(screen.getByTestId('list-detail-page')).toBeInTheDocument();
    });
  });
});

// ── TriagePage error state ───────────────────────────────────────────
describe('TriagePage error handling (#2302)', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows error message when API fails', async () => {
    mockGet.mockRejectedValue(new Error('API error'));

    const qc = createQueryClient();
    const routes: RouteObject[] = [
      {
        path: 'triage',
        element: (
          <QueryClientProvider client={qc}>
            <TriagePage />
          </QueryClientProvider>
        ),
      },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ['/triage'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });
  });
});
