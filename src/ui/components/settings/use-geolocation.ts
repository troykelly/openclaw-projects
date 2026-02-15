/**
 * Hooks for geolocation provider management and current location display.
 *
 * Provides data fetching, polling, and mutation helpers for the
 * /api/geolocation/* endpoints used by the Location settings section.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '@/ui/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GeoProviderType = 'home_assistant' | 'mqtt' | 'webhook';
export type GeoProviderStatus = 'active' | 'error' | 'disconnected' | 'pending';

export interface GeoProvider {
  id: string;
  ownerEmail: string;
  providerType: GeoProviderType;
  authType: string;
  label: string;
  status: GeoProviderStatus;
  statusMessage: string | null;
  config: Record<string, unknown>;
  credentials: string | null;
  pollIntervalSeconds: number | null;
  maxAgeSeconds: number;
  isShared: boolean;
  lastSeenAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeoLocation {
  lat: number;
  lng: number;
  accuracyM: number | null;
  address: string | null;
  placeLabel: string | null;
  time: string;
  providerId: string;
  entityId: string | null;
}

export interface VerifyResult {
  success: boolean;
  message: string;
  entities: Array<{ id: string; name: string; type?: string }>;
}

/** Shape returned by POST /api/geolocation/providers on creation. */
interface CreateProviderResponse {
  provider: GeoProvider;
}

/** Shape returned by GET /api/geolocation/providers. */
interface ProvidersListResponse {
  providers: GeoProvider[];
}

/** Shape returned by GET /api/geolocation/current. */
interface CurrentLocationResponse {
  location: GeoLocation | null;
}

/** Shape returned by POST /api/geolocation/providers/:id/verify. */
interface VerifyProviderResponse {
  result: VerifyResult;
}

// ---------------------------------------------------------------------------
// Provider state
// ---------------------------------------------------------------------------

export type GeoProvidersState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; providers: GeoProvider[] };

/**
 * Fetch and manage geolocation providers.
 *
 * @returns providers state, loading/error states, and a refetch function.
 */
export function useGeoProviders() {
  const [state, setState] = useState<GeoProvidersState>({ kind: 'loading' });

  const fetchProviders = useCallback(async (signal?: AbortSignal) => {
    const res = await apiClient.get<ProvidersListResponse>(
      '/api/geolocation/providers',
      { signal },
    );
    return res.providers;
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    fetchProviders(controller.signal)
      .then((providers) => {
        if (!alive) return;
        setState({ kind: 'loaded', providers });
      })
      .catch((error) => {
        if (!alive) return;
        setState({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to load geolocation providers',
        });
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [fetchProviders]);

  const refetch = useCallback(async () => {
    try {
      const providers = await fetchProviders();
      setState({ kind: 'loaded', providers });
    } catch (error) {
      setState({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to refresh providers',
      });
    }
  }, [fetchProviders]);

  return { state, refetch };
}

// ---------------------------------------------------------------------------
// Current location with polling
// ---------------------------------------------------------------------------

export type CurrentLocationState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; location: GeoLocation | null };

/** Polling interval for current location in milliseconds. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Fetch the current location with automatic 30-second polling.
 *
 * @returns current location state with loading/error handling.
 */
export function useCurrentLocation() {
  const [state, setState] = useState<CurrentLocationState>({ kind: 'loading' });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLocation = useCallback(async (signal?: AbortSignal) => {
    const res = await apiClient.get<CurrentLocationResponse>(
      '/api/geolocation/current',
      { signal },
    );
    return res.location;
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    /** Fetch once and update state. */
    async function poll() {
      try {
        const location = await fetchLocation(controller.signal);
        if (!alive) return;
        setState({ kind: 'loaded', location });
      } catch (error) {
        if (!alive) return;
        // Only set error on initial load; subsequent poll failures are silent
        setState((prev) => {
          if (prev.kind === 'loading') {
            return {
              kind: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'Failed to load current location',
            };
          }
          return prev;
        });
      }
    }

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      alive = false;
      controller.abort();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchLocation]);

  return { state };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Payload accepted by POST /api/geolocation/providers. */
export interface CreateProviderPayload {
  providerType: GeoProviderType;
  label: string;
  config: Record<string, unknown>;
}

/**
 * Mutation helpers for geolocation provider CRUD and verification.
 *
 * @returns create, delete, and verify functions alongside submitting state.
 */
export function useGeoMutations() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createProvider = useCallback(
    async (payload: CreateProviderPayload): Promise<GeoProvider> => {
      setIsSubmitting(true);
      try {
        const res = await apiClient.post<CreateProviderResponse>(
          '/api/geolocation/providers',
          payload,
        );
        return res.provider;
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

  const deleteProvider = useCallback(async (id: string): Promise<boolean> => {
    setIsSubmitting(true);
    try {
      await apiClient.delete(`/api/geolocation/providers/${id}`);
      return true;
    } catch {
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const verifyProvider = useCallback(
    async (id: string): Promise<VerifyResult> => {
      setIsSubmitting(true);
      try {
        const res = await apiClient.post<VerifyProviderResponse>(
          `/api/geolocation/providers/${id}/verify`,
          {},
        );
        return res.result;
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

  return { createProvider, deleteProvider, verifyProvider, isSubmitting };
}
