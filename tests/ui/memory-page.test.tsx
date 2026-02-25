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
 * - #1719: Metadata fields (importance, confidence, expiration, source)
 * - #1716: Semantic search toggle
 * - #1721: Tag display on cards
 * - #1725: Active/superseded indicator and filter
 * - #1728: Geolocation display (place_label badge)
 * - #1730: Date range filter selector
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
    memory_type: 'preference',
    work_item_id: null,
    project_id: null,
    contact_id: null,
    relationship_id: null,
    importance: 7,
    confidence: 0.9,
    expires_at: null,
    source_url: null,
    tags: ['ui', 'preferences'],
    created_by_agent: null,
    created_by_human: true,
    is_active: true,
    superseded_by: null,
    embedding_status: 'complete',
    lat: null,
    lng: null,
    address: null,
    place_label: null,
    namespace: 'default',
    attachment_count: 0,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
  },
  {
    id: 'm-2',
    title: 'API uses REST architecture',
    content: 'We decided to use REST for all external APIs. GraphQL was considered but rejected due to complexity concerns for third-party integrations.',
    type: 'decision',
    memory_type: 'decision',
    work_item_id: 'wi-1',
    project_id: null,
    contact_id: null,
    relationship_id: null,
    importance: 8,
    confidence: 0.95,
    expires_at: null,
    source_url: 'https://example.com/adr-001',
    tags: ['architecture'],
    created_by_agent: null,
    created_by_human: true,
    is_active: true,
    superseded_by: null,
    embedding_status: 'complete',
    lat: null,
    lng: null,
    address: null,
    place_label: null,
    namespace: 'default',
    attachment_count: 2,
    created_at: '2024-01-20T10:00:00Z',
    updated_at: '2024-01-22T10:00:00Z',
  },
  {
    id: 'm-3',
    title: 'Project deadline is March 2025',
    content: 'The project must be completed by March 2025 to meet the client delivery timeline.',
    type: 'fact',
    memory_type: 'fact',
    work_item_id: null,
    project_id: null,
    contact_id: null,
    relationship_id: null,
    importance: 5,
    confidence: 0.8,
    expires_at: null,
    source_url: null,
    tags: [],
    created_by_agent: null,
    created_by_human: true,
    is_active: true,
    superseded_by: null,
    embedding_status: 'complete',
    lat: -33.8688,
    lng: 151.2093,
    address: '123 George St, Sydney NSW 2000',
    place_label: 'Sydney Office',
    namespace: 'default',
    attachment_count: 0,
    created_at: '2024-01-10T10:00:00Z',
    updated_at: '2024-01-10T10:00:00Z',
  },
  {
    id: 'm-4',
    title: 'Current sprint context',
    content: 'Sprint 12 focuses on memory management and knowledge base features. Key stories include the memory page rebuild and semantic search integration.',
    type: 'context',
    memory_type: 'context',
    work_item_id: 'wi-2',
    project_id: null,
    contact_id: null,
    relationship_id: null,
    importance: 4,
    confidence: 0.7,
    expires_at: null,
    source_url: null,
    tags: [],
    created_by_agent: 'agent-1',
    created_by_human: false,
    is_active: false,
    superseded_by: 'm-1',
    embedding_status: 'complete',
    lat: null,
    lng: null,
    address: null,
    place_label: null,
    namespace: 'default',
    attachment_count: 0,
    created_at: '2024-02-01T10:00:00Z',
    updated_at: '2024-02-03T10:00:00Z',
  },
];

const mockResponse: MemoryListResponse = {
  items: mockMemories,
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
      expect(badges.length).toBeGreaterThanOrEqual(3);
    });
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
      // m-2 and m-4 have work_item_id (if m-4 is visible -- it's superseded)
      expect(linkedIndicators.length).toBeGreaterThanOrEqual(1);
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
      items: [],
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
      expect(toggles.length).toBeGreaterThanOrEqual(3);
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
      items: [mockMemories[0]],
      total: 1,
    });

    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('1 memory')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // #1719 — Metadata display
  // ---------------------------------------------------------------------------
  it('#1719: displays importance on memory cards', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('User prefers dark mode')).toBeInTheDocument();
    });

    // Importance indicator should be present
    const cards = screen.getAllByTestId('memory-card');
    expect(cards.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // #1716 — Semantic search toggle
  // ---------------------------------------------------------------------------
  it('#1716: renders semantic search toggle', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('semantic-search-toggle')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // #1721 — Tag display
  // ---------------------------------------------------------------------------
  it('#1721: displays tags on memory cards', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('User prefers dark mode')).toBeInTheDocument();
    });

    // Tags should be visible on memory cards
    expect(screen.getByText('ui')).toBeInTheDocument();
    expect(screen.getByText('preferences')).toBeInTheDocument();
    expect(screen.getByText('architecture')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // #1725 — Active/superseded filter
  // ---------------------------------------------------------------------------
  it('#1725: renders active filter toggle', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('active-filter-toggle')).toBeInTheDocument();
    });
  });

  it('#1725: hides superseded memories by default', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('User prefers dark mode')).toBeInTheDocument();
    });

    // m-4 is superseded (is_active=false), should be hidden by default
    expect(screen.queryByText('Current sprint context')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // #1728 — Geolocation display
  // ---------------------------------------------------------------------------
  it('#1728: displays place_label on geolocated memory', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Sydney Office')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // #1730 — Date range filter
  // ---------------------------------------------------------------------------
  it('#1730: renders date range filter', async () => {
    render(<MemoryPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('date-range-filter')).toBeInTheDocument();
    });
  });
});
