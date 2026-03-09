/**
 * @vitest-environment jsdom
 *
 * Tests for ProjectListPage navigation and click handler fixes.
 * Issue #2295: Fix broken click handlers, navigation anti-patterns, and silent failures.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockApiClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
}));

// Mock namespace context
vi.mock('@/ui/contexts/namespace-context', () => ({
  useNamespaceSafe: () => ({
    activeNamespace: 'default',
    namespaces: ['default'],
    setActiveNamespace: vi.fn(),
  }),
  NamespaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderProjectListPage(initialPath = '/work-items') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const ProjectListPage = React.lazy(() =>
    import('@/ui/pages/ProjectListPage.js').then((m) => ({ default: m.ProjectListPage })),
  );

  const routes = [
    {
      path: 'work-items',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <ProjectListPage />
        </React.Suspense>
      ),
    },
    {
      path: 'work-items/:id',
      element: <div data-testid="detail-page">Detail</div>,
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

describe('ProjectListPage — Navigation (#2295)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Empty state click handler', () => {
    it('empty state "Create Work Item" button opens create dialog', async () => {
      // Return empty work items list
      mockApiClient.get.mockImplementation((path: string) => {
        if (path.includes('/work-items/tree')) {
          return Promise.resolve({ items: [] });
        }
        if (path.includes('/work-items')) {
          return Promise.resolve({ items: [], total: 0 });
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      renderProjectListPage();

      await waitFor(
        () => {
          expect(screen.getByText('Create Work Item')).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      // Click the create button — it should open the dialog, NOT be a noop
      fireEvent.click(screen.getByText('Create Work Item'));

      // The WorkItemCreateDialog should open, showing its title and form
      await waitFor(
        () => {
          expect(screen.getByText('Create Work Item', { selector: 'h2, [role="heading"]' })).toBeInTheDocument();
          expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
        },
        { timeout: 5000 },
      );
    });
  });

  describe('No window.location.href in ProjectListPage source', () => {
    it('source code does not contain window.location.href', async () => {
      // Dynamically import the module source to verify it uses navigate
      const mod = await import('@/ui/pages/ProjectListPage.js');
      const source = mod.ProjectListPage.toString();

      // The source should NOT contain window.location.href
      expect(source).not.toContain('window.location.href');
    });
  });
});
