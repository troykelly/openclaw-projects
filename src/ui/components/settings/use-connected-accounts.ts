import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/ui/lib/api-client';
import type {
  OAuthConnectionSummary,
  OAuthConnectionUpdate,
  OAuthProviderInfo,
} from './types';

export type ConnectionsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; connections: OAuthConnectionSummary[]; providers: OAuthProviderInfo[] };

export function useConnectedAccounts() {
  const [state, setState] = useState<ConnectionsState>({ kind: 'loading' });
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    const [connectionsRes, providersRes] = await Promise.all([
      apiClient.get<{ connections: OAuthConnectionSummary[] }>('/api/oauth/connections', { signal }),
      apiClient.get<{ providers: OAuthProviderInfo[]; unconfigured: OAuthProviderInfo[] }>('/api/oauth/providers', { signal }),
    ]);

    return {
      connections: Array.isArray(connectionsRes?.connections) ? connectionsRes.connections : [],
      providers: [
        ...(Array.isArray(providersRes?.providers) ? providersRes.providers : []),
        ...(Array.isArray(providersRes?.unconfigured) ? providersRes.unconfigured : []),
      ],
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    fetchData(controller.signal)
      .then((data) => {
        if (!alive) return;
        setState({ kind: 'loaded', ...data });
      })
      .catch((error) => {
        if (!alive) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Failed to load connected accounts',
        });
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [fetchData]);

  const updateConnection = useCallback(
    async (id: string, updates: OAuthConnectionUpdate): Promise<boolean> => {
      if (state.kind !== 'loaded') return false;
      setIsUpdating(true);

      try {
        const res = await apiClient.patch<{ connection: OAuthConnectionSummary }>(
          `/api/oauth/connections/${id}`,
          updates,
        );

        setState((prev) => {
          if (prev.kind !== 'loaded') return prev;
          return {
            ...prev,
            connections: prev.connections.map((c) =>
              c.id === id ? res.connection : c,
            ),
          };
        });

        return true;
      } catch {
        return false;
      } finally {
        setIsUpdating(false);
      }
    },
    [state.kind],
  );

  const deleteConnection = useCallback(
    async (id: string): Promise<boolean> => {
      if (state.kind !== 'loaded') return false;
      setIsUpdating(true);

      try {
        await apiClient.delete(`/api/oauth/connections/${id}`);

        setState((prev) => {
          if (prev.kind !== 'loaded') return prev;
          return {
            ...prev,
            connections: prev.connections.filter((c) => c.id !== id),
          };
        });

        return true;
      } catch {
        return false;
      } finally {
        setIsUpdating(false);
      }
    },
    [state.kind],
  );

  const refresh = useCallback(async () => {
    try {
      const data = await fetchData();
      setState({ kind: 'loaded', ...data });
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to refresh connected accounts',
      });
    }
  }, [fetchData]);

  return {
    state,
    isUpdating,
    updateConnection,
    deleteConnection,
    refresh,
  };
}
