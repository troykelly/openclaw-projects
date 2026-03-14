/**
 * @vitest-environment jsdom
 *
 * Tests for the DevPromptsPage component.
 * Issue #2016: Frontend Dev Prompts Management Page.
 * Issue #2018: Frontend TDD Component Tests.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiClient = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  put: vi.fn(),
};

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const systemPrompt = {
  id: 'p1',
  namespace: 'default',
  prompt_key: 'new_feature_request',
  category: 'creation',
  is_system: true,
  title: 'New Feature Request',
  description: 'Template for new feature requests',
  body: '# Feature: {{prompt_title}}\nDate: {{date}}',
  default_body: '# Feature: {{prompt_title}}\nDate: {{date}}',
  sort_order: 10,
  is_active: true,
  deleted_at: null,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

const userPrompt = {
  id: 'p2',
  namespace: 'troy',
  prompt_key: 'my_custom_prompt',
  category: 'custom',
  is_system: false,
  title: 'My Custom Prompt',
  description: 'A custom user prompt',
  body: 'Hello {{namespace}}!',
  default_body: '',
  sort_order: 100,
  is_active: true,
  deleted_at: null,
  created_at: '2026-03-02T00:00:00Z',
  updated_at: '2026-03-02T00:00:00Z',
};

const listResponse = {
  total: 2,
  limit: 50,
  offset: 0,
  items: [systemPrompt, userPrompt],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage(initialPath = '/dev-prompts') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const DevPromptsPage = React.lazy(() =>
    import('@/ui/pages/DevPromptsPage.js').then((m) => ({ default: m.DevPromptsPage })),
  );

  const routes = [
    {
      path: 'dev-prompts',
      element: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <DevPromptsPage />
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

describe('DevPromptsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page with header and create button', async () => {
    mockApiClient.get.mockResolvedValue(listResponse);

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByTestId('page-dev-prompts')).toBeInTheDocument();
      },
    );

    expect(screen.getByText('Dev Prompts')).toBeInTheDocument();
    expect(screen.getByTestId('create-prompt-button')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockApiClient.get.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows empty state when no prompts exist', async () => {
    mockApiClient.get.mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] });

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText(/no dev prompts found/i)).toBeInTheDocument();
      },
    );
  });

  it('renders prompt cards when data is available', async () => {
    mockApiClient.get.mockResolvedValue(listResponse);

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('New Feature Request')).toBeInTheDocument();
      },
    );

    expect(screen.getByText('My Custom Prompt')).toBeInTheDocument();
  });

  it('shows category filter control', async () => {
    mockApiClient.get.mockResolvedValue(listResponse);

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByTestId('category-filter')).toBeInTheDocument();
      },
    );
  });

  it('shows search input', async () => {
    mockApiClient.get.mockResolvedValue(listResponse);

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByPlaceholderText(/search prompts/i)).toBeInTheDocument();
      },
    );
  });

  it('opens create dialog when create button is clicked', async () => {
    mockApiClient.get.mockResolvedValue(listResponse);

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByTestId('create-prompt-button')).toBeInTheDocument();
      },
    );

    fireEvent.click(screen.getByTestId('create-prompt-button'));

    await waitFor(() => {
      expect(screen.getByTestId('create-prompt-dialog')).toBeInTheDocument();
    });
  });

  it('displays system badge on system prompts', async () => {
    mockApiClient.get.mockResolvedValue(listResponse);

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('New Feature Request')).toBeInTheDocument();
      },
    );

    expect(screen.getByText('system')).toBeInTheDocument();
  });

  it('displays category badges on prompt cards', async () => {
    mockApiClient.get.mockResolvedValue(listResponse);

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByText('creation')).toBeInTheDocument();
      },
    );

    expect(screen.getByText('custom')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    mockApiClient.get.mockRejectedValue(new Error('Network error'));

    renderPage();

    await waitFor(
      () => {
        expect(screen.getByTestId('prompt-list-error')).toBeInTheDocument();
      },
    );

    expect(screen.getByText(/failed to load prompts/i)).toBeInTheDocument();
  });
});
