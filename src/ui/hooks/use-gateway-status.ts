/**
 * Hook to poll the gateway WebSocket connection status (Epic #2153, Issue #2159).
 *
 * Polls GET /api/gateway/status every 30 seconds and returns whether the
 * API server's WebSocket connection to the OpenClaw gateway is healthy.
 * Re-polls immediately when the browser tab becomes visible.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiBaseUrl } from '@/ui/lib/api-config';

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
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/gateway/status`);
      if (!mountedRef.current) return;
      if (!res.ok) {
        setStatus({ connected: false, loading: false, error: true });
        return;
      }
      const data: { connected?: boolean } = await res.json();
      if (!mountedRef.current) return;
      setStatus({
        connected: data.connected === true,
        loading: false,
        error: false,
      });
    } catch {
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
