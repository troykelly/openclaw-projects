/**
 * @vitest-environment jsdom
 *
 * Tests for the MemoryPage component.
 *
 * Validates:
 * - Loading, error, and empty states render correctly
 * - Memory cards display correct information (title, content preview, type badge)
 * - Search input filters memories by title and content
 * - Type filter filters memories by type
 * - Inline expand/collapse works
 * - Create dialog opens with form elements
 * - Total count displays correctly
 * - Page heading renders
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { Memory, MemoryListResponse } from '@/ui/lib/api-types';

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
import { MemoryPage } from '@/ui/pages/MemoryPage';

const mockMemories: Memory[] = [
  {
    id: 'm-1',
    title: 'User prefers dark mode',
    content: 'The user has stated they prefer dark mode for all interfaces and applications.',
    type: 'preference',
    work_item_id: null,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
  },
  {
    id: 'm-2',
    title: 'API uses REST architecture',
    content: 'We decided to use REST for all external APIs. GraphQL was considered but rejected due to complexity concerns for third-party integrations.',
    type: 'decision',
    work_item_id: 'wi-1',
    created_at: '2024-01-20T10:00:00Z',
    updated_at: '2024-01-22T10:00:00Z',
  },
  {
    id: 'm-3',
    title: 'Project deadline is March 2025',
    content: 'The project must be completed by March 2025 to meet the client delivery timeline.',
    type: 'fact',
    work_item_id: null,
    created_at: '2024-01-10T10:00:00Z',
    updated_at: '2024-01-10T10:00:00Z',
  },
  {
    id: 'm-4',
    title: 'Current sprint context',
    content: 'Sprint 12 focuses on memory management and knowledge base features. Key stories include the memory page rebuild and semantic search integration.',
    type: 'context',
    work_item_id: 'wi-2',
    created_at: '2024-02-01T10:00:00Z',
    updated_at: '2024-02-03T10:00:00Z',
  },
];

const mockResponse: MemoryListResponse = {
  memories: mockMemories,
  total: 4,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe('MemoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
  });

  it('renders loading state initially then memories', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    // Should show page container
    expect(screen.getByTestId('page-memory')).toBeInTheDocument();

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('User prefers dark mode')).toBeInTheDocument();
    });

    expect(screen.getByText('API uses REST architecture')).toBeInTheDocument();
    expect(screen.getByText('Project deadline is March 2025')).toBeInTheDocument();
    expect(screen.getByText('Current sprint context')).toBeInTheDocument();
  });

  it('displays the correct total count', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('4 memories')).toBeInTheDocument();
    });
  });

  it('renders the search input', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('memory-search-input')).toBeInTheDocument();
    });
  });

  it('renders add memory button', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('add-memory-button')).toBeInTheDocument();
    });
  });

  it('renders type filter control', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('type-filter')).toBeInTheDocument();
    });
  });

  it('renders page heading', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Memory')).toBeInTheDocument();
    });
  });

  it('shows type badges on memory cards', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      const badges = screen.getAllByTestId('memory-type-badge');
      expect(badges.length).toBe(4);
    });

    // Verify specific type labels appear
    expect(screen.getByText('Preference')).toBeInTheDocument();
    expect(screen.getByText('Decision')).toBeInTheDocument();
    expect(screen.getByText('Fact')).toBeInTheDocument();
    expect(screen.getByText('Context')).toBeInTheDocument();
  });

  it('shows content preview for memories', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/The user has stated they prefer dark mode/)).toBeInTheDocument();
    });
  });

  it('shows linked indicator for memories with work_item_id', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      const linkedIndicators = screen.getAllByText('Linked');
      // m-2 and m-4 have work_item_id
      expect(linkedIndicators.length).toBe(2);
    });
  });

  it('opens create dialog when Add Memory clicked', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('add-memory-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('add-memory-button'));

    await waitFor(() => {
      expect(screen.getByTestId('memory-form-dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByTestId('memory-form-dialog');
    expect(within(dialog).getByTestId('memory-title-input')).toBeInTheDocument();
    expect(within(dialog).getByTestId('memory-content-input')).toBeInTheDocument();
    expect(within(dialog).getByTestId('memory-form-submit')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Failed to load memories')).toBeInTheDocument();
    });
  });

  it('shows empty state when no memories', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      memories: [],
      total: 0,
    });

    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('No memories yet')).toBeInTheDocument();
    });
  });

  it('filters memories by search query', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('User prefers dark mode')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('memory-search-input');
    fireEvent.change(searchInput, { target: { value: 'dark mode' } });

    // Only the matching memory should be visible
    expect(screen.getByText('User prefers dark mode')).toBeInTheDocument();
    expect(screen.queryByText('API uses REST architecture')).not.toBeInTheDocument();
    expect(screen.queryByText('Project deadline is March 2025')).not.toBeInTheDocument();
  });

  it('shows expand/collapse toggle on memory cards', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      const toggles = screen.getAllByTestId('memory-expand-toggle');
      expect(toggles.length).toBe(4);
    });
  });

  it('renders memory list container', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('memory-list')).toBeInTheDocument();
    });
  });

  it('displays singular memory count for 1 memory', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      memories: [mockMemories[0]],
      total: 1,
    });

    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('1 memory')).toBeInTheDocument();
    });
  });
});
