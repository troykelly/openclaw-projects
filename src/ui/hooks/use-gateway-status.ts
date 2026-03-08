/**
 * Hook to poll the gateway WebSocket connection status (Epic #2153, Issue #2159).
 *
 * Polls GET /gateway/status every 30 seconds and returns whether the
 * API server's WebSocket connection to the OpenClaw gateway is healthy.
 * Re-polls immediately when the browser tab becomes visible.
 *
 * Uses apiClient for automatic auth header injection (#2262).
 * Errors are handled passively (no redirect) since this is background polling.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '@/ui/lib/api-client';

const POLL_INTERVAL_MS = 30_000;

export interface GatewayStatus {
  connected: boolean;
  loading: boolean;
  error: boolean;
}

export function useGatewayStatus(): GatewayStatus {
  const [status, setStatus] = useState<GatewayStatus>({
    connected: false,
    loading: true,
    error: false,
  });
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiClient.get<{ connected?: boolean }>('/gateway/status');
      if (!mountedRef.current) return;
      setStatus({
        connected: data.connected === true,
        loading: false,
        error: false,
      });
    } catch {
      // Passive error handling — no redirect for background polling.
      // apiClient may throw ApiRequestError on 401/5xx; we treat all
      // failures as a transient connectivity issue and retry next poll.
      if (!mountedRef.current) return;
      setStatus({ connected: false, loading: false, error: true });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch
    void fetchStatus();

    // Set up polling interval
    const intervalId = setInterval(() => {
      void fetchStatus();
    }, POLL_INTERVAL_MS);

    // Re-poll on tab visibility change
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchStatus();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchStatus]);

  return status;
}
