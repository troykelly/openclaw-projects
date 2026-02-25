/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useCurrentLocation,
  useGeoMutations,
} from '@/ui/components/settings/use-geolocation';

// Mock apiClient
vi.mock('@/ui/lib/api-client', () => {
  class MockApiRequestError extends Error {
    status: number;
    details?: unknown;
    constructor(status: number, message: string, details?: unknown) {
      super(message);
      this.name = 'ApiRequestError';
      this.status = status;
      this.details = details;
    }
  }

  return {
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    ApiRequestError: MockApiRequestError,
  };
});

import { apiClient, ApiRequestError } from '@/ui/lib/api-client';

const mockedGet = vi.mocked(apiClient.get);
const mockedPost = vi.mocked(apiClient.post);

/** Helper to create an ApiRequestError (uses the mocked class). */
function apiError(status: number, message: string): ApiRequestError {
  return new ApiRequestError(status, message);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Task 4: useCurrentLocation — 404 handling (#1801)
// ---------------------------------------------------------------------------

describe('useCurrentLocation', () => {
  it('returns loaded state with null location when API returns data', async () => {
    mockedGet.mockResolvedValue({ location: null });

    const { result } = renderHook(() => useCurrentLocation());

    await waitFor(() => {
      expect(result.current.state.kind).toBe('loaded');
    });

    expect(result.current.state).toEqual({ kind: 'loaded', location: null });
  });

  it('returns loaded state with location data', async () => {
    const mockLocation = {
      lat: -33.8688,
      lng: 151.2093,
      accuracyM: 10,
      address: '123 Test St',
      place_label: 'Sydney',
      time: '2026-02-25T00:00:00Z',
      providerId: 'prov-1',
      entity_id: null,
    };
    mockedGet.mockResolvedValue({ location: mockLocation });

    const { result } = renderHook(() => useCurrentLocation());

    await waitFor(() => {
      expect(result.current.state.kind).toBe('loaded');
    });

    expect(result.current.state).toEqual({ kind: 'loaded', location: mockLocation });
  });

  it('treats 404 as empty state (no data), not as error', async () => {
    mockedGet.mockRejectedValue(apiError(404, 'Not found'));

    const { result } = renderHook(() => useCurrentLocation());

    await waitFor(() => {
      expect(result.current.state.kind).not.toBe('loading');
    });

    // 404 should show as loaded with null location, NOT as error
    expect(result.current.state.kind).toBe('loaded');
    expect(result.current.state).toEqual({ kind: 'loaded', location: null });
  });

  it('shows error state for non-404 errors (e.g. 500)', async () => {
    mockedGet.mockRejectedValue(apiError(500, 'Internal Server Error'));

    const { result } = renderHook(() => useCurrentLocation());

    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });

    expect(result.current.state).toEqual({
      kind: 'error',
      message: 'Internal Server Error',
    });
  });

  it('shows generic error for non-Error rejections', async () => {
    mockedGet.mockRejectedValue('network failure');

    const { result } = renderHook(() => useCurrentLocation());

    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });

    expect(result.current.state).toEqual({
      kind: 'error',
      message: 'Failed to load current location',
    });
  });
});

// ---------------------------------------------------------------------------
// Task 6: useGeoMutations — auth_type in createProvider (#1805)
// ---------------------------------------------------------------------------

describe('useGeoMutations — createProvider includes auth_type', () => {
  it('sends auth_type=access_token for home_assistant provider', async () => {
    mockedPost.mockResolvedValueOnce({
      provider: { id: 'p1', providerType: 'home_assistant', authType: 'access_token' },
    });

    const { result } = renderHook(() => useGeoMutations());

    await act(async () => {
      await result.current.createProvider({
        providerType: 'home_assistant',
        label: 'My HA',
        config: { url: 'http://ha.local:8123', access_token: 'tok' },
      });
    });

    expect(mockedPost).toHaveBeenCalledWith(
      '/api/geolocation/providers',
      expect.objectContaining({
        providerType: 'home_assistant',
        authType: 'access_token',
        label: 'My HA',
      }),
    );
  });

  it('sends auth_type=mqtt_credentials for mqtt provider', async () => {
    mockedPost.mockResolvedValueOnce({
      provider: { id: 'p2', providerType: 'mqtt', authType: 'mqtt_credentials' },
    });

    const { result } = renderHook(() => useGeoMutations());

    await act(async () => {
      await result.current.createProvider({
        providerType: 'mqtt',
        label: 'MQTT Broker',
        config: { host: 'mqtt.example.com', port: 1883 },
      });
    });

    expect(mockedPost).toHaveBeenCalledWith(
      '/api/geolocation/providers',
      expect.objectContaining({
        providerType: 'mqtt',
        authType: 'mqtt_credentials',
      }),
    );
  });

  it('sends auth_type=webhook_token for webhook provider', async () => {
    mockedPost.mockResolvedValueOnce({
      provider: { id: 'p3', providerType: 'webhook', authType: 'webhook_token' },
    });

    const { result } = renderHook(() => useGeoMutations());

    await act(async () => {
      await result.current.createProvider({
        providerType: 'webhook',
        label: 'My Webhook',
        config: {},
      });
    });

    expect(mockedPost).toHaveBeenCalledWith(
      '/api/geolocation/providers',
      expect.objectContaining({
        providerType: 'webhook',
        authType: 'webhook_token',
      }),
    );
  });
});
