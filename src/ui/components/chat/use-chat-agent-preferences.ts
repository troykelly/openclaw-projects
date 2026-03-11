/**
 * Chat agent preferences hook (Issues #2423, #2424, #2425).
 *
 * Derives default agent selection and visibility filtering from
 * useSettings() + useAvailableAgents(). Single source of truth
 * for all chat agent preferences.
 *
 * Priority chain for default agent:
 * 1. User's saved default_agent_id (from user_setting)
 * 2. Gateway is_default flag
 * 3. First visible agent
 */
import { useMemo } from 'react';
import { useSettings } from '@/ui/components/settings/use-settings';
import { useAvailableAgents } from '@/ui/hooks/queries/use-chat';
import type { ChatAgent } from '@/ui/lib/api-types';
import type { SettingsUpdatePayload } from '@/ui/components/settings/types';

interface UseChatAgentPreferencesReturn {
  /** The user's saved default agent ID, or null. */
  defaultAgentId: string | null;
  /** The user's visible agent IDs, or null (all visible). */
  visibleAgentIds: string[] | null;
  /** All agents from the gateway. */
  allAgents: ChatAgent[];
  /** Agents filtered by visibility preference. */
  visibleAgents: ChatAgent[];
  /** Resolved default agent (priority: user setting → gateway default → first visible). */
  resolvedDefaultAgent: ChatAgent | null;
  /** Whether settings are loading. */
  isLoading: boolean;
  /** Error message, or null. */
  error: string | null;
  /** Whether a settings save is in progress. */
  isSaving: boolean;
  /** Update settings (from useSettings). */
  updateSettings: (updates: SettingsUpdatePayload) => Promise<boolean>;
}

export function useChatAgentPreferences(): UseChatAgentPreferencesReturn {
  const { state, isSaving, updateSettings } = useSettings();
  const { data: agentsData } = useAvailableAgents();

  const isLoading = state.kind === 'loading';
  const error = state.kind === 'error' ? state.message : null;
  const settings = state.kind === 'loaded' ? state.data : null;

  const defaultAgentId = settings?.default_agent_id ?? null;
  const visibleAgentIds = settings?.visible_agent_ids ?? null;

  const allAgents: ChatAgent[] = useMemo(
    () => (Array.isArray(agentsData?.agents) ? agentsData.agents : []),
    [agentsData?.agents],
  );

  const visibleAgents: ChatAgent[] = useMemo(() => {
    if (visibleAgentIds === null) return allAgents;
    return allAgents.filter((a) => visibleAgentIds.includes(a.id));
  }, [allAgents, visibleAgentIds]);

  const resolvedDefaultAgent: ChatAgent | null = useMemo(() => {
    if (visibleAgents.length === 0) return null;
    // Priority 1: user's saved default
    if (defaultAgentId) {
      const byUser = visibleAgents.find((a) => a.id === defaultAgentId);
      if (byUser) return byUser;
    }
    // Priority 2: gateway is_default
    const byGateway = visibleAgents.find((a) => a.is_default);
    if (byGateway) return byGateway;
    // Priority 3: first visible
    return visibleAgents[0] ?? null;
  }, [visibleAgents, defaultAgentId]);

  return {
    defaultAgentId,
    visibleAgentIds,
    allAgents,
    visibleAgents,
    resolvedDefaultAgent,
    isLoading,
    error,
    isSaving,
    updateSettings,
  };
}
