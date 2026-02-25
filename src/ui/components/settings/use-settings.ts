import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, ApiRequestError } from '@/ui/lib/api-client';
import type { UserSettings, SettingsUpdatePayload } from './types';

export type SettingsState = { kind: 'loading' } | { kind: 'error'; message: string; status?: number } | { kind: 'loaded'; data: UserSettings };

export function useSettings() {
  const [state, setState] = useState<SettingsState>({ kind: 'loading' });
  const [isSaving, setIsSaving] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    let alive = true;
    mountedRef.current = true;

    async function fetchSettings(): Promise<void> {
      try {
        const data = await apiClient.get<UserSettings>('/api/settings');
        if (!alive) return;
        setState({ kind: 'loaded', data });
      } catch (error) {
        if (!alive) return;
        const status = error instanceof ApiRequestError ? error.status : undefined;
        setState({
          kind: 'error',
          message: status === 401 ? 'Please sign in to view settings' : `Failed to load settings${status ? `: ${status}` : ''}`,
          status,
        });
      }
    }

    fetchSettings();
    return () => {
      alive = false;
      mountedRef.current = false;
    };
  }, []);

  const updateSettings = useCallback(
    async (updates: SettingsUpdatePayload): Promise<boolean> => {
      if (state.kind !== 'loaded') return false;

      // Optimistic update
      const previousData = state.data;
      setState({
        kind: 'loaded',
        data: { ...previousData, ...updates, updated_at: new Date().toISOString() },
      });
      setIsSaving(true);

      try {
        const data = await apiClient.patch<UserSettings>('/api/settings', updates);
        if (!mountedRef.current) return true;
        setState({ kind: 'loaded', data });
        return true;
      } catch {
        if (!mountedRef.current) return false;
        // Revert on error
        setState({ kind: 'loaded', data: previousData });
        return false;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [state],
  );

  return {
    state,
    isSaving,
    updateSettings,
  };
}
