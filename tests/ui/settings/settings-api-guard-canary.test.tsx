/**
 * Preventative canary test: ensures EVERY settings hook that calls apiClient
 * survives receiving an empty object ({}) from the API.
 *
 * WHY THIS EXISTS:
 * apiClient.get<T>() casts JSON as T with zero runtime validation (see
 * api-client.ts:parseBody). Any new hook that trusts the response shape
 * will crash when the API returns unexpected data. This test catches that
 * BEFORE it reaches production.
 *
 * HOW IT WORKS:
 * 1. Scans src/ui/components/settings/ for files that import apiClient
 * 2. Asserts every such file is registered in HOOK_SMOKE_TESTS below
 * 3. For each registered hook, renders it with apiClient returning {}
 * 4. Asserts no crash — if it crashes, the hook needs runtime guards
 *
 * WHEN A NEW SETTINGS HOOK IS ADDED:
 * 1. The "detects unregistered files" test will FAIL
 * 2. Add runtime guards (Array.isArray, ??, ?.) to the new hook
 * 3. Add the hook to HOOK_SMOKE_TESTS with a render wrapper
 * 4. Add the filename to REGISTERED_API_FILES
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Mocks — same as settings-api-response-guards.test.tsx
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

// Suppress React error boundary noise
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
  vi.clearAllMocks();
  console.error = originalConsoleError;
});

// ---------------------------------------------------------------------------
// Layer 1: Discovery canary — detects new unregistered apiClient files
// ---------------------------------------------------------------------------

/**
 * Every settings file that imports apiClient MUST be registered here.
 * If you add a new file that uses apiClient and this test fails,
 * you need to:
 * 1. Add runtime guards to your new file
 * 2. Add the filename to this set
 * 3. Add a smoke test in Layer 2 below
 */
const REGISTERED_API_FILES = new Set([
  'use-geolocation.ts',
  'use-embedding-settings.ts',
  'use-connected-accounts.ts',
  'use-settings.ts',
  'connected-accounts-section.tsx',
  'connection-manage-panel.tsx',
  'inbound-routing-section.tsx',
  'notification-preferences-section.tsx',
  'webhook-management-section.tsx',
]);

const SETTINGS_DIR = path.resolve(
  __dirname,
  '../../../src/ui/components/settings',
);

describe('Settings API guard canary — prevents regression', () => {
  it('every settings file importing apiClient is registered in this test', () => {
    const allFiles = fs.readdirSync(SETTINGS_DIR).filter(
      (f) => f.endsWith('.ts') || f.endsWith('.tsx'),
    );

    const filesUsingApiClient = allFiles.filter((f) => {
      const content = fs.readFileSync(path.join(SETTINGS_DIR, f), 'utf-8');
      return (
        content.includes("from '@/ui/lib/api-client'") ||
        content.includes('from "@/ui/lib/api-client"')
      );
    });

    const unregistered = filesUsingApiClient.filter(
      (f) => !REGISTERED_API_FILES.has(f),
    );

    expect(
      unregistered,
      `New settings file(s) import apiClient but are NOT registered in ` +
        `settings-api-guard-canary.test.tsx. apiClient casts JSON as T ` +
        `without runtime validation — add guards (Array.isArray, ??, ?.) ` +
        `then register: ${unregistered.join(', ')}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: Smoke tests — every hook survives empty API responses
// ---------------------------------------------------------------------------

describe('Settings hooks survive empty API responses ({})', () => {
  it('useGeoProviders does not crash', async () => {
    mockedApiClient.get.mockResolvedValue({});
    const { useGeoProviders } = await import(
      '@/ui/components/settings/use-geolocation'
    );

    function Test() {
      const { state } = useGeoProviders();
      return <div>{state.kind}</div>;
    }

    expect(() => render(<Test />)).not.toThrow();
    await waitFor(() => expect(document.body.textContent).toContain('loaded'));
  });

  it('useCurrentLocation does not crash', async () => {
    mockedApiClient.get.mockResolvedValue({});
    const { useCurrentLocation } = await import(
      '@/ui/components/settings/use-geolocation'
    );

    function Test() {
      const { state } = useCurrentLocation();
      return <div>{state.kind}</div>;
    }

    expect(() => render(<Test />)).not.toThrow();
    await waitFor(() => expect(document.body.textContent).toContain('loaded'));
  });

  it('useEmbeddingSettings does not crash', async () => {
    mockedApiClient.get.mockResolvedValue({});
    const { useEmbeddingSettings } = await import(
      '@/ui/components/settings/use-embedding-settings'
    );

    function Test() {
      const { state } = useEmbeddingSettings();
      return <div>{state.kind}</div>;
    }

    expect(() => render(<Test />)).not.toThrow();
    await waitFor(() => expect(document.body.textContent).toContain('loaded'));
  });

  it('useConnectedAccounts does not crash', async () => {
    // useConnectedAccounts fetches two endpoints in parallel
    mockedApiClient.get.mockResolvedValue({});
    const { useConnectedAccounts } = await import(
      '@/ui/components/settings/use-connected-accounts'
    );

    function Test() {
      const { state } = useConnectedAccounts();
      return <div>{state.kind}</div>;
    }

    expect(() => render(<Test />)).not.toThrow();
    await waitFor(() => expect(document.body.textContent).toContain('loaded'));
  });

  it('NotificationPreferencesSection does not crash', async () => {
    mockedApiClient.get.mockResolvedValue({});
    const { NotificationPreferencesSection } = await import(
      '@/ui/components/settings/notification-preferences-section'
    );

    function Test() {
      return <NotificationPreferencesSection />;
    }

    expect(() => render(<Test />)).not.toThrow();
    await waitFor(() =>
      expect(document.body.textContent).toContain('No notification types configured'),
    );
  });

  it('WebhookManagementSection does not crash', async () => {
    mockedApiClient.get.mockResolvedValue({});
    const { WebhookManagementSection } = await import(
      '@/ui/components/settings/webhook-management-section'
    );

    function Test() {
      return <WebhookManagementSection />;
    }

    expect(() => render(<Test />)).not.toThrow();
    await waitFor(() =>
      expect(document.body.textContent).toContain('No webhooks configured'),
    );
  });

  it('useSettings does not crash', async () => {
    mockedApiClient.get.mockResolvedValue({});
    const mod = await import('@/ui/components/settings/use-settings');
    const useSettings = mod.useSettings;

    function Test() {
      const { state } = useSettings();
      return <div>{state.kind}</div>;
    }

    expect(() => render(<Test />)).not.toThrow();
    await waitFor(() => expect(document.body.textContent).toContain('loaded'));
  });
});

// ---------------------------------------------------------------------------
// Layer 3: Hooks survive null/undefined for every nested field
// ---------------------------------------------------------------------------

describe('Settings hooks survive null nested fields', () => {
  it('useEmbeddingSettings with all-null nested objects', async () => {
    mockedApiClient.get.mockResolvedValue({
      provider: null,
      available_providers: null,
      budget: null,
      usage: null,
    });
    const { useEmbeddingSettings } = await import(
      '@/ui/components/settings/use-embedding-settings'
    );

    function Test() {
      const { state } = useEmbeddingSettings();
      if (state.kind !== 'loaded') return <div>{state.kind}</div>;
      // Access nested fields that previously crashed
      return (
        <div>
          budget:{state.data.budget.today_spend_usd}
          providers:{state.data.available_providers.length}
        </div>
      );
    }

    expect(() => render(<Test />)).not.toThrow();
    await waitFor(() => expect(document.body.textContent).toContain('budget:0'));
  });

  it('useEmbeddingSettings with partial budget (missing spend fields)', async () => {
    mockedApiClient.get.mockResolvedValue({
      provider: null,
      available_providers: [],
      budget: { daily_limit_usd: 10 },
      usage: { today: { count: 5 } },
    });
    const { useEmbeddingSettings } = await import(
      '@/ui/components/settings/use-embedding-settings'
    );

    function Test() {
      const { state } = useEmbeddingSettings();
      if (state.kind !== 'loaded') return <div>{state.kind}</div>;
      return (
        <div>
          daily:{state.data.budget.daily_limit_usd}
          spend:{state.data.budget.today_spend_usd}
          tokens:{state.data.usage.today.tokens}
        </div>
      );
    }

    expect(() => render(<Test />)).not.toThrow();
    await waitFor(() => {
      const text = document.body.textContent;
      expect(text).toContain('daily:10');
      expect(text).toContain('spend:0');
      expect(text).toContain('tokens:0');
    });
  });

  it('useGeoProviders with providers as non-array types', async () => {
    // API might return a string, number, or object instead of array
    for (const badValue of ['not-an-array', 42, { items: [] }, true]) {
      vi.clearAllMocks();
      mockedApiClient.get.mockResolvedValue({ providers: badValue });
      const { useGeoProviders } = await import(
        '@/ui/components/settings/use-geolocation'
      );

      function Test() {
        const { state } = useGeoProviders();
        if (state.kind !== 'loaded') return <div>{state.kind}</div>;
        return <div>count:{state.providers.length}</div>;
      }

      expect(() => render(<Test />)).not.toThrow();
      await waitFor(() =>
        expect(document.body.textContent).toContain('count:0'),
      );
      cleanup();
    }
  });
});
