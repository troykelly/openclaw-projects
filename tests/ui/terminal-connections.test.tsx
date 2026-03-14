/**
 * @vitest-environment jsdom
 *
 * Tests for the Connections Management Page.
 * Issue #1692: Connections list, create, test, delete.
 * Issue #1983: Test result display, Trust & Retry flow, host key verification.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TerminalConnectionsResponse, TerminalCredentialsResponse } from '@/ui/lib/api-types';
import type { TestConnectionResponse } from '@/ui/hooks/queries/use-terminal-connections';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockConnections: TerminalConnectionsResponse = {
  connections: [
    {
      id: 'conn-1',
      namespace: 'test',
      name: 'prod-web-1',
      host: '192.168.1.100',
      port: 22,
      username: 'root',
      auth_method: 'key',
      credential_id: null,
      proxy_jump_id: null,
      is_local: false,
      env: null,
      connect_timeout_s: 30,
      keepalive_interval: 60,
      idle_timeout_s: null,
      max_sessions: null,
      host_key_policy: 'strict',
      tags: ['production'],
      notes: 'Primary web server',
      last_connected_at: '2026-02-25T10:00:00Z',
      last_error: null,
      deleted_at: null,
      created_at: '2026-02-24T00:00:00Z',
      updated_at: '2026-02-24T00:00:00Z',
    },
    {
      id: 'conn-2',
      namespace: 'test',
      name: 'local-dev',
      host: null,
      port: 22,
      username: null,
      auth_method: null,
      credential_id: null,
      proxy_jump_id: null,
      is_local: true,
      env: null,
      connect_timeout_s: 30,
      keepalive_interval: 60,
      idle_timeout_s: null,
      max_sessions: null,
      host_key_policy: 'strict',
      tags: [],
      notes: null,
      last_connected_at: null,
      last_error: null,
      deleted_at: null,
      created_at: '2026-02-24T00:00:00Z',
      updated_at: '2026-02-24T00:00:00Z',
    },
  ],
};

const mockCredentials: TerminalCredentialsResponse = {
  credentials: [],
};

const mockTestSuccess: TestConnectionResponse = {
  success: true,
  message: 'Connected in 42ms',
  latency_ms: 42,
  host_key_fingerprint: 'SHA256:abc123def456',
};

const mockTestHostKeyFailure: TestConnectionResponse = {
  success: false,
  message: 'Host denied (verification failed)',
  latency_ms: 1066,
  host_key_fingerprint: 'SHA256:xyz789ghi012',
  error_code: 'HOST_KEY_VERIFICATION_FAILED',
};

const mockTestOtherFailure: TestConnectionResponse = {
  success: false,
  message: 'Connection refused',
  latency_ms: 500,
  host_key_fingerprint: '',
};

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/terminal/health')) return Promise.resolve({ status: 'ok' });
    if (path.includes('/terminal/connections')) return Promise.resolve(mockConnections);
    if (path.includes('/terminal/credentials')) return Promise.resolve(mockCredentials);
    if (path.includes('/terminal/known-hosts')) return Promise.resolve({ known_hosts: [], total: 0 });
    return Promise.reject(new Error(`Unknown endpoint: ${path}`));
  }),
  post: vi.fn().mockResolvedValue(mockTestSuccess),
  put: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
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

function renderWithRouter(initialPath = '/terminal/connections') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const ConnectionsPage = React.lazy(() =>
    import('@/ui/pages/terminal/ConnectionsPage.js').then((m) => ({ default: m.ConnectionsPage })),
  );

  const routes = [
    {
      path: 'terminal/connections',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <ConnectionsPage />
        </React.Suspense>
      ),
    },
  ];

  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/terminal/health')) return Promise.resolve({ status: 'ok' });
      if (path.includes('/terminal/connections')) return Promise.resolve(mockConnections);
      if (path.includes('/terminal/credentials')) return Promise.resolve(mockCredentials);
      if (path.includes('/terminal/known-hosts')) return Promise.resolve({ known_hosts: [], total: 0 });
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });
    mockApiClient.post.mockResolvedValue(mockTestSuccess);
  });

  it('renders connections list', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('page-connections')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
      expect(screen.getByText('local-dev')).toBeInTheDocument();
    });
  });

  it('renders connection cards with status indicators', async () => {
    renderWithRouter();

    await waitFor(() => {
      const cards = screen.getAllByTestId('connection-card');
      expect(cards).toHaveLength(2);
    });
  });

  it('shows empty state when no connections match search', async () => {
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/terminal/health')) return Promise.resolve({ status: 'ok' });
      if (path.includes('/terminal/connections')) return Promise.resolve({ connections: [] });
      if (path.includes('/terminal/credentials')) return Promise.resolve(mockCredentials);
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText(/No connections/)).toBeInTheDocument();
    });
  });

  it('has new connection button', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('New Connection')).toBeInTheDocument();
    });
  });

  it('has import SSH config button', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Import SSH Config')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Issue #1983: Test button + result display + Trust & Retry
  // -------------------------------------------------------------------------

  it('test button sends POST with trust_host_key: false by default', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
    });

    // Find and click the Test button for the first connection
    const testButtons = screen.getAllByRole('button', { name: /test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/terminal/connections/conn-1/test',
        { trust_host_key: false },
      );
    });
  });

  it('displays test success result on the connection card', async () => {
    mockApiClient.post.mockResolvedValue(mockTestSuccess);
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
    });

    const testButtons = screen.getAllByRole('button', { name: /test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('test-result')).toBeInTheDocument();
      expect(screen.getByText(/Connected.*42ms/)).toBeInTheDocument();
    });
  });

  it('displays test failure result on the connection card', async () => {
    mockApiClient.post.mockResolvedValue(mockTestOtherFailure);
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
    });

    const testButtons = screen.getAllByRole('button', { name: /test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('test-result')).toBeInTheDocument();
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });
  });

  it('shows host key dialog when test fails with verification error', async () => {
    mockApiClient.post.mockResolvedValue(mockTestHostKeyFailure);
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
    });

    const testButtons = screen.getAllByRole('button', { name: /test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('host-key-details')).toBeInTheDocument();
    });

    // Fingerprint appears in both the card result and the dialog — verify at least one
    const fingerprints = screen.getAllByText(/SHA256:xyz789ghi012/);
    expect(fingerprints.length).toBeGreaterThanOrEqual(1);
  });

  it('Trust & Connect retries with trust_host_key: true and expected_fingerprint', async () => {
    // First test fails with host key error, then trust succeeds
    mockApiClient.post
      .mockResolvedValueOnce(mockTestHostKeyFailure)
      .mockResolvedValueOnce(mockTestSuccess);

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
    });

    // Click test button — triggers host key dialog
    const testButtons = screen.getAllByRole('button', { name: /test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('host-key-details')).toBeInTheDocument();
    });

    // Click "Trust & Connect" in the dialog
    const trustButton = screen.getByRole('button', { name: /trust.*connect/i });
    fireEvent.click(trustButton);

    await waitFor(() => {
      // Verify the second API call pins the fingerprint from the first test (Issue #2042)
      expect(mockApiClient.post).toHaveBeenCalledTimes(2);
      expect(mockApiClient.post).toHaveBeenLastCalledWith(
        '/terminal/connections/conn-1/test',
        { trust_host_key: true, expected_fingerprint: 'SHA256:xyz789ghi012' },
      );
    });
  });

  // Issue #2133: SSH config import response alignment
  it('SSH config import uses correct backend response shape { imported, count }', async () => {
    const mockImportResponse = {
      imported: [
        { id: 'new-1', name: 'server-alpha' },
        { id: 'new-2', name: 'server-beta' },
      ],
      count: 2,
    };
    mockApiClient.post.mockResolvedValueOnce(mockImportResponse);

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Import SSH Config')).toBeInTheDocument();
    });

    // Open import dialog
    fireEvent.click(screen.getByText('Import SSH Config'));

    await waitFor(() => {
      expect(screen.getByTestId('ssh-config-input')).toBeInTheDocument();
    });

    // Enter SSH config text
    const textarea = screen.getByTestId('ssh-config-input');
    fireEvent.change(textarea, { target: { value: 'Host server-alpha\n  HostName 10.0.0.1\n  User admin\n\nHost server-beta\n  HostName 10.0.0.2\n  User admin' } });

    // Click import
    const importButton = screen.getByRole('button', { name: /^import$/i });
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/terminal/connections/import-ssh-config',
        { config_text: expect.any(String) },
      );
    });
  });

  it('SshConfigImportResponse type matches backend { imported, count } shape', async () => {
    const { useImportSshConfig } = await import('@/ui/hooks/queries/use-terminal-connections');
    expect(useImportSshConfig).toBeDefined();

    // Verify the response type has 'imported' and 'count', not 'connections'
    type ImportResult = Awaited<ReturnType<ReturnType<typeof useImportSshConfig>['mutateAsync']>>;
    // This would fail at build time if the type still had `connections` instead of `imported`
    const mockResult: ImportResult = { imported: [{ id: '1', name: 'test' }], count: 1 };
    expect(mockResult.imported).toHaveLength(1);
    expect(mockResult.count).toBe(1);
  });

  it('does not show host key dialog for non-verification failures', async () => {
    mockApiClient.post.mockResolvedValue(mockTestOtherFailure);
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
    });

    const testButtons = screen.getAllByRole('button', { name: /test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('test-result')).toBeInTheDocument();
    });

    // Host key dialog should not be present
    expect(screen.queryByTestId('host-key-details')).not.toBeInTheDocument();
  });
});
