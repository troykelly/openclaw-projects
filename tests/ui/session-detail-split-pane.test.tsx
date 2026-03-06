/**
 * @vitest-environment jsdom
 *
 * Tests for the split pane functionality in SessionDetailPage.
 * Issue #2110: Split pane button wired to SplitPane RPC.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TerminalSession } from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockSession: TerminalSession = {
  id: 'sess-1',
  namespace: 'test',
  connection_id: 'conn-1',
  tmux_session_name: 'dev-server',
  worker_id: 'w1',
  status: 'active',
  cols: 120,
  rows: 40,
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
  windows: [
    {
      id: 'w1',
      session_id: 'sess-1',
      namespace: 'test',
      window_index: 0,
      window_name: 'bash',
      is_active: true,
      created_at: '2026-02-25T10:00:00Z',
      updated_at: '2026-02-25T10:00:00Z',
      panes: [
        {
          id: 'p1',
          window_id: 'w1',
          namespace: 'test',
          pane_index: 0,
          is_active: true,
          pid: 1234,
          current_command: 'bash',
          created_at: '2026-02-25T10:00:00Z',
          updated_at: '2026-02-25T10:00:00Z',
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/ui/hooks/queries/use-terminal-health', () => ({
  useTerminalHealth: () => ({
    data: { status: 'ok', worker_id: 'w1', active_sessions: 1, uptime_seconds: '100', version: '0.1.0' },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

// Mock the entire TerminalEmulator to avoid xterm.js constructor issues in jsdom
vi.mock('@/ui/components/terminal/terminal-emulator', () => ({
  TerminalEmulator: () => <div data-testid="terminal-emulator">mock terminal</div>,
}));

// Minimal ResizeObserver stub for jsdom
if (typeof ResizeObserver === 'undefined') {
  global.ResizeObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  } as unknown as typeof ResizeObserver;
}

describe('SessionDetailPage — Split Pane (#2110)', () => {
  let queryClient: QueryClient;

  // Pre-warm the lazy import so the first test doesn't time out (#2224)
  beforeAll(async () => {
    await import('@/ui/pages/terminal/SessionDetailPage');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/terminal/sessions/sess-1')) return Promise.resolve(mockSession);
      if (url.includes('/terminal/health')) return Promise.resolve({ status: 'ok' });
      return Promise.resolve({});
    });
    mockApiPost.mockResolvedValue({
      id: 'new-pane',
      window_id: 'w1',
      pane_index: 1,
      is_active: true,
      pid: 5678,
      current_command: 'bash',
    });
  });

  function renderPage() {
    const router = createMemoryRouter(
      [
        {
          path: '/terminal/sessions/:id',
          lazy: () =>
            import('@/ui/pages/terminal/SessionDetailPage').then((m) => ({ Component: m.SessionDetailPage })),
        },
      ],
      { initialEntries: ['/terminal/sessions/sess-1'] },
    );

    return render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  it('shows split pane button in the toolbar', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /split pane/i })).toBeInTheDocument();
    });
  });

  it('opens split direction dialog when split button is clicked', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /split pane/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /split pane/i }));

    await waitFor(() => {
      expect(screen.getByText(/split direction/i)).toBeInTheDocument();
    });
  });

  it('calls split API with horizontal direction when Horizontal is selected', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /split pane/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /split pane/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /horizontal/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /horizontal/i }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        expect.stringContaining('/split'),
        expect.objectContaining({ direction: 'horizontal' }),
      );
    });
  });

  it('calls split API with vertical direction when Vertical is selected', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /split pane/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /split pane/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /vertical/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /vertical/i }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        expect.stringContaining('/split'),
        expect.objectContaining({ direction: 'vertical' }),
      );
    });
  });
});
