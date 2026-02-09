import { useState, useEffect, useCallback } from 'react';
import type { EmbeddingSettings, EmbeddingBudgetUpdate, EmbeddingTestResult } from './types';

export type EmbeddingSettingsState = { kind: 'loading' } | { kind: 'error'; message: string; status?: number } | { kind: 'loaded'; data: EmbeddingSettings };

export function useEmbeddingSettings() {
  const [state, setState] = useState<EmbeddingSettingsState>({ kind: 'loading' });
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<EmbeddingTestResult | null>(null);

  useEffect(() => {
    let alive = true;

    async function fetchSettings(): Promise<void> {
      try {
        const res = await fetch('/api/settings/embeddings');
        if (!res.ok) {
          if (!alive) return;
          setState({
            kind: 'error',
            message: res.status === 401 ? 'Please sign in to view embedding settings' : `Failed to load embedding settings: ${res.status}`,
            status: res.status,
          });
          return;
        }
        const data = (await res.json()) as EmbeddingSettings;
        if (!alive) return;
        setState({ kind: 'loaded', data });
      } catch (error) {
        if (!alive) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Failed to load embedding settings',
        });
      }
    }

    fetchSettings();
    return () => {
      alive = false;
    };
  }, []);

  const updateBudget = useCallback(
    async (updates: EmbeddingBudgetUpdate): Promise<boolean> => {
      if (state.kind !== 'loaded') return false;

      const previousData = state.data;
      setState({
        kind: 'loaded',
        data: {
          ...previousData,
          budget: { ...previousData.budget, ...updates },
        },
      });
      setIsSaving(true);

      try {
        const res = await fetch('/api/settings/embeddings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });

        if (!res.ok) {
          setState({ kind: 'loaded', data: previousData });
          return false;
        }

        const data = (await res.json()) as EmbeddingSettings;
        setState({ kind: 'loaded', data });
        return true;
      } catch {
        setState({ kind: 'loaded', data: previousData });
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [state],
  );

  const testConnection = useCallback(async (): Promise<EmbeddingTestResult | null> => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/settings/embeddings/test', {
        method: 'POST',
      });

      if (!res.ok) {
        const result: EmbeddingTestResult = {
          success: false,
          provider: null,
          error: `Request failed: ${res.status}`,
        };
        setTestResult(result);
        return result;
      }

      const result = (await res.json()) as EmbeddingTestResult;
      setTestResult(result);
      return result;
    } catch (error) {
      const result: EmbeddingTestResult = {
        success: false,
        provider: null,
        error: error instanceof Error ? error.message : 'Connection test failed',
      };
      setTestResult(result);
      return result;
    } finally {
      setIsTesting(false);
    }
  }, []);

  const clearTestResult = useCallback(() => {
    setTestResult(null);
  }, []);

  return {
    state,
    isSaving,
    isTesting,
    testResult,
    updateBudget,
    testConnection,
    clearTestResult,
  };
}
