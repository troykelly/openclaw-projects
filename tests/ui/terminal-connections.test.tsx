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
    }, { timeout: 5000 });

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
      expect(screen.getByText('local-dev')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('renders connection cards with status indicators', async () => {
    renderWithRouter();

    await waitFor(() => {
      const cards = screen.getAllByTestId('connection-card');
      expect(cards).toHaveLength(2);
    }, { timeout: 5000 });
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
    }, { timeout: 5000 });
  });

  it('has new connection button', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('New Connection')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('has import SSH config button', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Import SSH Config')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Issue #1983: Test button + result display + Trust & Retry
  // -------------------------------------------------------------------------

  it('test button sends POST with trust_host_key: false by default', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Find and click the Test button for the first connection
    const testButtons = screen.getAllByRole('button', { name: /test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/terminal/connections/conn-1/test',
        { trust_host_key: false },
      );
    }, { timeout: 5000 });
  });

  it('displays test success result on the connection card', async () => {
    mockApiClient.post.mockResolvedValue(mockTestSuccess);
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
    }, { timeout: 5000 });

    const testButtons = screen.getAllByRole('button', { name: /test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('test-result')).toBeInTheDocument();
      expect(screen.getByText(/Connected.*42ms/)).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('displays test failure result on the connection card', async () => {
    mockApiClient.post.mockResolvedValue(mockTestOtherFailure);
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
    }, { timeout: 5000 });

    const testButtons = screen.getAllByRole('button', { name: /test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('test-result')).toBeInTheDocument();
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('shows host key dialog when test fails with verification error', async () => {
    mockApiClient.post.mockResolvedValue(mockTestHostKeyFailure);
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
    }, { timeout: 5000 });

    const testButtons = screen.getAllByRole('button', { name: /test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('host-key-details')).toBeInTheDocument();
    }, { timeout: 5000 });

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
    }, { timeout: 5000 });

    // Click test button — triggers host key dialog
    const testButtons = screen.getAllByRole('button', { name: /test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('host-key-details')).toBeInTheDocument();
    }, { timeout: 5000 });

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
    }, { timeout: 5000 });
  });

  it('does not show host key dialog for non-verification failures', async () => {
    mockApiClient.post.mockResolvedValue(mockTestOtherFailure);
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('prod-web-1')).toBeInTheDocument();
    }, { timeout: 5000 });

    const testButtons = screen.getAllByRole('button', { name: /test/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('test-result')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Host key dialog should not be present
    expect(screen.queryByTestId('host-key-details')).not.toBeInTheDocument();
  });
});
