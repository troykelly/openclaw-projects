/**
 * @vitest-environment jsdom
 *
 * Tests for the Connection Management Panel (issue #1053).
 * Covers: ConnectionManagePanel, FeatureToggle, PermissionLevelSelector,
 * SyncStatusDisplay — the permission & scope configuration UI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { ConnectionManagePanel } from '@/ui/components/settings/connection-manage-panel';
import { FeatureToggle } from '@/ui/components/settings/feature-toggle';
import { PermissionLevelSelector } from '@/ui/components/settings/permission-level-selector';
import { SyncStatusDisplay } from '@/ui/components/settings/sync-status-display';
import type { OAuthConnectionSummary, OAuthFeature } from '@/ui/components/settings/types';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockConnection: OAuthConnectionSummary = {
  id: 'conn-1',
  user_email: 'user@example.com',
  provider: 'google',
  scopes: [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
  ],
  expires_at: '2026-03-01T00:00:00Z',
  label: 'Work Gmail',
  provider_account_id: '12345',
  provider_account_email: 'work@gmail.com',
  permission_level: 'read',
  enabled_features: ['contacts', 'email'],
  is_active: true,
  last_sync_at: '2026-02-10T12:00:00Z',
  sync_status: {
    contacts: { last_sync_at: '2026-02-10T12:00:00Z', status: 'idle' },
    email: { last_sync_at: '2026-02-09T08:00:00Z', status: 'idle' },
  },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-10T12:00:00Z',
};

const mockMicrosoftConnection: OAuthConnectionSummary = {
  id: 'conn-2',
  user_email: 'user@example.com',
  provider: 'microsoft',
  scopes: [
    'https://graph.microsoft.com/User.Read',
    'offline_access',
    'https://graph.microsoft.com/Mail.Read',
  ],
  expires_at: null,
  label: 'Personal Outlook',
  provider_account_id: '67890',
  provider_account_email: 'me@outlook.com',
  permission_level: 'read',
  enabled_features: ['email'],
  is_active: true,
  last_sync_at: null,
  sync_status: {},
  created_at: '2026-02-05T00:00:00Z',
  updated_at: '2026-02-05T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function createFetchMock(overrides?: {
  patchResponse?: Record<string, unknown>;
  postSyncResponse?: Record<string, unknown>;
}) {
  return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (opts?.method === 'PATCH' && typeof url === 'string' && url.includes('/api/oauth/connections/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides?.patchResponse ?? {
          connection: mockConnection,
        }),
      });
    }
    if (opts?.method === 'POST' && typeof url === 'string' && url.includes('/api/sync/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides?.postSyncResponse ?? {
          status: 'completed',
          synced: 5,
        }),
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

// ---------------------------------------------------------------------------
// FeatureToggle tests
// ---------------------------------------------------------------------------

describe('FeatureToggle', () => {
  it('renders feature name and description', () => {
    render(
      <FeatureToggle
        feature="contacts"
        enabled={false}
        currentScopes={[]}
        provider="google"
        permission_level="read"
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText('Contacts')).toBeInTheDocument();
    expect(screen.getByText('Access your contacts and address book')).toBeInTheDocument();
  });

  it('shows enabled state', () => {
    render(
      <FeatureToggle
        feature="contacts"
        enabled={true}
        currentScopes={['https://www.googleapis.com/auth/contacts.readonly']}
        provider="google"
        permission_level="read"
        onToggle={vi.fn()}
      />,
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();
  });

  it('shows disabled state', () => {
    render(
      <FeatureToggle
        feature="contacts"
        enabled={false}
        currentScopes={[]}
        provider="google"
        permission_level="read"
        onToggle={vi.fn()}
      />,
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).not.toBeChecked();
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(
      <FeatureToggle
        feature="contacts"
        enabled={false}
        currentScopes={[]}
        provider="google"
        permission_level="read"
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledWith('contacts', true);
  });

  it('shows re-auth notice when enabling requires new scopes', () => {
    render(
      <FeatureToggle
        feature="files"
        enabled={false}
        currentScopes={['https://www.googleapis.com/auth/contacts.readonly']}
        provider="google"
        permission_level="read"
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByTestId('scope-upgrade-notice-files')).toBeInTheDocument();
    expect(screen.getByText(/redirect you to Google/i)).toBeInTheDocument();
  });

  it('does not show re-auth notice when scopes already granted', () => {
    render(
      <FeatureToggle
        feature="contacts"
        enabled={true}
        currentScopes={['https://www.googleapis.com/auth/contacts.readonly']}
        provider="google"
        permission_level="read"
        onToggle={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('scope-upgrade-notice-contacts')).not.toBeInTheDocument();
  });

  it('renders all four feature types', () => {
    const features: OAuthFeature[] = ['contacts', 'email', 'files', 'calendar'];
    const descriptions = [
      'Access your contacts and address book',
      'Read and optionally send email',
      'Browse your files and documents',
      'View and optionally manage calendar events',
    ];

    features.forEach((feature, i) => {
      const { unmount } = render(
        <FeatureToggle
          feature={feature}
          enabled={false}
          currentScopes={[]}
          provider="google"
          permission_level="read"
          onToggle={vi.fn()}
        />,
      );

      expect(screen.getByText(descriptions[i])).toBeInTheDocument();
      unmount();
    });
  });

  it('shows Microsoft-specific re-auth notice', () => {
    render(
      <FeatureToggle
        feature="calendar"
        enabled={false}
        currentScopes={['https://graph.microsoft.com/User.Read', 'offline_access']}
        provider="microsoft"
        permission_level="read"
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText(/redirect you to Microsoft/i)).toBeInTheDocument();
  });

  it('is disabled when isDisabled prop is true', () => {
    render(
      <FeatureToggle
        feature="contacts"
        enabled={true}
        currentScopes={[]}
        provider="google"
        permission_level="read"
        onToggle={vi.fn()}
        isDisabled={true}
      />,
    );

    expect(screen.getByRole('switch')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// PermissionLevelSelector tests
// ---------------------------------------------------------------------------

describe('PermissionLevelSelector', () => {
  it('renders with read selected', () => {
    render(
      <PermissionLevelSelector
        value="read"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('permission-level-selector')).toBeInTheDocument();
    const readOption = screen.getByTestId('permission-option-read');
    expect(readOption).toHaveAttribute('data-selected', 'true');
  });

  it('renders with read_write selected', () => {
    render(
      <PermissionLevelSelector
        value="read_write"
        onChange={vi.fn()}
      />,
    );

    const writeOption = screen.getByTestId('permission-option-read_write');
    expect(writeOption).toHaveAttribute('data-selected', 'true');
  });

  it('calls onChange when clicking read_write', () => {
    const onChange = vi.fn();
    render(
      <PermissionLevelSelector
        value="read"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId('permission-option-read_write'));
    expect(onChange).toHaveBeenCalledWith('read_write');
  });

  it('calls onChange when clicking read', () => {
    const onChange = vi.fn();
    render(
      <PermissionLevelSelector
        value="read_write"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId('permission-option-read'));
    expect(onChange).toHaveBeenCalledWith('read');
  });

  it('shows upgrade warning when on read_write', () => {
    render(
      <PermissionLevelSelector
        value="read_write"
        onChange={vi.fn()}
        enabled_features={['contacts', 'email']}
      />,
    );

    expect(screen.getByTestId('write-access-warning')).toBeInTheDocument();
    expect(screen.getByText(/grant OpenClaw write access/i)).toBeInTheDocument();
  });

  it('does not show write warning when on read', () => {
    render(
      <PermissionLevelSelector
        value="read"
        onChange={vi.fn()}
        enabled_features={['contacts']}
      />,
    );

    expect(screen.queryByTestId('write-access-warning')).not.toBeInTheDocument();
  });

  it('is disabled when isDisabled prop is true', () => {
    render(
      <PermissionLevelSelector
        value="read"
        onChange={vi.fn()}
        isDisabled={true}
      />,
    );

    expect(screen.getByTestId('permission-option-read_write')).toHaveAttribute('aria-disabled', 'true');
  });
});

// ---------------------------------------------------------------------------
// SyncStatusDisplay tests
// ---------------------------------------------------------------------------

describe('SyncStatusDisplay', () => {
  it('renders sync status for enabled features', () => {
    render(
      <SyncStatusDisplay
        enabled_features={['contacts', 'email']}
        sync_status={{
          contacts: { last_sync_at: '2026-02-10T12:00:00Z', status: 'idle' },
          email: { last_sync_at: '2026-02-09T08:00:00Z', status: 'idle' },
        }}
        onSyncNow={vi.fn()}
      />,
    );

    expect(screen.getByTestId('sync-status-contacts')).toBeInTheDocument();
    expect(screen.getByTestId('sync-status-email')).toBeInTheDocument();
  });

  it('shows "Never synced" when last_sync_at is null', () => {
    render(
      <SyncStatusDisplay
        enabled_features={['contacts']}
        sync_status={{}}
        onSyncNow={vi.fn()}
      />,
    );

    expect(screen.getByText('Never synced')).toBeInTheDocument();
  });

  it('shows sync now button for each feature', () => {
    render(
      <SyncStatusDisplay
        enabled_features={['contacts', 'email']}
        sync_status={{
          contacts: { last_sync_at: '2026-02-10T12:00:00Z', status: 'idle' },
          email: { last_sync_at: null, status: 'idle' },
        }}
        onSyncNow={vi.fn()}
      />,
    );

    const syncButtons = screen.getAllByText('Sync Now');
    expect(syncButtons).toHaveLength(2);
  });

  it('calls onSyncNow when sync button is clicked', () => {
    const onSyncNow = vi.fn();
    render(
      <SyncStatusDisplay
        enabled_features={['contacts']}
        sync_status={{
          contacts: { last_sync_at: '2026-02-10T12:00:00Z', status: 'idle' },
        }}
        onSyncNow={onSyncNow}
      />,
    );

    fireEvent.click(screen.getByText('Sync Now'));
    expect(onSyncNow).toHaveBeenCalledWith('contacts');
  });

  it('shows syncing indicator when status is syncing', () => {
    render(
      <SyncStatusDisplay
        enabled_features={['contacts']}
        sync_status={{
          contacts: { last_sync_at: '2026-02-10T12:00:00Z', status: 'syncing' },
        }}
        onSyncNow={vi.fn()}
      />,
    );

    expect(screen.getByTestId('sync-progress-contacts')).toBeInTheDocument();
    expect(screen.getByText('Syncing...')).toBeInTheDocument();
  });

  it('disables sync button while syncing', () => {
    render(
      <SyncStatusDisplay
        enabled_features={['contacts']}
        sync_status={{
          contacts: { last_sync_at: '2026-02-10T12:00:00Z', status: 'syncing' },
        }}
        onSyncNow={vi.fn()}
      />,
    );

    const syncButton = screen.getByTestId('sync-btn-contacts');
    expect(syncButton).toBeDisabled();
  });

  it('shows nothing when no features enabled', () => {
    const { container } = render(
      <SyncStatusDisplay
        enabled_features={[]}
        sync_status={{}}
        onSyncNow={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-testid^="sync-status-"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ConnectionManagePanel integration tests
// ---------------------------------------------------------------------------

describe('ConnectionManagePanel', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders connection details', () => {
    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText('Manage Connection')).toBeInTheDocument();
    expect(screen.getByText('work@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
  });

  it('shows editable label', () => {
    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    const labelInput = screen.getByDisplayValue('Work Gmail');
    expect(labelInput).toBeInTheDocument();
  });

  it('shows active status toggle', () => {
    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId('active-toggle');
    expect(toggle).toBeInTheDocument();
  });

  it('shows permission level selector', () => {
    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    expect(screen.getByTestId('permission-level-selector')).toBeInTheDocument();
  });

  it('shows feature toggles for all four features', () => {
    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    expect(screen.getByTestId('feature-toggle-contacts')).toBeInTheDocument();
    expect(screen.getByTestId('feature-toggle-email')).toBeInTheDocument();
    expect(screen.getByTestId('feature-toggle-files')).toBeInTheDocument();
    expect(screen.getByTestId('feature-toggle-calendar')).toBeInTheDocument();
  });

  it('shows sync status section', () => {
    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    expect(screen.getByTestId('sync-status-section')).toBeInTheDocument();
  });

  it('saves label change optimistically', async () => {
    const updatedConn = { ...mockConnection, label: 'New Label' };
    globalThis.fetch = createFetchMock({
      patchResponse: { connection: updatedConn },
    }) as typeof globalThis.fetch;

    const onConnectionUpdated = vi.fn();
    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={onConnectionUpdated}
      />,
    );

    const labelInput = screen.getByDisplayValue('Work Gmail');
    fireEvent.change(labelInput, { target: { value: 'New Label' } });
    fireEvent.blur(labelInput);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/oauth/connections/conn-1'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  it('saves active status toggle optimistically', async () => {
    const updatedConn = { ...mockConnection, is_active: false };
    globalThis.fetch = createFetchMock({
      patchResponse: { connection: updatedConn },
    }) as typeof globalThis.fetch;

    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    const switchEl = screen.getByTestId('active-toggle');
    fireEvent.click(switchEl);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/oauth/connections/conn-1'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  it('shows re-auth button when scope upgrade is needed', async () => {
    const patchResponse = {
      connection: { ...mockConnection, enabled_features: ['contacts', 'email', 'files'] },
      reAuthRequired: true,
      reAuthUrl: 'https://accounts.google.com/o/oauth2/auth?scope=...',
      missingScopes: ['https://www.googleapis.com/auth/drive.readonly'],
    };
    globalThis.fetch = createFetchMock({ patchResponse }) as typeof globalThis.fetch;

    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    // Toggle files feature on
    const filesToggle = screen.getByTestId('feature-toggle-files');
    fireEvent.click(within(filesToggle).getByRole('switch'));

    await waitFor(() => {
      expect(screen.getByTestId('reauth-button')).toBeInTheDocument();
    });

    expect(screen.getByText(/Save & Authorize/i)).toBeInTheDocument();
  });

  it('shows re-auth button for valid Microsoft reAuthUrl', async () => {
    const patchResponse = {
      connection: { ...mockMicrosoftConnection, enabled_features: ['email', 'calendar'] },
      reAuthRequired: true,
      reAuthUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?scope=openid',
    };
    globalThis.fetch = createFetchMock({ patchResponse }) as typeof globalThis.fetch;

    render(
      <ConnectionManagePanel
        connection={mockMicrosoftConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    const calendarToggle = screen.getByTestId('feature-toggle-calendar');
    fireEvent.click(within(calendarToggle).getByRole('switch'));

    await waitFor(() => {
      expect(screen.getByTestId('reauth-button')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // reAuthUrl validation: blocks dangerous/off-domain URLs (issue #1619)
  // ---------------------------------------------------------------------------

  it('does not show re-auth button for javascript: reAuthUrl', async () => {
    const patchResponse = {
      connection: { ...mockConnection, enabled_features: ['contacts', 'email', 'files'] },
      reAuthRequired: true,
      reAuthUrl: 'javascript:alert(document.cookie)',
    };
    globalThis.fetch = createFetchMock({ patchResponse }) as typeof globalThis.fetch;

    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    const filesToggle = screen.getByTestId('feature-toggle-files');
    fireEvent.click(within(filesToggle).getByRole('switch'));

    await waitFor(() => {
      // Button must NOT appear
      expect(screen.queryByTestId('reauth-button')).not.toBeInTheDocument();
    });

    // Error notice must appear instead
    expect(screen.getByTestId('reauth-url-error')).toBeInTheDocument();
  });

  it('does not show re-auth button for http: reAuthUrl', async () => {
    const patchResponse = {
      connection: { ...mockConnection, enabled_features: ['contacts', 'email', 'files'] },
      reAuthRequired: true,
      reAuthUrl: 'http://accounts.google.com/o/oauth2/auth',
    };
    globalThis.fetch = createFetchMock({ patchResponse }) as typeof globalThis.fetch;

    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    const filesToggle = screen.getByTestId('feature-toggle-files');
    fireEvent.click(within(filesToggle).getByRole('switch'));

    await waitFor(() => {
      expect(screen.queryByTestId('reauth-button')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('reauth-url-error')).toBeInTheDocument();
  });

  it('does not show re-auth button for off-domain reAuthUrl', async () => {
    const patchResponse = {
      connection: { ...mockConnection, enabled_features: ['contacts', 'email', 'files'] },
      reAuthRequired: true,
      reAuthUrl: 'https://evil.example.com/steal?token=abc',
    };
    globalThis.fetch = createFetchMock({ patchResponse }) as typeof globalThis.fetch;

    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    const filesToggle = screen.getByTestId('feature-toggle-files');
    fireEvent.click(within(filesToggle).getByRole('switch'));

    await waitFor(() => {
      expect(screen.queryByTestId('reauth-button')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('reauth-url-error')).toBeInTheDocument();
  });

  it('does not show re-auth button for data: reAuthUrl', async () => {
    const patchResponse = {
      connection: { ...mockConnection, enabled_features: ['contacts', 'email', 'files'] },
      reAuthRequired: true,
      reAuthUrl: 'data:text/html,<script>alert(1)</script>',
    };
    globalThis.fetch = createFetchMock({ patchResponse }) as typeof globalThis.fetch;

    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    const filesToggle = screen.getByTestId('feature-toggle-files');
    fireEvent.click(within(filesToggle).getByRole('switch'));

    await waitFor(() => {
      expect(screen.queryByTestId('reauth-button')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('reauth-url-error')).toBeInTheDocument();
  });

  it('shows reauth-url-error when reAuthRequired=true but reAuthUrl is absent', async () => {
    const patchResponse = {
      connection: { ...mockConnection, enabled_features: ['contacts', 'email', 'files'] },
      reAuthRequired: true,
      // reAuthUrl intentionally omitted — backend contract violation
    };
    globalThis.fetch = createFetchMock({ patchResponse }) as typeof globalThis.fetch;

    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    const filesToggle = screen.getByTestId('feature-toggle-files');
    fireEvent.click(within(filesToggle).getByRole('switch'));

    await waitFor(() => {
      expect(screen.queryByTestId('reauth-button')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('reauth-url-error')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={false}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    expect(screen.queryByText('Manage Connection')).not.toBeInTheDocument();
  });

  it('shows Microsoft connection details', () => {
    render(
      <ConnectionManagePanel
        connection={mockMicrosoftConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText('me@outlook.com')).toBeInTheDocument();
    expect(screen.getByText('Microsoft')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // enabled_features guard: undefined / non-array truthy values (issue #1604)
  // ---------------------------------------------------------------------------

  it('does not crash when connection.enabled_features is undefined', () => {
    const conn = { ...mockConnection, enabled_features: undefined as unknown as OAuthConnectionSummary['enabled_features'] };

    expect(() =>
      render(
        <ConnectionManagePanel
          connection={conn}
          open={true}
          onOpenChange={vi.fn()}
          onConnectionUpdated={vi.fn()}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByText('Manage Connection')).toBeInTheDocument();
    expect(screen.getByText('Enable features above to see sync status')).toBeInTheDocument();
  });

  it('does not crash when connection.enabled_features is a string', () => {
    const conn = { ...mockConnection, enabled_features: 'contacts' as unknown as OAuthConnectionSummary['enabled_features'] };

    expect(() =>
      render(
        <ConnectionManagePanel
          connection={conn}
          open={true}
          onOpenChange={vi.fn()}
          onConnectionUpdated={vi.fn()}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByText('Manage Connection')).toBeInTheDocument();
    expect(screen.getByText('Enable features above to see sync status')).toBeInTheDocument();
  });

  it('does not crash when connection.enabled_features is an object', () => {
    const conn = { ...mockConnection, enabled_features: {} as unknown as OAuthConnectionSummary['enabled_features'] };

    expect(() =>
      render(
        <ConnectionManagePanel
          connection={conn}
          open={true}
          onOpenChange={vi.fn()}
          onConnectionUpdated={vi.fn()}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByText('Manage Connection')).toBeInTheDocument();
    expect(screen.getByText('Enable features above to see sync status')).toBeInTheDocument();
  });

  it('reverts to empty array on save error when enabled_features was undefined', async () => {
    const conn = { ...mockConnection, enabled_features: undefined as unknown as OAuthConnectionSummary['enabled_features'] };
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: () => Promise.resolve({ error: 'server error' }),
      }),
    ) as typeof globalThis.fetch;

    render(
      <ConnectionManagePanel
        connection={conn}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    // Toggle a feature — this triggers a save which will fail and revert
    const contactsToggle = screen.getByTestId('feature-toggle-contacts');
    fireEvent.click(within(contactsToggle).getByRole('switch'));

    // After error, component should still render without crashing
    await waitFor(() => {
      expect(screen.getByText('Manage Connection')).toBeInTheDocument();
    });
  });
});
