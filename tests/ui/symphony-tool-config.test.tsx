/**
 * @vitest-environment jsdom
 *
 * Tests for the Symphony Tool Config Page.
 * Issue #2210: Tool config with CRUD, auth linking, feature flags,
 * task type assignment.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  SymphonyToolsResponse,
} from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockTools: SymphonyToolsResponse = {
  tools: [
    {
      id: 'tool-001',
      namespace: 'test-ns',
      tool_name: 'claude-code',
      command: 'claude --dangerously-skip-permissions',
      verify_command: 'claude --version',
      min_version: '1.0.0',
      timeout_seconds: 3600,
      auth_credential_id: 'cred-001',
      auth_credential_name: 'GitHub Token',
      supports_auto_approve: true,
      supports_max_tokens: true,
      task_types: ['implementation', 'review', 'triage'],
      is_default_for: ['implementation'],
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-07T10:00:00Z',
    },
    {
      id: 'tool-002',
      namespace: 'test-ns',
      tool_name: 'codex-cli',
      command: 'codex',
      verify_command: 'codex --version',
      min_version: '0.5.0',
      timeout_seconds: 1800,
      auth_credential_id: null,
      auth_credential_name: null,
      supports_auto_approve: false,
      supports_max_tokens: false,
      task_types: ['review'],
      is_default_for: ['review'],
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-07T10:00:00Z',
    },
  ],
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/symphony/tools')) return Promise.resolve(mockTools);
    return Promise.reject(new Error(`Unknown endpoint: ${path}`));
  }),
  post: vi.fn().mockResolvedValue({
    id: 'tool-new',
    namespace: 'test-ns',
    tool_name: 'new-tool',
    command: 'new-tool run',
    verify_command: null,
    min_version: null,
    timeout_seconds: 3600,
    auth_credential_id: null,
    auth_credential_name: null,
    supports_auto_approve: false,
    supports_max_tokens: false,
    task_types: [],
    is_default_for: [],
    created_at: '2026-03-07T11:00:00Z',
    updated_at: '2026-03-07T11:00:00Z',
  }),
  put: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
}));

vi.mock('@/ui/lib/api-config', () => ({
  getApiBaseUrl: () => 'http://localhost:3000',
}));

vi.mock('@/ui/lib/auth-manager', () => ({
  getAccessToken: () => 'test-token',
  refreshAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const ToolConfigPage = React.lazy(() =>
    import('@/ui/pages/symphony/ToolConfigPage.js').then((m) => ({ default: m.ToolConfigPage })),
  );

  const routes = [
    {
      path: 'symphony/tools',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <ToolConfigPage />
        </React.Suspense>
      ),
    },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: ['/symphony/tools'],
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

describe('ToolConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/symphony/tools')) return Promise.resolve(mockTools);
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });
  });

  it('renders the tool config page', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('page-symphony-tools')).toBeInTheDocument();
    });
  });

  it('renders tool config cards for all tools', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getAllByTestId(/^tool-card-/)).toHaveLength(2);
    });
  });

  it('displays tool name and command', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('tool-card-tool-001')).toBeInTheDocument();
    });

    const card = screen.getByTestId('tool-card-tool-001');
    expect(within(card).getByText('claude-code')).toBeInTheDocument();
  });

  it('shows auth credential name when linked', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('tool-card-tool-001')).toBeInTheDocument();
    });

    const card = screen.getByTestId('tool-card-tool-001');
    expect(within(card).getByTestId('tool-auth-credential')).toHaveTextContent('GitHub Token');
  });

  it('shows warning when no auth credential linked', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('tool-card-tool-002')).toBeInTheDocument();
    });

    const card = screen.getByTestId('tool-card-tool-002');
    expect(within(card).getByTestId('tool-no-auth-warning')).toBeInTheDocument();
  });

  it('shows feature flags', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('tool-card-tool-001')).toBeInTheDocument();
    });

    const card = screen.getByTestId('tool-card-tool-001');
    expect(within(card).getByTestId('tool-feature-flags')).toBeInTheDocument();
  });

  it('shows task types the tool is eligible for', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('tool-card-tool-001')).toBeInTheDocument();
    });

    const card = screen.getByTestId('tool-card-tool-001');
    expect(within(card).getByTestId('tool-task-types')).toHaveTextContent(/implementation/i);
  });

  it('shows default-for badge', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('tool-card-tool-001')).toBeInTheDocument();
    });

    const card = screen.getByTestId('tool-card-tool-001');
    expect(within(card).getByTestId('tool-default-for')).toHaveTextContent(/implementation/i);
  });

  it('shows create tool button', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('create-tool-button')).toBeInTheDocument();
    });
  });

  it('opens create dialog when create button clicked', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('create-tool-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-tool-button'));

    await waitFor(() => {
      expect(screen.getByTestId('tool-create-dialog')).toBeInTheDocument();
    });
  });

  it('shows delete button for each tool', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('tool-card-tool-001')).toBeInTheDocument();
    });

    const card = screen.getByTestId('tool-card-tool-001');
    expect(within(card).getByTestId('delete-tool-button')).toBeInTheDocument();
  });
});
