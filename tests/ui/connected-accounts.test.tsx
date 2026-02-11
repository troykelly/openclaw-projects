/**
 * @vitest-environment jsdom
 *
 * Tests for the Connected Accounts settings section.
 * Covers: hook data fetching, connection list rendering, edit form,
 * delete confirmation, active toggle, and add account button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { useConnectedAccounts } from '@/ui/components/settings/use-connected-accounts';
import { ConnectedAccountsSection } from '@/ui/components/settings/connected-accounts-section';
import type { OAuthConnectionSummary, OAuthProviderInfo } from '@/ui/components/settings/types';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockConnection: OAuthConnectionSummary = {
  id: 'conn-1',
  userEmail: 'user@example.com',
  provider: 'google',
  scopes: ['contacts.readonly', 'email'],
  expiresAt: '2026-03-01T00:00:00Z',
  label: 'Work Gmail',
  providerAccountId: '12345',
  providerAccountEmail: 'work@gmail.com',
  permissionLevel: 'read',
  enabledFeatures: ['contacts', 'email'],
  isActive: true,
  lastSyncAt: '2026-02-10T12:00:00Z',
  syncStatus: {},
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-02-10T12:00:00Z',
};

const mockConnection2: OAuthConnectionSummary = {
  id: 'conn-2',
  userEmail: 'user@example.com',
  provider: 'microsoft',
  scopes: ['Mail.Read'],
  expiresAt: null,
  label: 'Personal Outlook',
  providerAccountId: '67890',
  providerAccountEmail: 'me@outlook.com',
  permissionLevel: 'read_write',
  enabledFeatures: ['email', 'calendar'],
  isActive: false,
  lastSyncAt: null,
  syncStatus: {},
  createdAt: '2026-02-05T00:00:00Z',
  updatedAt: '2026-02-05T00:00:00Z',
};

const mockProviders: OAuthProviderInfo[] = [
  { name: 'google', configured: true },
  { name: 'microsoft', configured: true },
];

const mockUnconfigured: OAuthProviderInfo[] = [
  { name: 'google', configured: false, hint: 'Set GOOGLE_CLIENT_ID' },
  { name: 'microsoft', configured: false, hint: 'Set MS365_CLIENT_ID' },
];

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchSuccess(
  connections: OAuthConnectionSummary[] = [mockConnection],
  providers: OAuthProviderInfo[] = mockProviders,
  unconfigured: OAuthProviderInfo[] = [],
) {
  return vi.fn().mockImplementation((url: string) => {
    if (url === '/api/oauth/connections') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ connections }),
      });
    }
    if (url === '/api/oauth/providers') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ providers, unconfigured }),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ error: 'not found' }),
    });
  });
}

function mockFetchError() {
  return vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: 'Server error' }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Hook tests
// ---------------------------------------------------------------------------

describe('useConnectedAccounts', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('starts in loading state then loads data', async () => {
    globalThis.fetch = mockFetchSuccess() as typeof globalThis.fetch;

    const { result } = renderHook(() => useConnectedAccounts());
    expect(result.current.state.kind).toBe('loading');

    await waitFor(() => {
      expect(result.current.state.kind).toBe('loaded');
    });

    if (result.current.state.kind === 'loaded') {
      expect(result.current.state.connections).toHaveLength(1);
      expect(result.current.state.connections[0].id).toBe('conn-1');
      expect(result.current.state.providers).toHaveLength(2);
    }
  });

  it('handles fetch error', async () => {
    globalThis.fetch = mockFetchError() as typeof globalThis.fetch;

    const { result } = renderHook(() => useConnectedAccounts());

    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });

    if (result.current.state.kind === 'error') {
      expect(result.current.state.message).toBeTruthy();
    }
  });

  it('updates a connection', async () => {
    const updatedConn = { ...mockConnection, label: 'Updated Label' };
    const fetchMock = mockFetchSuccess() as typeof globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ connection: updatedConn }),
        });
      }
      return (fetchMock as ReturnType<typeof vi.fn>)(url, opts);
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() => useConnectedAccounts());

    await waitFor(() => {
      expect(result.current.state.kind).toBe('loaded');
    });

    let success = false;
    await act(async () => {
      success = await result.current.updateConnection('conn-1', { label: 'Updated Label' });
    });

    expect(success).toBe(true);
    if (result.current.state.kind === 'loaded') {
      expect(result.current.state.connections[0].label).toBe('Updated Label');
    }
  });

  it('deletes a connection', async () => {
    const fetchMock = mockFetchSuccess([mockConnection, mockConnection2]) as typeof globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          status: 204,
        });
      }
      return (fetchMock as ReturnType<typeof vi.fn>)(url, opts);
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() => useConnectedAccounts());

    await waitFor(() => {
      expect(result.current.state.kind).toBe('loaded');
    });

    let success = false;
    await act(async () => {
      success = await result.current.deleteConnection('conn-1');
    });

    expect(success).toBe(true);
    if (result.current.state.kind === 'loaded') {
      expect(result.current.state.connections).toHaveLength(1);
      expect(result.current.state.connections[0].id).toBe('conn-2');
    }
  });
});

// ---------------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------------

describe('ConnectedAccountsSection', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('shows loading skeleton initially', () => {
    // Never-resolving fetch to keep loading state
    globalThis.fetch = vi.fn().mockImplementation(() => new Promise(() => {})) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);
    expect(screen.getByTestId('connected-accounts-card')).toBeInTheDocument();
    expect(screen.getByText('Loading connected accounts...')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    globalThis.fetch = mockFetchError() as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load accounts')).toBeInTheDocument();
    });
  });

  it('shows empty state when no connections exist', async () => {
    globalThis.fetch = mockFetchSuccess([], mockProviders) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('no-connections')).toBeInTheDocument();
    });

    expect(screen.getByText('No connected accounts')).toBeInTheDocument();
  });

  it('renders connection cards for each connection', async () => {
    globalThis.fetch = mockFetchSuccess([mockConnection, mockConnection2]) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('connections-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('connection-card-conn-1')).toBeInTheDocument();
    expect(screen.getByTestId('connection-card-conn-2')).toBeInTheDocument();
    expect(screen.getByText('Work Gmail')).toBeInTheDocument();
    expect(screen.getByText('Personal Outlook')).toBeInTheDocument();
    expect(screen.getByText('work@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('me@outlook.com')).toBeInTheDocument();
  });

  it('shows active/inactive badges', async () => {
    globalThis.fetch = mockFetchSuccess([mockConnection, mockConnection2]) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('connections-list')).toBeInTheDocument();
    });

    const card1 = screen.getByTestId('connection-card-conn-1');
    const card2 = screen.getByTestId('connection-card-conn-2');

    expect(within(card1).getByText('Active')).toBeInTheDocument();
    expect(within(card2).getByText('Inactive')).toBeInTheDocument();
  });

  it('shows enabled features as badges', async () => {
    globalThis.fetch = mockFetchSuccess([mockConnection]) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('connections-list')).toBeInTheDocument();
    });

    const card = screen.getByTestId('connection-card-conn-1');
    expect(within(card).getByText('Contacts')).toBeInTheDocument();
    expect(within(card).getByText('Email')).toBeInTheDocument();
  });

  it('shows provider icons', async () => {
    globalThis.fetch = mockFetchSuccess([mockConnection, mockConnection2]) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('connections-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('provider-icon-google')).toBeInTheDocument();
    expect(screen.getByTestId('provider-icon-microsoft')).toBeInTheDocument();
  });

  it('shows add account buttons for configured providers', async () => {
    globalThis.fetch = mockFetchSuccess([], mockProviders) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('no-connections')).toBeInTheDocument();
    });

    // Two providers configured, so two buttons
    expect(screen.getByTestId('add-account-google')).toBeInTheDocument();
    expect(screen.getByTestId('add-account-microsoft')).toBeInTheDocument();
  });

  it('shows single add button when only one provider configured', async () => {
    const oneProvider = [{ name: 'google', configured: true }];
    globalThis.fetch = mockFetchSuccess([], oneProvider, [
      { name: 'microsoft', configured: false, hint: 'Set MS365_CLIENT_ID' },
    ]) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('no-connections')).toBeInTheDocument();
    });

    expect(screen.getByTestId('add-account-btn')).toBeInTheDocument();
  });

  it('shows warning when no providers configured', async () => {
    globalThis.fetch = mockFetchSuccess([], [], mockUnconfigured) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByText('No OAuth providers configured')).toBeInTheDocument();
    });
  });

  it('opens edit form when edit button is clicked', async () => {
    globalThis.fetch = mockFetchSuccess([mockConnection]) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('connections-list')).toBeInTheDocument();
    });

    const editBtn = screen.getByTestId('edit-connection-conn-1');
    fireEvent.click(editBtn);

    expect(screen.getByTestId('connection-edit-form')).toBeInTheDocument();
    // Label input should have current value
    const labelInput = screen.getByDisplayValue('Work Gmail');
    expect(labelInput).toBeInTheDocument();
  });

  it('closes edit form on cancel', async () => {
    globalThis.fetch = mockFetchSuccess([mockConnection]) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('connections-list')).toBeInTheDocument();
    });

    // Open edit
    fireEvent.click(screen.getByTestId('edit-connection-conn-1'));
    expect(screen.getByTestId('connection-edit-form')).toBeInTheDocument();

    // Cancel edit
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('connection-edit-form')).not.toBeInTheDocument();
  });

  it('shows permission level in connection info', async () => {
    globalThis.fetch = mockFetchSuccess([mockConnection]) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('connections-list')).toBeInTheDocument();
    });

    expect(screen.getByText('Read Only')).toBeInTheDocument();
  });

  it('shows read_write permission level', async () => {
    globalThis.fetch = mockFetchSuccess([mockConnection2]) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('connections-list')).toBeInTheDocument();
    });

    expect(screen.getByText('Read & Write')).toBeInTheDocument();
  });

  it('shows delete confirmation dialog', async () => {
    globalThis.fetch = mockFetchSuccess([mockConnection]) as typeof globalThis.fetch;

    render(<ConnectedAccountsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('connections-list')).toBeInTheDocument();
    });

    const deleteBtn = screen.getByTestId('delete-connection-conn-1');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByText('Remove connection?')).toBeInTheDocument();
    });

    expect(screen.getByText(/permanently remove the Google connection/)).toBeInTheDocument();
  });
});
