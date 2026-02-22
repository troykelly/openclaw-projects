/**
 * Tests that settings components handle undefined/null arrays gracefully
 * instead of crashing with "Cannot read properties of undefined (reading 'length')".
 *
 * Covers #1591.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock apiClient before importing components that use it
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock auth-manager (needed by api-client internals)
vi.mock('@/ui/lib/auth-manager', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
  clearAccessToken: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

// Mock api-config
vi.mock('@/ui/lib/api-config', () => ({
  getApiBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

import { apiClient } from '@/ui/lib/api-client';
import { ConnectedAccountsSection } from '@/ui/components/settings/connected-accounts-section';
import { SyncStatusDisplay } from '@/ui/components/settings/sync-status-display';
import type { OAuthFeature } from '@/ui/components/settings/types';

const mockedApiClient = vi.mocked(apiClient);

// ---------------------------------------------------------------------------
// Tests: useConnectedAccounts fetchData guard
// ---------------------------------------------------------------------------

describe('ConnectedAccountsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crash when API returns undefined connections/providers', async () => {
    // Simulate API returning objects without the expected array fields
    mockedApiClient.get.mockImplementation(async (path: string) => {
      if (path.includes('/connections')) {
        // Missing `connections` field entirely
        return {} as never;
      }
      if (path.includes('/providers')) {
        // Missing `providers` and `unconfigured` fields
        return {} as never;
      }
      return {} as never;
    });

    // Should NOT throw "Cannot read properties of undefined (reading 'length')"
    expect(() => render(<ConnectedAccountsSection />)).not.toThrow();

    // Initially shows loading state
    expect(screen.getByText('Loading connected accounts...')).toBeTruthy();
  });

  it('renders without crash when API returns null for array fields', async () => {
    mockedApiClient.get.mockImplementation(async (path: string) => {
      if (path.includes('/connections')) {
        return { connections: null } as never;
      }
      if (path.includes('/providers')) {
        return { providers: null, unconfigured: null } as never;
      }
      return {} as never;
    });

    expect(() => render(<ConnectedAccountsSection />)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests: SyncStatusDisplay guard for undefined enabled_features
// ---------------------------------------------------------------------------

describe('SyncStatusDisplay', () => {
  it('returns null when enabled_features is undefined', () => {
    const { container } = render(
      <SyncStatusDisplay
        enabled_features={undefined as unknown as OAuthFeature[]}
        sync_status={{}}
        onSyncNow={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('returns null when enabled_features is an empty array', () => {
    const { container } = render(
      <SyncStatusDisplay
        enabled_features={[]}
        sync_status={{}}
        onSyncNow={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders sync status for valid features', () => {
    render(
      <SyncStatusDisplay
        enabled_features={['contacts']}
        sync_status={{}}
        onSyncNow={vi.fn()}
      />,
    );
    expect(screen.getByText('Contacts')).toBeTruthy();
  });
});
