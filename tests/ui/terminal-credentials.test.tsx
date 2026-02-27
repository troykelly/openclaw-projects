/**
 * @vitest-environment jsdom
 *
 * Tests for the Credentials Management Page.
 * Issue #1693: Credentials list, create, delete, generate key pair.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TerminalCredentialsResponse, TerminalConnectionsResponse } from '@/ui/lib/api-types';

const mockCredentials: TerminalCredentialsResponse = {
  credentials: [
    {
      id: 'cred-1',
      namespace: 'test',
      name: 'my-ed25519-key',
      kind: 'ssh_key',
      fingerprint: 'SHA256:abc123def456',
      public_key: 'ssh-ed25519 AAAA...',
      command: null,
      command_timeout_s: 10,
      cache_ttl_s: 0,
      deleted_at: null,
      created_at: '2026-02-24T00:00:00Z',
      updated_at: '2026-02-24T00:00:00Z',
    },
    {
      id: 'cred-2',
      namespace: 'test',
      name: '1password-op',
      kind: 'command',
      fingerprint: null,
      public_key: null,
      command: 'op read op://vault/key',
      command_timeout_s: 10,
      cache_ttl_s: 300,
      deleted_at: null,
      created_at: '2026-02-24T00:00:00Z',
      updated_at: '2026-02-24T00:00:00Z',
    },
  ],
};

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
      credential_id: 'cred-1',
      proxy_jump_id: null,
      is_local: false,
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

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/api/terminal/credentials')) return Promise.resolve(mockCredentials);
    if (path.includes('/api/terminal/connections')) return Promise.resolve(mockConnections);
    return Promise.reject(new Error(`Unknown endpoint: ${path}`));
  }),
  post: vi.fn().mockResolvedValue({}),
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

function renderWithRouter(initialPath = '/terminal/credentials') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const CredentialsPage = React.lazy(() =>
    import('@/ui/pages/terminal/CredentialsPage.js').then((m) => ({ default: m.CredentialsPage })),
  );

  const routes = [
    {
      path: 'terminal/credentials',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <CredentialsPage />
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

describe('CredentialsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/api/terminal/credentials')) return Promise.resolve(mockCredentials);
      if (path.includes('/api/terminal/connections')) return Promise.resolve(mockConnections);
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });
  });

  it('renders credentials page', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('page-credentials')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('renders credential cards', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('my-ed25519-key')).toBeInTheDocument();
      expect(screen.getByText('1password-op')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('shows credential kind badges', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('ssh_key')).toBeInTheDocument();
      expect(screen.getByText('command')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('has new credential and generate key buttons', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('New Credential')).toBeInTheDocument();
      expect(screen.getByText('Generate Key')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('shows empty state when no credentials', async () => {
    mockApiClient.get.mockImplementation((path: string) => {
      if (path.includes('/api/terminal/credentials')) return Promise.resolve({ credentials: [] });
      if (path.includes('/api/terminal/connections')) return Promise.resolve({ connections: [] });
      return Promise.reject(new Error(`Unknown endpoint: ${path}`));
    });

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText(/No credentials/)).toBeInTheDocument();
    }, { timeout: 5000 });
  });
});
