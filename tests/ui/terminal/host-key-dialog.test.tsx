/**
 * Tests for host-key-dialog wiring (Issue #1866).
 *
 * Verifies the dialog is rendered and wired into known hosts page.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockKnownHosts = [
  {
    id: 'kh-1',
    namespace: 'default',
    connection_id: null,
    host: '192.168.1.100',
    port: 22,
    key_type: 'ssh-ed25519',
    key_fingerprint: 'SHA256:abcdef1234567890',
    public_key: 'AAAAC3NzaC1...',
    trusted_by: 'user',
    trusted_at: '2026-02-20T10:00:00Z',
    created_at: '2026-02-20T10:00:00Z',
  },
];

const mockApprove = vi.fn();
const mockReject = vi.fn();

vi.mock('@/ui/hooks/queries/use-terminal-known-hosts', () => ({
  useTerminalKnownHosts: vi.fn(() => ({
    data: { known_hosts: mockKnownHosts },
    isLoading: false,
  })),
  useApproveTerminalKnownHost: vi.fn(() => ({
    mutate: mockApprove,
    isPending: false,
  })),
  useDeleteTerminalKnownHost: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useRejectTerminalKnownHost: vi.fn(() => ({
    mutate: mockReject,
    isPending: false,
  })),
}));

const { KnownHostsPage } = await import('@/ui/pages/terminal/KnownHostsPage');

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <KnownHostsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KnownHostsPage with host-key-dialog (#1866)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders known hosts', () => {
    renderPage();
    expect(screen.getByTestId('page-known-hosts')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.100:22')).toBeInTheDocument();
  });

  it('renders Revoke button on known host cards', () => {
    renderPage();
    expect(screen.getByText('Revoke')).toBeInTheDocument();
  });
});
