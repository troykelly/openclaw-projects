/**
 * @vitest-environment jsdom
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock apiClient
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiRequestError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

// Mock namespace context
vi.mock('@/ui/contexts/namespace-context', () => ({
  useNamespace: () => ({
    grants: [
      { namespace: 'acme', access: 'readwrite', is_home: true },
      { namespace: 'beta', access: 'read', is_home: false },
    ],
    activeNamespace: 'acme',
    activeNamespaces: ['acme'],
    hasMultipleNamespaces: true,
    isMultiNamespaceMode: false,
    isNamespaceReady: true,
    namespaceVersion: 0,
    setActiveNamespace: vi.fn(),
    setActiveNamespaces: vi.fn(),
    toggleNamespace: vi.fn(),
  }),
  useNamespaceSafe: () => null,
  useActiveNamespace: () => 'acme',
  useActiveNamespaces: () => ['acme'],
}));

import { apiClient } from '@/ui/lib/api-client';

const mockedGet = vi.mocked(apiClient.get);
const mockedPost = vi.mocked(apiClient.post);
const mockedPatch = vi.mocked(apiClient.patch);
const mockedDelete = vi.mocked(apiClient.delete);

// Import the page component after mocks
import { NamespaceSettingsPage } from '@/ui/pages/NamespaceSettingsPage';

/** GET /namespaces returns a plain array (no wrapper). */
const NAMESPACE_LIST = [
  { namespace: 'acme', access: 'readwrite', is_home: true, priority: 0, created_at: '2026-01-01T00:00:00Z' },
  { namespace: 'beta', access: 'read', is_home: false, priority: 1, created_at: '2026-02-01T00:00:00Z' },
];

/** GET /namespaces/:ns returns { namespace, members, member_count }. */
const NAMESPACE_DETAIL = {
  namespace: 'acme',
  member_count: 3,
  members: [
    {
      id: 'g1',
      email: 'alice@example.com',
      namespace: 'acme',
      access: 'readwrite',
      is_home: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'g2',
      email: 'bob@example.com',
      namespace: 'acme',
      access: 'read',
      is_home: false,
      created_at: '2026-01-15T00:00:00Z',
      updated_at: '2026-01-15T00:00:00Z',
    },
    {
      id: 'g3',
      email: 'carol@example.com',
      namespace: 'acme',
      access: 'readwrite',
      is_home: false,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    },
  ],
};

function renderPage(initialPath = '/settings/namespaces') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  const router = createMemoryRouter(
    [
      {
        path: '/settings/namespaces',
        element: <NamespaceSettingsPage />,
      },
      {
        path: '/settings/namespaces/:ns',
        element: <NamespaceSettingsPage />,
      },
    ],
    { initialEntries: [initialPath] },
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('NamespaceSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockImplementation((url: string) => {
      if (url === '/namespaces') {
        return Promise.resolve(NAMESPACE_LIST);
      }
      if (url.startsWith('/namespaces/acme')) {
        return Promise.resolve(NAMESPACE_DETAIL);
      }
      return Promise.resolve({ data: null });
    });
  });

  // Test 1: Namespace list renders all user namespaces
  it('renders namespace list with all namespaces', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('acme')).toBeInTheDocument();
      expect(screen.getByText('beta')).toBeInTheDocument();
    });
  });

  // Test 2: Shows access level badges
  it('shows access level and home badges', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('readwrite')).toBeInTheDocument();
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
  });

  // Test 3: Shows access info for each namespace
  it('shows access info for each namespace', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Access: readwrite')).toBeInTheDocument();
      expect(screen.getByText('Access: read')).toBeInTheDocument();
    });
  });

  // Test 4: Clicking namespace navigates to detail view
  it('navigates to detail view on namespace click', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('acme')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('acme'));
    await waitFor(() => {
      // Detail view should show members
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
      expect(screen.getByText('bob@example.com')).toBeInTheDocument();
      expect(screen.getByText('carol@example.com')).toBeInTheDocument();
    });
  });

  // Test 5: Create dialog validates name pattern
  it('validates namespace name pattern in create dialog', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('acme')).toBeInTheDocument();
    });

    // Open create dialog
    fireEvent.click(screen.getByRole('button', { name: /create namespace/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/namespace name/i)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/namespace name/i);

    // Invalid: uppercase
    fireEvent.change(input, { target: { value: 'INVALID' } });
    await waitFor(() => {
      expect(screen.getByText(/must match/i)).toBeInTheDocument();
    });

    // Invalid: starts with dash
    fireEvent.change(input, { target: { value: '-invalid' } });
    await waitFor(() => {
      expect(screen.getByText(/must match/i)).toBeInTheDocument();
    });

    // Valid name
    fireEvent.change(input, { target: { value: 'valid-name' } });
    await waitFor(() => {
      expect(screen.queryByText(/must match/i)).not.toBeInTheDocument();
    });
  });

  // Test 6: Create dialog sends correct API payload
  it('creates namespace with correct API call', async () => {
    mockedPost.mockResolvedValue({ namespace: 'new-ns', created: true });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('acme')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /create namespace/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/namespace name/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/namespace name/i), {
      target: { value: 'new-ns' },
    });

    const createBtn = screen.getByRole('button', { name: /^create$/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/namespaces', { name: 'new-ns' });
    });
  });

  // Test 7: Invite dialog sends correct API payload
  it('invites member with correct API call', async () => {
    mockedPost.mockResolvedValue({ data: {} });
    renderPage('/settings/namespaces/acme');
    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /invite member/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'dave@example.com' },
    });

    const inviteBtn = screen.getByRole('button', { name: /^invite$/i });
    fireEvent.click(inviteBtn);

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/namespaces/acme/grants', {
        email: 'dave@example.com',
        access: 'read',
      });
    });
  });

  // Test 8: Remove grant shows confirmation, calls DELETE on confirm
  it('removes grant with confirmation dialog', async () => {
    mockedDelete.mockResolvedValue(undefined);
    renderPage('/settings/namespaces/acme');
    await waitFor(() => {
      expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    });

    // Find remove button for bob (non-home, read access)
    const bobRow = screen.getByText('bob@example.com').closest('[data-testid^="grant-row"]');
    expect(bobRow).toBeTruthy();
    const removeBtn = bobRow!.querySelector('[data-testid="remove-grant-btn"]');
    expect(removeBtn).toBeTruthy();
    fireEvent.click(removeBtn!);

    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText(/are you sure/i)).toBeInTheDocument();
    });

    // Confirm removal
    const confirmBtn = screen.getByRole('button', { name: /^remove$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockedDelete).toHaveBeenCalledWith('/namespaces/acme/grants/g2');
    });
  });

  // Test 9: Shows loading state
  it('shows loading state while fetching', () => {
    mockedGet.mockImplementation(() => new Promise(() => {})); // never resolves
    renderPage();
    expect(screen.getByTestId('namespace-settings-loading')).toBeInTheDocument();
  });

  // Test 10: Shows error state
  it('shows error state on fetch failure', async () => {
    mockedGet.mockRejectedValue(new Error('Network error'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });

  // Test 11: Back button in detail view returns to list
  it('navigates back from detail to list view', async () => {
    renderPage('/settings/namespaces/acme');
    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });

    const backBtn = screen.getByRole('button', { name: /back/i });
    fireEvent.click(backBtn);

    await waitFor(() => {
      expect(screen.getByText('Namespaces')).toBeInTheDocument();
      expect(screen.getByText('acme')).toBeInTheDocument();
    });
  });
});
