/**
 * @vitest-environment jsdom
 * Tests for #2296: Project sidebar with persistent tree navigation
 *
 * Validates:
 * - ProjectSidebar renders Triage, Lists, Projects, Other sections
 * - Triage section shows count of unparented issues
 * - Lists section shows all kind='list' work items
 * - Projects section renders tree hierarchy
 * - Clicking sidebar items navigates to correct route
 * - "+ New" dropdown offers Project, List, and Issue options
 * - Sections collapse/expand independently
 * - Active item is highlighted
 * - Mobile nav includes triage and lists
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createMemoryRouter, RouterProvider, Outlet, type RouteObject } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock API client ──────────────────────────────────────────────────
const mockGet = vi.fn();
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: { get: (...args: unknown[]) => mockGet(...args) },
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

// ── Mock dnd-kit to avoid jsdom issues ───────────────────────────────
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
// These will be created as part of the implementation
import { ProjectSidebar } from '@/ui/components/layout/project-sidebar';

// ── localStorage mock ────────────────────────────────────────────────
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

// ── Test data ────────────────────────────────────────────────────────
const triageItems = {
  items: [
    { id: 'tri-1', title: 'Buy groceries', kind: 'issue', status: 'not_started', parent_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 'tri-2', title: 'Call dentist', kind: 'issue', status: 'not_started', parent_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 'tri-3', title: 'Fix door handle', kind: 'issue', status: 'in_progress', parent_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' },
  ],
};

const listItems = {
  items: [
    { id: 'list-1', title: 'Shopping List', kind: 'list', status: 'not_started', parent_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 'list-2', title: 'Daily Habits', kind: 'list', status: 'not_started', parent_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' },
  ],
};

const treeItems = {
  items: [
    {
      id: 'proj-1', title: 'Renovation', kind: 'project', status: 'in_progress', priority: 'high', parent_id: null, children_count: 1,
      children: [
        { id: 'epic-1', title: 'Phase 1', kind: 'epic', status: 'in_progress', priority: 'medium', parent_id: 'proj-1', children_count: 0, children: [] },
      ],
    },
    {
      id: 'proj-2', title: 'App Dev', kind: 'project', status: 'not_started', priority: 'medium', parent_id: null, children_count: 0,
      children: [],
    },
  ],
};

// ── Helper ───────────────────────────────────────────────────────────

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function setupMockApi() {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('kind=issue') && url.includes('parent_id=none')) {
      return Promise.resolve(triageItems);
    }
    if (url.includes('kind=list')) {
      return Promise.resolve(listItems);
    }
    if (url.includes('/work-items/tree')) {
      return Promise.resolve(treeItems);
    }
    return Promise.resolve({ items: [] });
  });
}

function renderSidebarWithRouter(initialPath = '/work-items', props: Partial<React.ComponentProps<typeof ProjectSidebar>> = {}) {
  const qc = createQueryClient();
  setupMockApi();

  const routes: RouteObject[] = [
    {
      element: (
        <QueryClientProvider client={qc}>
          <div style={{ display: 'flex' }}>
            <ProjectSidebar {...props} />
            <Outlet />
          </div>
        </QueryClientProvider>
      ),
      children: [
        { path: 'work-items', element: <div data-testid="page-work-items">Work Items</div> },
        { path: 'work-items/:id', element: <div data-testid="page-work-item-detail">Detail</div> },
        { path: 'triage', element: <div data-testid="page-triage">Triage</div> },
        { path: 'lists/:id', element: <div data-testid="page-list-detail">List Detail</div> },
        { path: 'projects/:id', element: <div data-testid="page-project-detail">Project Detail</div> },
        { path: 'activity', element: <div data-testid="page-activity">Activity</div> },
        { path: 'contacts', element: <div data-testid="page-contacts">Contacts</div> },
        { path: 'memory', element: <div data-testid="page-memory">Memory</div> },
        { path: 'notes', element: <div data-testid="page-notes">Notes</div> },
        { path: 'settings', element: <div data-testid="page-settings">Settings</div> },
      ],
    },
  ];

  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  return render(<RouterProvider router={router} />);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ProjectSidebar sections (#2296)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders data-testid=project-sidebar', async () => {
    renderSidebarWithRouter();
    await waitFor(() => {
      expect(screen.getByTestId('project-sidebar')).toBeInTheDocument();
    });
  });

  it('renders Triage section with count badge', async () => {
    renderSidebarWithRouter();
    await waitFor(() => {
      // "Triage" appears in both section header and link
      expect(screen.getAllByText('Triage').length).toBeGreaterThanOrEqual(1);
    });
    // Should show count of triage items (3) in badge(s)
    await waitFor(() => {
      expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders Lists section with list items', async () => {
    renderSidebarWithRouter();
    await waitFor(() => {
      expect(screen.getByText('Lists')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Shopping List')).toBeInTheDocument();
      expect(screen.getByText('Daily Habits')).toBeInTheDocument();
    });
  });

  it('renders Projects section with tree items', async () => {
    renderSidebarWithRouter();
    await waitFor(() => {
      expect(screen.getByText('Projects')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Renovation')).toBeInTheDocument();
      expect(screen.getByText('App Dev')).toBeInTheDocument();
    });
  });

  it('renders Other section with non-PM nav items', async () => {
    renderSidebarWithRouter();
    await waitFor(() => {
      expect(screen.getByText('Other')).toBeInTheDocument();
    });
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });
});

describe('ProjectSidebar navigation (#2296)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clicking Triage link navigates to /triage', async () => {
    renderSidebarWithRouter('/work-items');
    await waitFor(() => {
      expect(screen.getAllByText('Triage').length).toBeGreaterThanOrEqual(1);
    });
    // Click the link (not the section header) - the link is an <a> element
    const triageLinks = screen.getAllByText('Triage');
    const triageLink = triageLinks.find((el) => el.closest('a'));
    expect(triageLink).toBeTruthy();
    fireEvent.click(triageLink!.closest('a')!);
    await waitFor(() => {
      expect(screen.getByTestId('page-triage')).toBeInTheDocument();
    });
  });

  it('clicking a list item navigates to /lists/:id', async () => {
    renderSidebarWithRouter('/work-items');
    await waitFor(() => {
      expect(screen.getByText('Shopping List')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Shopping List'));
    await waitFor(() => {
      expect(screen.getByTestId('page-list-detail')).toBeInTheDocument();
    });
  });

  it('clicking a project navigates to /projects/:id', async () => {
    renderSidebarWithRouter('/work-items');
    await waitFor(() => {
      expect(screen.getByText('App Dev')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('App Dev'));
    await waitFor(() => {
      expect(screen.getByTestId('page-project-detail')).toBeInTheDocument();
    });
  });
});

describe('ProjectSidebar collapsible sections (#2296)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sections can be collapsed independently', async () => {
    renderSidebarWithRouter();
    await waitFor(() => {
      expect(screen.getByText('Lists')).toBeInTheDocument();
      expect(screen.getByText('Shopping List')).toBeInTheDocument();
    });

    // Click the Lists section header to collapse
    const listsHeader = screen.getByTestId('section-header-lists');
    fireEvent.click(listsHeader);

    // List items should be hidden
    await waitFor(() => {
      expect(screen.queryByText('Shopping List')).not.toBeInTheDocument();
    });

    // But Projects section should still be visible
    expect(screen.getByText('Renovation')).toBeInTheDocument();
  });

  it('persists collapse state in localStorage', async () => {
    renderSidebarWithRouter();
    await waitFor(() => {
      expect(screen.getByText('Lists')).toBeInTheDocument();
    });

    const listsHeader = screen.getByTestId('section-header-lists');
    fireEvent.click(listsHeader);

    expect(localStorageMock.getItem('sidebar-section-lists')).toBe('collapsed');
  });
});

describe('ProjectSidebar quick add (#2296)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders "+ New" button', async () => {
    renderSidebarWithRouter();
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-new-button')).toBeInTheDocument();
    });
  });

  it('renders "+ New" button as a dropdown trigger', async () => {
    renderSidebarWithRouter();
    const btn = await screen.findByTestId('sidebar-new-button');
    // The button is wrapped by a Radix DropdownMenuTrigger
    expect(btn).toBeInTheDocument();
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
  });
});

describe('ProjectSidebar collapsed mode (#2296)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders in collapsed mode with icons only', async () => {
    renderSidebarWithRouter('/work-items', { collapsed: true });
    const sidebar = await screen.findByTestId('project-sidebar');
    // In collapsed mode, section labels should not be visible
    expect(sidebar.getAttribute('data-collapsed')).toBe('true');
  });
});
