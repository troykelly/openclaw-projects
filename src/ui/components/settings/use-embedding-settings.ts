import { useState, useEffect, useCallback } from 'react';
import { apiClient, ApiRequestError } from '@/ui/lib/api-client';
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
        const raw = await apiClient.get<EmbeddingSettings>('/api/settings/embeddings');
        if (!alive) return;
        // Validate nested objects — apiClient casts JSON as T without runtime checks
        const data: EmbeddingSettings = {
          provider: raw?.provider ?? null,
          available_providers: Array.isArray(raw?.available_providers) ? raw.available_providers : [],
          budget: {
            daily_limit_usd: raw?.budget?.daily_limit_usd ?? 0,
            monthly_limit_usd: raw?.budget?.monthly_limit_usd ?? 0,
            today_spend_usd: raw?.budget?.today_spend_usd ?? 0,
            month_spend_usd: raw?.budget?.month_spend_usd ?? 0,
            pause_on_limit: raw?.budget?.pause_on_limit ?? false,
          },
          usage: {
            today: { count: raw?.usage?.today?.count ?? 0, tokens: raw?.usage?.today?.tokens ?? 0 },
            month: { count: raw?.usage?.month?.count ?? 0, tokens: raw?.usage?.month?.tokens ?? 0 },
            total: { count: raw?.usage?.total?.count ?? 0, tokens: raw?.usage?.total?.tokens ?? 0 },
          },
        };
        setState({ kind: 'loaded', data });
      } catch (error) {
        if (!alive) return;
        const status = error instanceof ApiRequestError ? error.status : undefined;
        setState({
          kind: 'error',
          message: status === 401 ? 'Please sign in to view embedding settings' : `Failed to load embedding settings${status ? `: ${status}` : ''}`,
          status,
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
        const data = await apiClient.patch<EmbeddingSettings>('/api/settings/embeddings', updates);
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
      const result = await apiClient.post<EmbeddingTestResult>('/api/settings/embeddings/test', {});
      setTestResult(result);
      return result;
    } catch (error) {
      const result: EmbeddingTestResult = {
        success: false,
        provider: null,
        error: error instanceof ApiRequestError ? `Request failed: ${error.status}` : error instanceof Error ? error.message : 'Connection test failed',
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
