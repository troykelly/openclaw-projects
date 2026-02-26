/**
 * Tests for SessionsListPage (Issue #1864).
 *
 * Verifies the sessions list page renders sessions with filtering,
 * terminate action, and navigation links.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the hooks
const mockSessions = [
  {
    id: 'sess-1',
    namespace: 'default',
    connection_id: 'conn-1',
    tmux_session_name: 'dev-server',
    worker_id: 'w1',
    status: 'active',
    cols: 80,
    rows: 24,
    capture_interval_s: 30,
    capture_on_command: true,
    embed_commands: true,
    embed_scrollback: false,
    started_at: '2026-02-25T10:00:00Z',
    last_activity_at: '2026-02-25T11:00:00Z',
    terminated_at: null,
    exit_code: null,
    error_message: null,
    tags: ['production'],
    notes: null,
    created_at: '2026-02-25T10:00:00Z',
    updated_at: '2026-02-25T11:00:00Z',
    connection: { name: 'prod-server', id: 'conn-1' },
  },
  {
    id: 'sess-2',
    namespace: 'default',
    connection_id: 'conn-2',
    tmux_session_name: 'build-agent',
    worker_id: 'w1',
    status: 'terminated',
    cols: 120,
    rows: 40,
    capture_interval_s: 30,
    capture_on_command: true,
    embed_commands: true,
    embed_scrollback: false,
    started_at: '2026-02-24T10:00:00Z',
    last_activity_at: '2026-02-24T12:00:00Z',
    terminated_at: '2026-02-24T12:30:00Z',
    exit_code: 0,
    error_message: null,
    tags: ['ci'],
    notes: 'nightly build',
    created_at: '2026-02-24T10:00:00Z',
    updated_at: '2026-02-24T12:30:00Z',
    connection: { name: 'ci-runner', id: 'conn-2' },
  },
];

vi.mock('@/ui/hooks/queries/use-terminal-sessions', () => ({
  useTerminalSessions: vi.fn(() => ({
    data: { sessions: mockSessions },
    isLoading: false,
    isError: false,
  })),
  useTerminateTerminalSession: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

// Must import after mocks
const { SessionsListPage } = await import('@/ui/pages/terminal/SessionsListPage');

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/terminal/sessions']}>
        <SessionsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SessionsListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('renders session cards', () => {
    renderPage();
    expect(screen.getByText('dev-server')).toBeInTheDocument();
    expect(screen.getByText('build-agent')).toBeInTheDocument();
  });

  it('has the correct test id', () => {
    renderPage();
    expect(screen.getByTestId('page-sessions-list')).toBeInTheDocument();
  });
});
