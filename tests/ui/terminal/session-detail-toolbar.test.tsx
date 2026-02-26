/**
 * Tests for SessionDetailPage toolbar wiring (Issue #1865).
 *
 * Verifies annotate, search, and split callbacks are wired.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSession = {
  id: 'sess-1',
  namespace: 'default',
  connection_id: 'conn-1',
  tmux_session_name: 'test-session',
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
  tags: [],
  notes: null,
  created_at: '2026-02-25T10:00:00Z',
  updated_at: '2026-02-25T11:00:00Z',
  windows: [{ id: 'w1', session_id: 'sess-1', namespace: 'default', window_index: 0, window_name: 'main', is_active: true }],
};

const mockAnnotate = vi.fn();

vi.mock('@/ui/hooks/queries/use-terminal-sessions', () => ({
  useTerminalSession: vi.fn(() => ({
    data: mockSession,
    isLoading: false,
    refetch: vi.fn(),
  })),
  useAnnotateTerminalSession: vi.fn(() => ({
    mutate: mockAnnotate,
    isPending: false,
  })),
  useUpdateTerminalSession: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

vi.mock('@/ui/hooks/queries/use-terminal-known-hosts', () => ({
  useApproveTerminalKnownHost: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useRejectTerminalKnownHost: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

vi.mock('@/ui/hooks/use-terminal-websocket', () => ({
  useTerminalWebSocket: vi.fn(() => ({
    status: 'connected',
    send: vi.fn(),
    resize: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    write() {}
    onData() {}
    onResize() {}
    dispose() {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext() {}
    findPrevious() {}
    clearDecorations() {}
  },
}));

const { SessionDetailPage } = await import('@/ui/pages/terminal/SessionDetailPage');

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/terminal/sessions/sess-1']}>
        <Routes>
          <Route path="/terminal/sessions/:id" element={<SessionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SessionDetailPage toolbar wiring (#1865)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders toolbar with action buttons', () => {
    renderPage();
    expect(screen.getByTestId('terminal-toolbar')).toBeInTheDocument();
    expect(screen.getByTitle('Search (Ctrl+Shift+F)')).toBeInTheDocument();
    expect(screen.getByTitle('Split pane')).toBeInTheDocument();
    expect(screen.getByTitle('Add annotation')).toBeInTheDocument();
  });

  it('opens annotation dialog when annotate button is clicked', () => {
    renderPage();
    const annotateBtn = screen.getByTitle('Add annotation');
    fireEvent.click(annotateBtn);
    expect(screen.getByTestId('annotation-dialog')).toBeInTheDocument();
  });

  it('renders annotation input in dialog', () => {
    renderPage();
    fireEvent.click(screen.getByTitle('Add annotation'));
    expect(screen.getByTestId('annotation-input')).toBeInTheDocument();
  });
});
