import { useState, useEffect, useCallback } from 'react';
import { apiClient, ApiRequestError } from '@/ui/lib/api-client';
import type { UserSettings, SettingsUpdatePayload } from './types';

export type SettingsState = { kind: 'loading' } | { kind: 'error'; message: string; status?: number } | { kind: 'loaded'; data: UserSettings };

export function useSettings() {
  const [state, setState] = useState<SettingsState>({ kind: 'loading' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let alive = true;

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
        setState({ kind: 'loaded', data });
        return true;
      } catch {
        // Revert on error
        setState({ kind: 'loaded', data: previousData });
        return false;
      } finally {
        setIsSaving(false);
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
