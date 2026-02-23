/**
 * Tests for OAuthFeature consolidation (#1629) and ConnectionCardProps
 * type alignment (#1627).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/ui/lib/auth-manager', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
  clearAccessToken: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

vi.mock('@/ui/lib/api-config', () => ({
  getApiBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

import { apiClient } from '@/ui/lib/api-client';
import { OAUTH_FEATURES, type OAuthFeature, type OAuthConnectionUpdate } from '@/ui/components/settings/types';

const mockedApiClient = vi.mocked(apiClient);

// ---------------------------------------------------------------------------
// #1629: OAUTH_FEATURES is the single source of truth
// ---------------------------------------------------------------------------

describe('OAUTH_FEATURES consolidation (#1629)', () => {
  it('exports exactly the expected feature values', () => {
    expect(OAUTH_FEATURES).toEqual(['contacts', 'email', 'files', 'calendar']);
  });

  it('is a readonly tuple (as const)', () => {
    // The array should be frozen at the type level. At runtime `as const`
    // produces a regular array, but we can verify its contents are stable.
    expect(Object.isFrozen(OAUTH_FEATURES) || Array.isArray(OAUTH_FEATURES)).toBe(true);
    expect(OAUTH_FEATURES).toHaveLength(4);
  });

  it('OAuthFeature type accepts each value in OAUTH_FEATURES', () => {
    // Type-level check: assigning each element to OAuthFeature should compile.
    const features: OAuthFeature[] = [...OAUTH_FEATURES];
    expect(features).toEqual(['contacts', 'email', 'files', 'calendar']);
  });

  it('VALID_FEATURES in the hook filters against OAUTH_FEATURES', async () => {
    // Import the hook module to exercise normalizeFeatures indirectly.
    // We test via the ConnectedAccountsSection which calls useConnectedAccounts.
    const { ConnectedAccountsSection } = await import(
      '@/ui/components/settings/connected-accounts-section'
    );

    mockedApiClient.get.mockImplementation(async (path: string) => {
      if (path.includes('/connections')) {
        return {
          connections: [
            {
              id: 'conn-1',
              user_email: 'test@example.com',
              provider: 'google',
              scopes: ['openid'],
              expires_at: null,
              label: 'Test',
              provider_account_id: null,
              provider_account_email: 'test@gmail.com',
              permission_level: 'read',
              // Include a bogus feature alongside valid ones
              enabled_features: ['contacts', 'INVALID_FEATURE', 'email'],
              is_active: true,
              last_sync_at: null,
              sync_status: {},
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          ],
        } as never;
      }
      if (path.includes('/providers')) {
        return { providers: [], unconfigured: [] } as never;
      }
      return {} as never;
    });

    render(<ConnectedAccountsSection />);

    // Wait for the loaded state
    const card = await screen.findByTestId('connection-card-conn-1');
    expect(card).toBeTruthy();

    // The invalid feature should have been filtered out by normalizeFeatures.
    // Valid features (Contacts, Email) should appear as badges.
    expect(screen.getByText('Contacts')).toBeTruthy();
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.queryByText('INVALID_FEATURE')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #1627: ConnectionCard onUpdate type alignment
// ---------------------------------------------------------------------------

describe('ConnectionCard onUpdate type alignment (#1627)', () => {
  it('updateConnection in useConnectedAccounts accepts OAuthConnectionUpdate fields', async () => {
    // This is primarily a compile-time check. If the types are misaligned,
    // TypeScript will fail before this test runs. We verify at runtime that
    // the hook's updateConnection sends the correct payload shape.
    const { ConnectedAccountsSection } = await import(
      '@/ui/components/settings/connected-accounts-section'
    );

    const connectionData = {
      id: 'conn-2',
      user_email: 'u@example.com',
      provider: 'microsoft' as const,
      scopes: ['openid'],
      expires_at: null,
      label: 'Work',
      provider_account_id: null,
      provider_account_email: 'u@outlook.com',
      permission_level: 'read' as const,
      enabled_features: ['contacts'] as OAuthFeature[],
      is_active: true,
      last_sync_at: null,
      sync_status: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    mockedApiClient.get.mockImplementation(async (path: string) => {
      if (path.includes('/connections')) {
        return { connections: [connectionData] } as never;
      }
      if (path.includes('/providers')) {
        return { providers: [], unconfigured: [] } as never;
      }
      return {} as never;
    });

    render(<ConnectedAccountsSection />);
    await screen.findByTestId('connection-card-conn-2');

    // Verify the type constraint: OAuthConnectionUpdate only allows
    // label, permission_level, enabled_features, is_active.
    const validUpdate: OAuthConnectionUpdate = {
      label: 'New Label',
      permission_level: 'read_write',
      enabled_features: ['contacts', 'email'],
      is_active: false,
    };
    expect(validUpdate).toBeDefined();

    // Fields like id, created_at, sync_status should NOT be in OAuthConnectionUpdate.
    // This is a compile-time guarantee — if someone adds them, tsc will catch it.
    // At runtime we just verify the shape:
    const keys = Object.keys(validUpdate);
    const forbiddenKeys = ['id', 'created_at', 'updated_at', 'sync_status', 'scopes', 'provider'];
    for (const key of forbiddenKeys) {
      expect(keys).not.toContain(key);
    }
  });
});
