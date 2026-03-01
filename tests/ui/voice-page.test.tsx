/**
 * @vitest-environment jsdom
 *
 * Tests for the VoicePage component.
 * Issue #1754: Voice/Speech management page.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    mockApiClient.get.mockResolvedValue({ data: null });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('page-voice')).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.getByText('Voice & Speech')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockApiClient.get.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows config section when config exists', async () => {
    mockApiClient.get.mockImplementation((url: string) => {
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
});
