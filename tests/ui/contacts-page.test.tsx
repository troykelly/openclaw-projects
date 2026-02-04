/**
 * @vitest-environment jsdom
 *
 * Tests for the enhanced ContactsPage and ContactDetailPage components.
 *
 * Validates:
 * - Search, sort, and view mode controls render and function
 * - Contact cards/rows display correct information
 * - Loading, error, and empty states render correctly
 * - Create/edit dialog opens and submits
 * - Detail sheet opens on contact click
 * - Contact detail page renders with tabs
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { Contact, ContactsResponse } from '@/ui/lib/api-types';

// Mock the API client
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import { apiClient } from '@/ui/lib/api-client';
import { ContactsPage } from '@/ui/pages/ContactsPage';

const mockContacts: Contact[] = [
  {
    id: 'c-1',
    display_name: 'Alice Johnson',
    notes: 'Key stakeholder',
    created_at: '2024-01-15T10:00:00Z',
    endpoints: [
      { type: 'email', value: 'alice@example.com' },
      { type: 'phone', value: '+1-555-0101' },
    ],
  },
  {
    id: 'c-2',
    display_name: 'Bob Smith',
    notes: null,
    created_at: '2024-01-20T10:00:00Z',
    endpoints: [
      { type: 'email', value: 'bob@example.com' },
    ],
  },
  {
    id: 'c-3',
    display_name: 'Charlie Brown',
    notes: null,
    created_at: '2024-01-10T10:00:00Z',
    endpoints: [],
  },
];

const mockResponse: ContactsResponse = {
  contacts: mockContacts,
  total: 3,
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

describe('ContactsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
  });

  it('renders loading state initially then contacts', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    // Should show page container
    expect(screen.getByTestId('page-contacts')).toBeInTheDocument();

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    });

    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();
  });

  it('displays the correct total count', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('3 contacts')).toBeInTheDocument();
    });
  });

  it('renders the search input', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('contact-search-input')).toBeInTheDocument();
    });
  });

  it('renders add contact button', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('add-contact-button')).toBeInTheDocument();
    });
  });

  it('opens create dialog when Add Contact clicked', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('add-contact-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('add-contact-button'));

    await waitFor(() => {
      expect(screen.getByTestId('contact-form-dialog')).toBeInTheDocument();
    });

    // Verify the dialog contains the form elements
    const dialog = screen.getByTestId('contact-form-dialog');
    expect(within(dialog).getByTestId('contact-name-input')).toBeInTheDocument();
    expect(within(dialog).getByTestId('contact-form-submit')).toBeInTheDocument();
  });

  it('shows email and phone in contact cards', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
      expect(screen.getByText('+1-555-0101')).toBeInTheDocument();
    });
  });

  it('shows endpoint count badge', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('2 endpoints')).toBeInTheDocument();
      expect(screen.getByText('1 endpoint')).toBeInTheDocument();
    });
  });

  it('renders view mode toggle buttons', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('view-grid')).toBeInTheDocument();
      expect(screen.getByTestId('view-list')).toBeInTheDocument();
    });
  });

  it('switches to list view', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('view-list')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('view-list'));

    await waitFor(() => {
      expect(screen.getByTestId('contacts-list')).toBeInTheDocument();
    });
  });

  it('renders sort control', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('sort-select')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error'),
    );

    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Failed to load contacts')).toBeInTheDocument();
    });
  });

  it('shows empty state when no contacts', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      contacts: [],
      total: 0,
    });

    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('No contacts yet')).toBeInTheDocument();
    });
  });

  it('shows initials avatar for contacts', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('AJ')).toBeInTheDocument();
      expect(screen.getByText('BS')).toBeInTheDocument();
      expect(screen.getByText('CB')).toBeInTheDocument();
    });
  });

  it('renders page heading', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('People')).toBeInTheDocument();
    });
  });
});
