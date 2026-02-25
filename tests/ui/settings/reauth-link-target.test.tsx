/**
 * Tests for issue #1739: OAuth re-authorization link must open in new tab.
 *
 * The `<a>` tag has `rel="noopener noreferrer"` but is missing `target="_blank"`,
 * which means clicking "Save & Authorize" navigates away from the settings page
 * and the user loses their unsaved state.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent, cleanup } from '@testing-library/react';
import { ConnectionManagePanel } from '@/ui/components/settings/connection-manage-panel';
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
  ],
  expires_at: '2026-03-01T00:00:00Z',
  label: 'Work Gmail',
  provider_account_id: '12345',
  provider_account_email: 'work@gmail.com',
  permission_level: 'read',
  enabled_features: ['contacts'],
  is_active: true,
  last_sync_at: '2026-02-10T12:00:00Z',
  sync_status: {
    contacts: { last_sync_at: '2026-02-10T12:00:00Z', status: 'idle' },
  },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-10T12:00:00Z',
};

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function createFetchMock(patchResponse: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (opts?.method === 'PATCH' && typeof url === 'string' && url.includes('/api/oauth/connections/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(patchResponse),
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
// Tests
// ---------------------------------------------------------------------------

describe('Re-auth link target="_blank" (#1739)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    cleanup();
  });

  it('re-auth link has target="_blank" attribute', async () => {
    const patchResponse = {
      connection: { ...mockConnection, enabled_features: ['contacts', 'files'] as OAuthFeature[] },
      reAuthRequired: true,
      reAuthUrl: 'https://accounts.google.com/o/oauth2/auth?scope=drive.readonly',
      missingScopes: ['https://www.googleapis.com/auth/drive.readonly'],
    };
    globalThis.fetch = createFetchMock(patchResponse) as typeof globalThis.fetch;

    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    // Toggle files feature to trigger re-auth
    const filesToggle = screen.getByTestId('feature-toggle-files');
    fireEvent.click(within(filesToggle).getByRole('switch'));

    // Wait for re-auth button to appear
    await waitFor(() => {
      expect(screen.getByTestId('reauth-button')).toBeInTheDocument();
    });

    // Get the anchor element inside the reauth button
    const reauthContainer = screen.getByTestId('reauth-button');
    const anchor = reauthContainer.querySelector('a');

    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute('target')).toBe('_blank');
    expect(anchor!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('re-auth link has all three security attributes together', async () => {
    const patchResponse = {
      connection: { ...mockConnection, enabled_features: ['contacts', 'files'] as OAuthFeature[] },
      reAuthRequired: true,
      reAuthUrl: 'https://accounts.google.com/o/oauth2/auth?scope=drive.readonly',
    };
    globalThis.fetch = createFetchMock(patchResponse) as typeof globalThis.fetch;

    render(
      <ConnectionManagePanel
        connection={mockConnection}
        open={true}
        onOpenChange={vi.fn()}
        onConnectionUpdated={vi.fn()}
      />,
    );

    // Toggle files feature to trigger re-auth
    const filesToggle = screen.getByTestId('feature-toggle-files');
    fireEvent.click(within(filesToggle).getByRole('switch'));

    await waitFor(() => {
      expect(screen.getByTestId('reauth-button')).toBeInTheDocument();
    });

    const anchor = screen.getByTestId('reauth-button').querySelector('a');
    expect(anchor).not.toBeNull();

    // Must have all three: target, rel with noopener, rel with noreferrer
    expect(anchor!.getAttribute('target')).toBe('_blank');
    expect(anchor!.getAttribute('rel')).toContain('noopener');
    expect(anchor!.getAttribute('rel')).toContain('noreferrer');
  });
});
