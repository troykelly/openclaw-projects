/**
 * Hook for managing the default chat agent preference (Issue #1957).
 *
 * Reads default_agent_id from GET /api/settings and provides a mutation
 * to update it via PATCH /api/settings. Uses optimistic updates with
 * rollback on failure.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '@/ui/lib/api-client';

interface SettingsWithAgent {
  default_agent_id: string | null;
  [key: string]: unknown;
}

interface UseDefaultAgentReturn {
  /** The current default agent ID, or null if none set. */
  defaultAgentId: string | null;
  /** Whether the initial fetch is in progress. */
  isLoading: boolean;
  /** Error message from fetch, or null. */
  error: string | null;
  /** Whether a save is in progress. */
  isSaving: boolean;
  /** Update the default agent (null to clear). */
  setDefaultAgent: (agentId: string | null) => Promise<boolean>;
}

export function useDefaultAgent(): UseDefaultAgentReturn {
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    let alive = true;
    mountedRef.current = true;

    async function fetch() {
      try {
        const data = await apiClient.get<SettingsWithAgent>('/api/settings');
        if (!alive) return;
        setDefaultAgentId(data.default_agent_id);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        if (alive) setIsLoading(false);
      }
    }

    fetch();
    return () => {
      alive = false;
      mountedRef.current = false;
    };
  }, []);

  const setDefaultAgent = useCallback(
    async (agentId: string | null): Promise<boolean> => {
      const previous = defaultAgentId;
      setDefaultAgentId(agentId);
      setIsSaving(true);

      try {
        const data = await apiClient.patch<SettingsWithAgent>('/api/settings', {
          default_agent_id: agentId,
        });
        if (!mountedRef.current) return true;
        setDefaultAgentId(data.default_agent_id);
        return true;
      } catch {
        if (!mountedRef.current) return false;
        setDefaultAgentId(previous);
        return false;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [defaultAgentId],
  );

  return {
    defaultAgentId,
    isLoading,
    error,
    isSaving,
    setDefaultAgent,
  };
}
