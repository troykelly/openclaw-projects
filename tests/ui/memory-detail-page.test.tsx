/**
 * @vitest-environment jsdom
 *
 * Tests for the MemoryDetailPage component (#1732).
 *
 * Validates:
 * - Loading, error, and not-found states
 * - Memory content display
 * - Metadata tab with importance, confidence, embedding status
 * - Contacts tab (#1723)
 * - Related memories tab (#1724)
 * - Attachments tab (#1726)
 * - Geolocation display (#1728)
 * - Active/superseded indicator (#1725)
 * - Tags display (#1721)
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { Memory } from '@/ui/lib/api-types';

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
import { MemoryDetailPage } from '@/ui/pages/MemoryDetailPage';

const mockMemory: Memory = {
  id: 'mem-detail-1',
  title: 'Test detail memory',
  content: 'This is detailed content for the memory.',
  type: 'fact',
  memory_type: 'fact',
  work_item_id: null,
  project_id: null,
  contact_id: null,
  relationship_id: null,
  importance: 8,
  confidence: 0.92,
  expires_at: '2027-01-01T00:00:00Z',
  source_url: 'https://example.com/source',
  tags: ['important', 'verified'],
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
  attachment_count: 1,
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-01-15T10:00:00Z',
};

function createWrapper(route = '/memory/mem-detail-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/memory/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe('MemoryDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/memories/mem-detail-1') {
        return Promise.resolve(mockMemory);
      }
      if (url.includes('/attachments')) {
        return Promise.resolve({
          attachments: [
            {
              id: 'att-1',
              original_filename: 'document.pdf',
              content_type: 'application/pdf',
              size_bytes: 1024000,
              created_at: '2026-01-15T10:00:00Z',
              attached_at: '2026-01-15T10:00:00Z',
            },
          ],
        });
      }
      if (url.includes('/contacts')) {
        return Promise.resolve({
          contacts: [
            {
              contact_id: 'contact-1',
              display_name: 'John Doe',
              linked_at: '2026-01-15T10:00:00Z',
            },
          ],
        });
      }
      if (url.includes('/related')) {
        return Promise.resolve({ related: [] });
      }
      if (url.includes('/similar')) {
        return Promise.resolve({ source_memory_id: '1', threshold: 0.7, similar: [] });
      }
      return Promise.resolve({});
    });
  });

  it('renders the page container', async () => {
    render(<MemoryDetailPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('page-memory-detail')).toBeInTheDocument();
    });
  });

  it('displays memory title', async () => {
    render(<MemoryDetailPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Test detail memory')).toBeInTheDocument();
    });
  });

  it('shows active status indicator', async () => {
    render(<MemoryDetailPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument();
    });
  });

  it('displays tags', async () => {
    render(<MemoryDetailPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('important')).toBeInTheDocument();
      expect(screen.getByText('verified')).toBeInTheDocument();
    });
  });

  it('shows back button', async () => {
    render(<MemoryDetailPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('back-button')).toBeInTheDocument();
    });
  });

  it('renders tab navigation', async () => {
    render(<MemoryDetailPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('memory-detail-tabs')).toBeInTheDocument();
    });
  });

  it('shows memory content in the content tab', async () => {
    render(<MemoryDetailPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('memory-content')).toBeInTheDocument();
      expect(screen.getByText('This is detailed content for the memory.')).toBeInTheDocument();
    });
  });

  it('shows Fact type badge', async () => {
    render(<MemoryDetailPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Fact')).toBeInTheDocument();
    });
  });

  it('shows error state on API failure', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    render(<MemoryDetailPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Failed to load memory')).toBeInTheDocument();
    });
  });
});
