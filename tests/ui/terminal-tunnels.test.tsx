/**
 * @vitest-environment jsdom
 *
 * Tests for the Tunnels, Enrollment, Known Hosts, Activity pages.
 * Issue #1696.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  TerminalTunnelsResponse,
  TerminalEnrollmentTokensResponse,
  TerminalKnownHostsResponse,
  TerminalActivityResponse,
  TerminalConnectionsResponse,
} from '@/ui/lib/api-types';

const mockTunnels: TerminalTunnelsResponse = {
  tunnels: [
    {
      id: 'tun-1',
      namespace: 'test',
      connection_id: 'conn-1',
      session_id: null,
      direction: 'local',
      bind_host: '127.0.0.1',
      bind_port: 8080,
      target_host: 'localhost',
      target_port: 80,
      status: 'active',
      error_message: null,
      created_at: '2026-02-25T10:00:00Z',
      updated_at: '2026-02-25T10:00:00Z',
    },
  ],
};

const mockTokens: TerminalEnrollmentTokensResponse = {
  tokens: [
    {
      id: 'tok-1',
      namespace: 'test',
      label: 'staging-servers',
      max_uses: 10,
      uses: 3,
      expires_at: '2026-03-01T00:00:00Z',
      connection_defaults: null,
      allowed_tags: ['staging'],
      created_at: '2026-02-24T00:00:00Z',
    },
  ],
};

const mockKnownHosts: TerminalKnownHostsResponse = {
  known_hosts: [
    {
      id: 'kh-1',
      namespace: 'test',
      connection_id: 'conn-1',
      host: '192.168.1.100',
      port: 22,
      key_type: 'ssh-ed25519',
      key_fingerprint: 'SHA256:abc123',
      public_key: 'ssh-ed25519 AAAA...',
      trusted_at: '2026-02-25T10:00:00Z',
      trusted_by: 'user',
      created_at: '2026-02-25T10:00:00Z',
    },
  ],
};

const mockActivity: TerminalActivityResponse = {
  items: [
    {
      id: 'act-1',
      namespace: 'test',
      session_id: 'sess-1',
      connection_id: 'conn-1',
      actor: 'agent@openclaw.ai',
      action: 'session.create',
      detail: { session_name: 'dev-server' },
      created_at: '2026-02-25T10:00:00Z',
    },
  ],
};

const mockConnections: TerminalConnectionsResponse = {
  connections: [],
};

const mockApiClient = {
  get: vi.fn().mockImplementation((path: string) => {
    if (path.includes('/api/terminal/tunnels')) return Promise.resolve(mockTunnels);
    if (path.includes('/api/terminal/enrollment-tokens')) return Promise.resolve(mockTokens);
    if (path.includes('/api/terminal/known-hosts')) return Promise.resolve(mockKnownHosts);
    if (path.includes('/api/terminal/activity')) return Promise.resolve(mockActivity);
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

function renderPage(pageName: string, path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  let LazyPage: React.LazyExoticComponent<React.ComponentType>;
  switch (pageName) {
    case 'tunnels':
      LazyPage = React.lazy(() => import('@/ui/pages/terminal/TunnelsPage.js').then((m) => ({ default: m.TunnelsPage })));
      break;
    case 'enrollment':
      LazyPage = React.lazy(() => import('@/ui/pages/terminal/EnrollmentPage.js').then((m) => ({ default: m.EnrollmentPage })));
      break;
    case 'known-hosts':
      LazyPage = React.lazy(() => import('@/ui/pages/terminal/KnownHostsPage.js').then((m) => ({ default: m.KnownHostsPage })));
      break;
    case 'activity':
      LazyPage = React.lazy(() => import('@/ui/pages/terminal/TerminalActivityPage.js').then((m) => ({ default: m.TerminalActivityPage })));
      break;
    default:
      throw new Error(`Unknown page: ${pageName}`);
  }

  const routes = [
    {
      path: `terminal/${pageName}`,
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <LazyPage />
        </React.Suspense>
      ),
    },
  ];

  const router = createMemoryRouter(routes, { initialEntries: [path] });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('TunnelsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders tunnel cards', async () => {
    renderPage('tunnels', '/terminal/tunnels');
    await waitFor(() => {
      expect(screen.getByTestId('page-tunnels')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('tunnel-card')).toBeInTheDocument();
    });
  });

  it('shows tunnel direction diagram', async () => {
    renderPage('tunnels', '/terminal/tunnels');
    await waitFor(() => {
      expect(screen.getByTestId('tunnel-direction')).toBeInTheDocument();
    });
  });
});

describe('EnrollmentPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders enrollment tokens', async () => {
    renderPage('enrollment', '/terminal/enrollment');
    await waitFor(() => {
      expect(screen.getByTestId('page-enrollment')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('staging-servers')).toBeInTheDocument();
    });
  });
});

describe('KnownHostsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders known hosts', async () => {
    renderPage('known-hosts', '/terminal/known-hosts');
    await waitFor(() => {
      expect(screen.getByTestId('page-known-hosts')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('known-host-card')).toBeInTheDocument();
    });
  });
});

describe('TerminalActivityPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders activity log', async () => {
    renderPage('activity', '/terminal/activity');
    await waitFor(() => {
      expect(screen.getByTestId('page-terminal-activity')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('activity-row')).toBeInTheDocument();
    });
  });

  it('renders activity filters', async () => {
    renderPage('activity', '/terminal/activity');
    await waitFor(() => {
      expect(screen.getByTestId('activity-filters')).toBeInTheDocument();
    });
  });
});
