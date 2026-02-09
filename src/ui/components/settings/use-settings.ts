import { useState, useEffect, useCallback } from 'react';
import type { UserSettings, SettingsUpdatePayload } from './types';

export type SettingsState = { kind: 'loading' } | { kind: 'error'; message: string; status?: number } | { kind: 'loaded'; data: UserSettings };

export function useSettings() {
  const [state, setState] = useState<SettingsState>({ kind: 'loading' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let alive = true;

    async function fetchSettings(): Promise<void> {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) {
          if (!alive) return;
          setState({
            kind: 'error',
            message: res.status === 401 ? 'Please sign in to view settings' : `Failed to load settings: ${res.status}`,
            status: res.status,
          });
          return;
        }
        const data = (await res.json()) as UserSettings;
        if (!alive) return;
        setState({ kind: 'loaded', data });
      } catch (error) {
        if (!alive) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Failed to load settings',
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
        const res = await fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });

        if (!res.ok) {
          // Revert on failure
          setState({ kind: 'loaded', data: previousData });
          return false;
        }

        const data = (await res.json()) as UserSettings;
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
