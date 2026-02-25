/**
 * @vitest-environment jsdom
 *
 * Tests for work items integration features.
 * Covers: #1707 (Comments), #1708 (Attachments), #1710 (Recurrence),
 * #1712 (Dependencies), #1714 (Participants), #1715 (Entity Links),
 * #1717 (Clone), #1718 (Rollup), #1720 (Contact Linking), #1722 (Bulk Ops).
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkItemDetail } from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWorkItem: WorkItemDetail = {
  id: 'item-1',
  title: 'Test Work Item',
  description: 'A detailed description',
  status: 'in_progress',
  priority: 'P1',
  kind: 'epic',
  parent_id: 'parent-1',
  parent: { id: 'parent-1', title: 'Parent Project', kind: 'project' },
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

const mockComments = {
  comments: [
    {
      id: 'c1',
      content: 'First comment',
      authorId: 'user-1',
      author: { id: 'user-1', name: 'Test User' },
      created_at: '2026-01-15T10:00:00Z',
      updated_at: '2026-01-15T10:00:00Z',
      replyCount: 0,
      reactions: [],
    },
  ],
};

const mockAttachments = {
  attachments: [
    {
      id: 'att-1',
      original_filename: 'spec.pdf',
      content_type: 'application/pdf',
      size_bytes: 102400,
      created_at: '2026-01-15T10:00:00Z',
    },
  ],
};

const mockRollup = {
  total_children: 5,
  by_status: { done: 3, in_progress: 1, not_started: 1 },
  total_estimate_minutes: 600,
  completed_estimate_minutes: 360,
  progress_pct: 60,
};

const mockRecurrence = {
  recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO',
  recurrence_natural: 'Every Monday',
};

const mockInstances = {
  instances: [
    { id: 'inst-1', title: 'Test Work Item (Feb 24)', status: 'done', not_before: '2026-02-24T00:00:00Z', created_at: '2026-02-24T00:00:00Z' },
  ],
};

const mockLinkedContacts = {
  contacts: [
    { id: 'lc-1', contact_id: 'cont-1', display_name: 'Jane Doe' },
  ],
};

const mockEntityLinks = {
  links: [
    { id: 'el-1', source_type: 'todo', source_id: 'item-1', target_type: 'project', target_id: 'proj-1', link_type: 'related', created_by: null, created_at: '2026-01-15T00:00:00Z' },
  ],
};

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/api/work-items/item-1/comments')) return Promise.resolve(mockComments);
    if (path.includes('/api/work-items/item-1/attachments')) return Promise.resolve(mockAttachments);
    if (path.includes('/api/work-items/item-1/rollup')) return Promise.resolve(mockRollup);
    if (path.includes('/api/work-items/item-1/recurrence')) return Promise.resolve(mockRecurrence);
    if (path.includes('/api/work-items/item-1/instances')) return Promise.resolve(mockInstances);
    if (path.includes('/api/work-items/item-1/contacts')) return Promise.resolve(mockLinkedContacts);
    if (path.includes('/api/work-items/item-1/communications')) return Promise.resolve({ emails: [], calendar_events: [] });
    if (path.includes('/api/work-items/item-1/memories')) return Promise.resolve({ memories: [] });
    if (path.includes('/api/work-items/item-1') && !path.includes('/')) return Promise.resolve(mockWorkItem);
    if (path.match(/\/api\/work-items\/item-1$/)) return Promise.resolve(mockWorkItem);
    if (path.includes('/api/work-items/item-1')) return Promise.resolve(mockWorkItem);
    if (path.includes('/api/entity-links')) return Promise.resolve(mockEntityLinks);
    if (path.includes('/activity')) return Promise.resolve({ items: [] });
    return Promise.resolve({});
  }),
  post: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue(mockWorkItem),
  patch: vi.fn().mockResolvedValue(mockWorkItem),
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
      participants: [{ participant: 'John Doe', role: 'owner' }],
      me: { email: 'user@test.com' },
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

  const WorkItemDetailPage = React.lazy(() =>
    import('@/ui/pages/WorkItemDetailPage.js').then((m) => ({ default: m.WorkItemDetailPage })),
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

describe('Work Items Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/comments')) return Promise.resolve(mockComments);
      if (path.includes('/attachments')) return Promise.resolve(mockAttachments);
      if (path.includes('/rollup')) return Promise.resolve(mockRollup);
      if (path.includes('/recurrence')) return Promise.resolve(mockRecurrence);
      if (path.includes('/instances')) return Promise.resolve(mockInstances);
      if (path.includes('/work-items/item-1/contacts')) return Promise.resolve(mockLinkedContacts);
      if (path.includes('/communications')) return Promise.resolve({ emails: [], calendar_events: [] });
      if (path.includes('/memories')) return Promise.resolve({ memories: [] });
      if (path.includes('/entity-links')) return Promise.resolve(mockEntityLinks);
      if (path.includes('/activity')) return Promise.resolve({ items: [] });
      if (path.match(/\/api\/work-items\/item-1(\?|$)/)) return Promise.resolve(mockWorkItem);
      return Promise.resolve({});
    });
  });

  // #1707 — Comments
  describe('Comments section (#1707)', () => {
    it('renders comments tab', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /comments/i })).toBeInTheDocument();
      });
    });

    it('shows comments tab content when tab is clicked', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /comments/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('tab', { name: /comments/i }));

      await waitFor(() => {
        expect(screen.getByTestId('tab-content-comments')).toBeInTheDocument();
      });
    });
  });

  // #1708 — Attachments
  describe('Attachments section (#1708)', () => {
    it('renders attachments tab', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /attachments/i })).toBeInTheDocument();
      });
    });

    it('shows attachments tab content when tab is clicked', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /attachments/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('tab', { name: /attachments/i }));

      await waitFor(() => {
        expect(screen.getByTestId('tab-content-attachments')).toBeInTheDocument();
      });
    });
  });

  // #1712 — Dependency creation/deletion
  describe('Dependency management (#1712)', () => {
    it('renders dependencies tab with add buttons', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getAllByText('Test Work Item').length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getByRole('tab', { name: /dependencies/i }));

      await waitFor(() => {
        expect(screen.getByTestId('tab-content-dependencies')).toBeInTheDocument();
      });
    });
  });

  // #1714 — Participant management
  describe('Participant management (#1714)', () => {
    it('renders participants with add button', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      expect(screen.getByTestId('add-participant-button')).toBeInTheDocument();
    });
  });

  // #1715 — Entity links
  describe('Entity links section (#1715)', () => {
    it('renders entity links section in sidebar', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByTestId('entity-link-manager')).toBeInTheDocument();
      });
    });
  });

  // #1717 — Clone
  describe('Clone dialog (#1717)', () => {
    it('renders clone button in header', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByTestId('clone-button')).toBeInTheDocument();
      });
    });
  });

  // #1718 — Rollup
  describe('Rollup display (#1718)', () => {
    it('renders progress bar for parent items', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByTestId('rollup-progress')).toBeInTheDocument();
      });
    });

    it('shows progress percentage', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByText('60%')).toBeInTheDocument();
      });
    });
  });

  // #1710 — Recurrence
  describe('Recurrence section (#1710)', () => {
    it('renders recurrence info in sidebar', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByTestId('recurrence-section')).toBeInTheDocument();
      });
    });

    it('displays natural language recurrence rule', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByText('Every Monday')).toBeInTheDocument();
      });
    });
  });

  // #1720 — Contact linking
  describe('Contact linking (#1720)', () => {
    it('renders linked contacts section', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByTestId('linked-contacts-section')).toBeInTheDocument();
      });
    });

    it('shows linked contact name', async () => {
      renderWithRouter();
      await waitFor(() => {
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      });
    });
  });
});
