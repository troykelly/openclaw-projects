/**
 * Tests that ALL settings hooks and components handle malformed API responses
 * without crashing. Covers the systemic issue where apiClient.get<T>() casts
 * JSON as T without runtime validation.
 *
 * Covers #1700 (supersedes #1591, #1641).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiRequestError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
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

vi.mock('@/ui/lib/version', () => ({
  APP_VERSION: '0.0.0-test',
}));

import { apiClient } from '@/ui/lib/api-client';

const mockedApiClient = vi.mocked(apiClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Suppress React error boundary console noise. */
const originalConsoleError = console.error;
beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.error = (...args: any[]) => {
    const msg = String(args[0]);
    if (msg.includes('Error: Uncaught') || msg.includes('The above error')) return;
    originalConsoleError(...args);
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  console.error = originalConsoleError;
});

// ---------------------------------------------------------------------------
// 1. Geolocation providers — PRIMARY CRASH SITE
// ---------------------------------------------------------------------------

describe('useGeoProviders — malformed API responses (#1700)', () => {
  // Lazy import to ensure mocks are applied
  let useGeoProviders: typeof import('@/ui/components/settings/use-geolocation').useGeoProviders;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/ui/components/settings/use-geolocation');
    useGeoProviders = mod.useGeoProviders;
  });

  function TestComponent() {
    const { state } = useGeoProviders();
    if (state.kind === 'loading') return <div>loading</div>;
    if (state.kind === 'error') return <div>error: {state.message}</div>;
    return <div>providers: {state.providers.length}</div>;
  }

  it('does not crash when API returns empty object (missing providers field)', async () => {
    mockedApiClient.get.mockResolvedValueOnce({});

    expect(() => render(<TestComponent />)).not.toThrow();

    await waitFor(() => {
      expect(screen.getByText('providers: 0')).toBeInTheDocument();
    });
  });

  it('does not crash when API returns {providers: null}', async () => {
    mockedApiClient.get.mockResolvedValueOnce({ providers: null });

    expect(() => render(<TestComponent />)).not.toThrow();

    await waitFor(() => {
      expect(screen.getByText('providers: 0')).toBeInTheDocument();
    });
  });

  it('does not crash when API returns {providers: undefined}', async () => {
    mockedApiClient.get.mockResolvedValueOnce({ providers: undefined });

    expect(() => render(<TestComponent />)).not.toThrow();

    await waitFor(() => {
      expect(screen.getByText('providers: 0')).toBeInTheDocument();
    });
  });

  it('works normally when API returns valid providers array', async () => {
    mockedApiClient.get.mockResolvedValueOnce({
      providers: [{ id: '1', label: 'Test', providerType: 'webhook', status: 'active' }],
    });

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByText('providers: 1')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Current location — validate nested response
// ---------------------------------------------------------------------------

describe('useCurrentLocation — malformed API responses (#1700)', () => {
  let useCurrentLocation: typeof import('@/ui/components/settings/use-geolocation').useCurrentLocation;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/ui/components/settings/use-geolocation');
    useCurrentLocation = mod.useCurrentLocation;
  });

  function TestComponent() {
    const { state } = useCurrentLocation();
    if (state.kind === 'loading') return <div>loading</div>;
    if (state.kind === 'error') return <div>error</div>;
    return <div>location: {state.location ? 'yes' : 'none'}</div>;
  }

  it('does not crash when API returns empty object (missing location field)', async () => {
    mockedApiClient.get.mockResolvedValue({});

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByText('location: none')).toBeInTheDocument();
    });
  });

  it('does not crash when API returns {location: null}', async () => {
    mockedApiClient.get.mockResolvedValue({ location: null });

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByText('location: none')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Embedding settings — nested objects could be undefined
// ---------------------------------------------------------------------------

describe('useEmbeddingSettings — malformed API responses (#1700)', () => {
  let EmbeddingSettingsSection: typeof import('@/ui/components/settings/embedding-settings-section').EmbeddingSettingsSection;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/ui/components/settings/embedding-settings-section');
    EmbeddingSettingsSection = mod.EmbeddingSettingsSection;
  });

  it('does not crash when API returns empty object', async () => {
    mockedApiClient.get.mockResolvedValueOnce({});

    expect(() => render(<EmbeddingSettingsSection />)).not.toThrow();

    // Should show loading then either error or safe fallback
    await waitFor(() => {
      // Should not crash — either shows error or renders with defaults
      const card = screen.getByTestId('embedding-settings-card');
      expect(card).toBeInTheDocument();
    });
  });

  it('does not crash when API returns null for nested objects', async () => {
    mockedApiClient.get.mockResolvedValueOnce({
      provider: null,
      available_providers: null,
      budget: null,
      usage: null,
    });

    expect(() => render(<EmbeddingSettingsSection />)).not.toThrow();

    await waitFor(() => {
      const card = screen.getByTestId('embedding-settings-card');
      expect(card).toBeInTheDocument();
    });
  });

  it('does not crash when budget has missing spend fields', async () => {
    mockedApiClient.get.mockResolvedValueOnce({
      provider: null,
      available_providers: [],
      budget: { daily_limit_usd: 10, monthly_limit_usd: 100 },
      usage: { today: { count: 0, tokens: 0 }, month: { count: 0, tokens: 0 }, total: { count: 0, tokens: 0 } },
    });

    expect(() => render(<EmbeddingSettingsSection />)).not.toThrow();

    await waitFor(() => {
      const card = screen.getByTestId('embedding-settings-card');
      expect(card).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 4. FeatureToggle — connection.scopes could be null
// ---------------------------------------------------------------------------

describe('FeatureToggle — null scopes (#1700)', () => {
  let needsScopeUpgrade: typeof import('@/ui/components/settings/feature-toggle').needsScopeUpgrade;

  beforeEach(async () => {
    const mod = await import('@/ui/components/settings/feature-toggle');
    needsScopeUpgrade = mod.needsScopeUpgrade;
  });

  it('does not crash when currentScopes is null', () => {
    expect(() => {
      needsScopeUpgrade('contacts', 'google', 'read', null as unknown as string[]);
    }).not.toThrow();
  });

  it('does not crash when currentScopes is undefined', () => {
    expect(() => {
      needsScopeUpgrade('contacts', 'google', 'read', undefined as unknown as string[]);
    }).not.toThrow();
  });

  it('returns true (needs upgrade) when scopes is null', () => {
    const result = needsScopeUpgrade('contacts', 'google', 'read', null as unknown as string[]);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. SyncStatusDisplay — sync_status could be null
// ---------------------------------------------------------------------------

describe('SyncStatusDisplay — null sync_status (#1700)', () => {
  let SyncStatusDisplay: typeof import('@/ui/components/settings/sync-status-display').SyncStatusDisplay;

  beforeEach(async () => {
    const mod = await import('@/ui/components/settings/sync-status-display');
    SyncStatusDisplay = mod.SyncStatusDisplay;
  });

  it('does not crash when sync_status is null', () => {
    expect(() =>
      render(
        <SyncStatusDisplay
          enabled_features={['contacts']}
          sync_status={null as unknown as Record<string, undefined>}
          onSyncNow={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });

  it('does not crash when sync_status is undefined', () => {
    expect(() =>
      render(
        <SyncStatusDisplay
          enabled_features={['contacts']}
          sync_status={undefined as unknown as Record<string, undefined>}
          onSyncNow={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. ConnectionManagePanel — sync_status initialization
// ---------------------------------------------------------------------------

describe('ConnectionManagePanel — null sync_status init (#1700)', () => {
  let ConnectionManagePanel: typeof import('@/ui/components/settings/connection-manage-panel').ConnectionManagePanel;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/ui/components/settings/connection-manage-panel');
    ConnectionManagePanel = mod.ConnectionManagePanel;
  });

  const baseConnection = {
    id: 'conn-1',
    user_email: 'test@example.com',
    provider: 'google' as const,
    scopes: [],
    expires_at: null,
    label: 'Test',
    provider_account_id: null,
    provider_account_email: null,
    permission_level: 'read' as const,
    enabled_features: [] as const,
    is_active: true,
    last_sync_at: null,
    sync_status: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('does not crash when connection.sync_status is null', () => {
    expect(() =>
      render(
        <ConnectionManagePanel
          connection={{ ...baseConnection, sync_status: null as unknown as Record<string, unknown> }}
          open={true}
          onOpenChange={vi.fn()}
          onConnectionUpdated={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });

  it('does not crash when connection.scopes is null', () => {
    expect(() =>
      render(
        <ConnectionManagePanel
          connection={{ ...baseConnection, scopes: null as unknown as string[] }}
          open={true}
          onOpenChange={vi.fn()}
          onConnectionUpdated={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });
});
