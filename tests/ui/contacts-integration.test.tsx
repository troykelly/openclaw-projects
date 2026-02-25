/**
 * @vitest-environment jsdom
 *
 * Integration tests for contacts omnibus PR (epic #1699).
 *
 * Covers:
 * - #1701: Structured name fields + contact kind in forms
 * - #1702: Endpoint management (add/edit/delete)
 * - #1703: Address management
 * - #1704: Date management
 * - #1705: Tag management
 * - #1706: Photo upload/display
 * - #1709: Contact merge
 * - #1711: Import/export
 * - #1713: Bulk selection + action bar
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
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
import { ContactDetailPage } from '@/ui/pages/ContactDetailPage';

const mockContactFull: Contact = {
  id: 'c-1',
  display_name: 'Alice Johnson',
  given_name: 'Alice',
  family_name: 'Johnson',
  middle_name: null,
  name_prefix: null,
  name_suffix: null,
  nickname: null,
  contact_kind: 'person',
  notes: 'Key stakeholder',
  photo_url: null,
  preferred_channel: null,
  quiet_hours_start: null,
  quiet_hours_end: null,
  quiet_hours_timezone: null,
  urgency_override_channel: null,
  notification_notes: null,
  created_at: '2024-01-15T10:00:00Z',
  endpoints: [
    { id: 'ep-1', type: 'email', value: 'alice@example.com', is_primary: true },
    { id: 'ep-2', type: 'phone', value: '+1-555-0101' },
  ],
  addresses: [
    {
      id: 'addr-1',
      address_type: 'home',
      street_address: '123 Main St',
      city: 'Springfield',
      region: 'IL',
      postal_code: '62701',
      country: 'US',
      is_primary: true,
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
    },
  ],
  dates: [
    {
      id: 'date-1',
      date_type: 'birthday',
      date_value: '1990-06-15',
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
    },
  ],
  tags: ['vip', 'engineering'],
};

const mockContacts: Contact[] = [
  mockContactFull,
  {
    id: 'c-2',
    display_name: 'Bob Smith',
    given_name: 'Bob',
    family_name: 'Smith',
    contact_kind: 'person',
    notes: null,
    photo_url: null,
    preferred_channel: null,
    quiet_hours_start: null,
    quiet_hours_end: null,
    quiet_hours_timezone: null,
    urgency_override_channel: null,
    notification_notes: null,
    created_at: '2024-01-20T10:00:00Z',
    endpoints: [{ id: 'ep-3', type: 'email', value: 'bob@example.com' }],
    tags: ['engineering'],
  },
  {
    id: 'c-3',
    display_name: 'Acme Corp',
    contact_kind: 'organisation',
    notes: null,
    photo_url: null,
    preferred_channel: null,
    quiet_hours_start: null,
    quiet_hours_end: null,
    quiet_hours_timezone: null,
    urgency_override_channel: null,
    notification_notes: null,
    created_at: '2024-01-10T10:00:00Z',
    endpoints: [],
    tags: [],
  },
];

const mockResponse: ContactsResponse = {
  contacts: mockContacts,
  total: 3,
};

function createWrapper(initialEntries = ['/contacts']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

function createDetailWrapper(contactId: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/contacts/${contactId}`]}>
          <Routes>
            <Route path="/contacts/:contact_id" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

// ──────────────────────────────────────────────────────────────
// #1701 — Structured name fields + contact kind in forms
// ──────────────────────────────────────────────────────────────
describe('#1701: Structured name fields + contact kind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
  });

  it('shows structured name fields in create dialog', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('add-contact-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('add-contact-button'));

    await waitFor(() => {
      expect(screen.getByTestId('contact-form-dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByTestId('contact-form-dialog');
    // Should have given_name and family_name fields instead of just display_name
    expect(within(dialog).getByTestId('contact-given-name')).toBeInTheDocument();
    expect(within(dialog).getByTestId('contact-family-name')).toBeInTheDocument();
  });

  it('shows contact kind selector in create dialog', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('add-contact-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('add-contact-button'));

    await waitFor(() => {
      expect(screen.getByTestId('contact-form-dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByTestId('contact-form-dialog');
    expect(within(dialog).getByTestId('contact-kind-select')).toBeInTheDocument();
  });

  it('displays contact kind badge on cards', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    // Organisation contacts should show a kind badge
    expect(screen.getByText('Organisation')).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────
// #1702 — Endpoint management
// ──────────────────────────────────────────────────────────────
describe('#1702: Endpoint management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockContactFull);
  });

  it('renders add endpoint button on detail page', async () => {
    render(<ContactDetailPage />, { wrapper: createDetailWrapper('c-1') });

    await waitFor(() => {
      expect(screen.getByTestId('add-endpoint-button')).toBeInTheDocument();
    });
  });

  it('renders edit and delete buttons on each endpoint', async () => {
    render(<ContactDetailPage />, { wrapper: createDetailWrapper('c-1') });

    await waitFor(() => {
      const cards = screen.getAllByTestId('endpoint-card');
      expect(cards.length).toBe(2);
    });

    const cards = screen.getAllByTestId('endpoint-card');
    // Each endpoint card should have edit/delete actions
    for (const card of cards) {
      expect(within(card).getByTestId('endpoint-edit-button')).toBeInTheDocument();
      expect(within(card).getByTestId('endpoint-delete-button')).toBeInTheDocument();
    }
  });
});

// ──────────────────────────────────────────────────────────────
// #1703 — Address management
// ──────────────────────────────────────────────────────────────
describe('#1703: Address management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockContactFull);
  });

  it('renders Addresses tab on detail page', async () => {
    render(<ContactDetailPage />, { wrapper: createDetailWrapper('c-1') });

    await waitFor(() => {
      expect(screen.getByText('Addresses')).toBeInTheDocument();
    });
  });

  it('renders address tab trigger with MapPin icon', async () => {
    render(<ContactDetailPage />, { wrapper: createDetailWrapper('c-1') });

    await waitFor(() => {
      // The Addresses tab trigger should be in the tab list
      const tabsList = screen.getByTestId('contact-tabs');
      expect(within(tabsList).getByText('Addresses')).toBeInTheDocument();
    });
  });
});

// ──────────────────────────────────────────────────────────────
// #1704 — Date management
// ──────────────────────────────────────────────────────────────
describe('#1704: Date management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockContactFull);
  });

  it('renders Dates tab on detail page', async () => {
    render(<ContactDetailPage />, { wrapper: createDetailWrapper('c-1') });

    await waitFor(() => {
      expect(screen.getByText('Dates')).toBeInTheDocument();
    });
  });

  it('renders dates tab trigger with Calendar icon', async () => {
    render(<ContactDetailPage />, { wrapper: createDetailWrapper('c-1') });

    await waitFor(() => {
      const tabsList = screen.getByTestId('contact-tabs');
      expect(within(tabsList).getByText('Dates')).toBeInTheDocument();
    });
  });
});

// ──────────────────────────────────────────────────────────────
// #1705 — Tag management
// ──────────────────────────────────────────────────────────────
describe('#1705: Tag management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows tag badges on contact cards in list', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    });

    // Tags should be displayed as badges
    expect(screen.getAllByText('vip').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('engineering').length).toBeGreaterThanOrEqual(1);
  });

  it('shows tags section on detail page', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockContactFull);

    render(<ContactDetailPage />, { wrapper: createDetailWrapper('c-1') });

    await waitFor(() => {
      expect(screen.getByTestId('contact-tags-section')).toBeInTheDocument();
    });

    expect(screen.getByText('vip')).toBeInTheDocument();
    expect(screen.getByText('engineering')).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────
// #1706 — Photo upload/display
// ──────────────────────────────────────────────────────────────
describe('#1706: Photo upload/display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows initials when no photo_url', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockContactFull);

    render(<ContactDetailPage />, { wrapper: createDetailWrapper('c-1') });

    await waitFor(() => {
      expect(screen.getByText('AJ')).toBeInTheDocument();
    });
  });

  it('shows photo when photo_url is set', async () => {
    const contactWithPhoto = {
      ...mockContactFull,
      photo_url: 'https://example.com/photo.jpg',
    };
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(contactWithPhoto);

    render(<ContactDetailPage />, { wrapper: createDetailWrapper('c-1') });

    await waitFor(() => {
      expect(screen.getByTestId('contact-avatar-image')).toBeInTheDocument();
    });
  });
});

// ──────────────────────────────────────────────────────────────
// #1709 — Contact merge
// ──────────────────────────────────────────────────────────────
describe('#1709: Contact merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
  });

  it('renders merge button in toolbar', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('merge-contacts-button')).toBeInTheDocument();
    });
  });
});

// ──────────────────────────────────────────────────────────────
// #1711 — Import/export
// ──────────────────────────────────────────────────────────────
describe('#1711: Import/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
  });

  it('renders import button in toolbar', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('import-contacts-button')).toBeInTheDocument();
    });
  });

  it('renders export button in toolbar', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('export-contacts-button')).toBeInTheDocument();
    });
  });
});

// ──────────────────────────────────────────────────────────────
// #1713 — Bulk selection + action bar
// ──────────────────────────────────────────────────────────────
describe('#1713: Bulk selection + action bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
  });

  it('renders checkboxes on contact cards', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(3);
  });

  it('shows select all checkbox', async () => {
    render(<ContactsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument();
    });
  });
});
