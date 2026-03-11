/**
 * @vitest-environment jsdom
 *
 * Tests for the VoicePage component.
 * Issue #1754: Voice/Speech management page.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage(initialPath = '/voice') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const VoicePage = React.lazy(() =>
    import('@/ui/pages/VoicePage.js').then((m) => ({ default: m.VoicePage })),
  );

  const routes = [
    {
      path: 'voice',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <VoicePage />
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

describe('VoicePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page with header', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url === '/chat/agents') return Promise.resolve({ agents: [] });
      return Promise.resolve({ data: null });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('page-voice')).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.getByText('Voice & Speech')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockApiClient.get.mockImplementation(() => new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows config section when config exists', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url === '/chat/agents') return Promise.resolve({ agents: [] });
      if (url.includes('/config')) {
        return Promise.resolve({
          data: {
            id: 'vc1',
            namespace: 'default',
            default_agent_id: null,
            timeout_ms: 5000,
            idle_timeout_s: 300,
            retention_days: 30,
            device_mapping: {},
            user_mapping: {},
            service_allowlist: ['light', 'switch'],
            metadata: {},
            created_at: '2026-02-20T10:00:00Z',
            updated_at: '2026-02-20T10:00:00Z',
          },
        });
      }
      return Promise.resolve({ data: [], total: 0, limit: 50, offset: 0 });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Configuration')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('shows conversation history', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url === '/chat/agents') return Promise.resolve({ agents: [] });
      if (url.includes('/config')) {
        return Promise.resolve({ data: null });
      }
      return Promise.resolve({
        data: [
          {
            id: 'conv1',
            namespace: 'default',
            agent_id: null,
            device_id: null,
            user_email: 'test@example.com',
            created_at: '2026-02-20T10:00:00Z',
            last_active_at: '2026-02-20T10:30:00Z',
            metadata: {},
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Conversation History')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('shows empty state when no conversations', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url === '/chat/agents') return Promise.resolve({ agents: [] });
      if (url.includes('/config')) {
        return Promise.resolve({ data: null });
      }
      return Promise.resolve({ data: [], total: 0, limit: 50, offset: 0 });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No conversations yet.')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('fetches agents from /chat/agents on mount', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url === '/chat/agents') {
        return Promise.resolve({ agents: [] });
      }
      if (url.includes('/config')) {
        return Promise.resolve({ data: null });
      }
      return Promise.resolve({ data: [], total: 0, limit: 50, offset: 0 });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('page-voice')).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(mockApiClient.get).toHaveBeenCalledWith('/chat/agents');
  });

  it('shows agent display name in read-only config view', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url === '/chat/agents') {
        return Promise.resolve({
          agents: [
            { id: 'agent-voice-1', name: 'voice-1', display_name: 'Voice Assistant', avatar_url: null },
          ],
        });
      }
      if (url.includes('/config')) {
        return Promise.resolve({
          data: {
            id: 'vc1',
            namespace: 'default',
            default_agent_id: 'agent-voice-1',
            timeout_ms: 5000,
            idle_timeout_s: 300,
            retention_days: 30,
            device_mapping: {},
            user_mapping: {},
            service_allowlist: [],
            metadata: {},
            created_at: '2026-02-20T10:00:00Z',
            updated_at: '2026-02-20T10:00:00Z',
          },
        });
      }
      return Promise.resolve({ data: [], total: 0, limit: 50, offset: 0 });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Voice Assistant')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Should not show the raw agent ID
    expect(screen.queryByText('agent-voice-1')).not.toBeInTheDocument();
  });

  it('renders default_agent_id selector in edit dialog', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url === '/chat/agents') {
        return Promise.resolve({
          agents: [
            { id: 'agent-voice-1', name: 'voice-1', display_name: 'Voice Assistant', avatar_url: null },
            { id: 'agent-voice-2', name: 'voice-2', display_name: 'Voice Helper', avatar_url: null },
          ],
        });
      }
      if (url.includes('/config')) {
        return Promise.resolve({
          data: {
            id: 'vc1',
            namespace: 'default',
            default_agent_id: null,
            timeout_ms: 5000,
            idle_timeout_s: 300,
            retention_days: 30,
            device_mapping: {},
            user_mapping: {},
            service_allowlist: [],
            metadata: {},
            created_at: '2026-02-20T10:00:00Z',
            updated_at: '2026-02-20T10:00:00Z',
          },
        });
      }
      return Promise.resolve({ data: [], total: 0, limit: 50, offset: 0 });
    });

    renderPage();

    // Wait for config to load and the Edit button to appear
    await waitFor(() => {
      expect(screen.getByText('Configuration')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Click Edit button to open dialog
    const editBtn = screen.getByRole('button', { name: /edit/i });
    fireEvent.click(editBtn);

    // Dialog should appear with the agent selector
    await waitFor(() => {
      expect(screen.getByTestId('voice-default-agent-select')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Should show the Default Agent label in the dialog
    expect(screen.getByLabelText('Default Agent')).toBeInTheDocument();
  });

  it('sends default_agent_id when saving config', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
      if (url === '/chat/agents') {
        return Promise.resolve({
          agents: [
            { id: 'agent-voice-1', name: 'voice-1', display_name: 'Voice Assistant', avatar_url: null },
          ],
        });
      }
      if (url.includes('/config')) {
        return Promise.resolve({
          data: {
            id: 'vc1',
            namespace: 'default',
            default_agent_id: 'agent-voice-1',
            timeout_ms: 5000,
            idle_timeout_s: 300,
            retention_days: 30,
            device_mapping: {},
            user_mapping: {},
            service_allowlist: [],
            metadata: {},
            created_at: '2026-02-20T10:00:00Z',
            updated_at: '2026-02-20T10:00:00Z',
          },
        });
      }
      return Promise.resolve({ data: [], total: 0, limit: 50, offset: 0 });
    });
    mockApiClient.put.mockResolvedValue({ data: {} });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Configuration')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Open edit dialog
    fireEvent.click(screen.getByText('Edit'));

    await waitFor(() => {
      expect(screen.getByTestId('voice-default-agent-select')).toBeInTheDocument();
    });

    // Click Save
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockApiClient.put).toHaveBeenCalledWith(
        '/voice/config',
        expect.objectContaining({ default_agent_id: 'agent-voice-1' }),
      );
    });
  });
});
