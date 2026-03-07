/**
 * Hook to poll the gateway WebSocket connection status (Epic #2153, Issue #2159).
 *
 * Polls GET /api/gateway/status every 30 seconds and returns whether the
 * API server's WebSocket connection to the OpenClaw gateway is healthy.
 * Re-polls immediately when the browser tab becomes visible (handled
 * automatically by TanStack Query's refetchOnWindowFocus).
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';

interface GatewayStatusResponse {
  connected?: boolean;
  connected_at?: string | null;
  last_tick_at?: string | null;
}

export interface GatewayStatus {
  connected: boolean;
  loading: boolean;
  error: boolean;
}

export function useGatewayStatus(): GatewayStatus {
  const query = useQuery({
    queryKey: ['gateway', 'status'],
    queryFn: () => apiClient.get<GatewayStatusResponse>('/gateway/status'),
    refetchInterval: 30_000,
    retry: false,
  });

  return {
    connected: query.data?.connected === true,
    loading: query.isLoading,
    error: query.isError,
  };
}
