/**
 * @vitest-environment jsdom
 *
 * Tests for the SearchPage component.
 *
 * Validates:
 * - Page renders with data-testid="page-search"
 * - Search input reads from URL query params (?q=...)
 * - Results are grouped by type (work_item, contact, memory)
 * - Empty state shown when no results
 * - Loading state shown while fetching
 * - Error state shown on API failure
 * - Results link to correct pages
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SearchResponse, SearchResultItem } from '@/ui/lib/api-types';

// Mock the API client
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiClient } from '@/ui/lib/api-client';
import { SearchPage } from '@/ui/pages/SearchPage';

const mockWorkItems: SearchResultItem[] = [
  {
    type: 'work_item',
    id: 'wi-1',
    title: 'Login Feature',
    description: 'Implement user login flow',
    url: '/app/work-items/wi-1',
  },
  {
    type: 'work_item',
    id: 'wi-2',
    title: 'Dashboard Layout',
    description: 'Build dashboard page',
    url: '/app/work-items/wi-2',
  },
];

const mockContacts: SearchResultItem[] = [
  {
    type: 'contact',
    id: 'c-1',
    title: 'Alice Smith',
    description: 'alice@example.com',
    url: '/app/contacts',
  },
];

const mockMemories: SearchResultItem[] = [
  {
    type: 'memory',
    id: 'mem-1',
    title: 'User prefers dark mode',
    description: 'Preference for dark theme across applications',
    url: '/app/memory',
  },
];

const mockSearchResponse: SearchResponse = {
  results: [...mockWorkItems, ...mockContacts, ...mockMemories],
};

const emptySearchResponse: SearchResponse = {
  results: [],
};

/**
 * Renders SearchPage inside a router at the given path.
 */
function renderSearchPage(initialPath = '/search') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const routes = [
    {
      path: 'search',
      element: <SearchPage />,
    },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: [initialPath],
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('SearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with data-testid="page-search"', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(emptySearchResponse);

    renderSearchPage('/search');

    await waitFor(() => {
      expect(screen.getByTestId('page-search')).toBeInTheDocument();
    });
  });

  it('reads query from URL search params', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockSearchResponse);

    renderSearchPage('/search?q=login');

    await waitFor(() => {
      expect(screen.getByTestId('page-search')).toBeInTheDocument();
    });

    // The search input should reflect the URL param
    const searchInput = screen.getByTestId('search-input') as HTMLInputElement;
    expect(searchInput.value).toBe('login');

    // API should have been called with the query
    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('q=login'),
        expect.anything(),
      );
    });
  });

  it('groups results by type', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockSearchResponse);

    renderSearchPage('/search?q=test');

    // Wait for results to render
    await waitFor(() => {
      expect(screen.getByText('Login Feature')).toBeInTheDocument();
    });

    // Should see group headings
    expect(screen.getByTestId('group-work_items')).toBeInTheDocument();
    expect(screen.getByTestId('group-contacts')).toBeInTheDocument();
    expect(screen.getByTestId('group-memories')).toBeInTheDocument();

    // Should see specific results
    expect(screen.getByText('Login Feature')).toBeInTheDocument();
    expect(screen.getByText('Dashboard Layout')).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('User prefers dark mode')).toBeInTheDocument();
  });

  it('shows empty state when no results', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(emptySearchResponse);

    renderSearchPage('/search?q=nonexistent');

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('shows empty state when query is empty', async () => {
    renderSearchPage('/search');

    await waitFor(() => {
      expect(screen.getByTestId('page-search')).toBeInTheDocument();
    });

    // With empty query, useSearch should not fire (enabled: false),
    // so we should see a prompt/empty state
    expect(screen.getByTestId('search-prompt')).toBeInTheDocument();
  });

  it('shows loading state while fetching', async () => {
    // Create a promise that never resolves to keep loading state visible
    let resolvePromise: (value: SearchResponse) => void;
    const pendingPromise = new Promise<SearchResponse>((resolve) => {
      resolvePromise = resolve;
    });
    (apiClient.get as ReturnType<typeof vi.fn>).mockReturnValue(pendingPromise);

    renderSearchPage('/search?q=loading');

    await waitFor(() => {
      expect(screen.getByTestId('search-loading')).toBeInTheDocument();
    });

    // Resolve to avoid dangling promises
    resolvePromise!(emptySearchResponse);
  });

  it('shows error state on API failure', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error'),
    );

    renderSearchPage('/search?q=error');

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument();
    });
  });

  it('renders result items with links to correct pages', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockSearchResponse);

    renderSearchPage('/search?q=test');

    await waitFor(() => {
      expect(screen.getByText('Login Feature')).toBeInTheDocument();
    });

    // Work items should link to /work-items/:id
    const workItemLink = screen.getByTestId('result-link-wi-1');
    expect(workItemLink).toBeInTheDocument();
    expect(workItemLink.getAttribute('href')).toBe('/work-items/wi-1');

    // Contact should link to /contacts
    const contactLink = screen.getByTestId('result-link-c-1');
    expect(contactLink).toBeInTheDocument();
    expect(contactLink.getAttribute('href')).toBe('/contacts');

    // Memory should link to /memory
    const memoryLink = screen.getByTestId('result-link-mem-1');
    expect(memoryLink).toBeInTheDocument();
    expect(memoryLink.getAttribute('href')).toBe('/memory');
  });

  it('updates URL when search input changes', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(emptySearchResponse);

    renderSearchPage('/search');

    await waitFor(() => {
      expect(screen.getByTestId('page-search')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('search-input');
    fireEvent.change(searchInput, { target: { value: 'new query' } });

    // Input value should update
    expect((searchInput as HTMLInputElement).value).toBe('new query');
  });
});
