/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock useSettings
const mockUseSettings = vi.fn();
vi.mock('@/ui/components/settings/use-settings', () => ({
  useSettings: () => mockUseSettings(),
}));

// Mock useAvailableAgents
const mockUseAvailableAgents = vi.fn();
vi.mock('@/ui/hooks/queries/use-chat', () => ({
  useAvailableAgents: () => mockUseAvailableAgents(),
}));

const AGENTS = [
  { id: 'troy', name: 'Troy', display_name: 'Troy Agent', avatar_url: null, is_default: false, status: 'online' as const },
  { id: 'arthouse', name: 'arthouse', display_name: 'Arthouse', avatar_url: null, is_default: true, status: 'online' as const },
  { id: 'helper', name: 'helper', display_name: 'Helper', avatar_url: null, is_default: false, status: 'offline' as const },
];

describe('useChatAgentPreferences', () => {
  let useChatAgentPreferences: typeof import('@/ui/components/chat/use-chat-agent-preferences').useChatAgentPreferences;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/ui/components/chat/use-chat-agent-preferences');
    useChatAgentPreferences = mod.useChatAgentPreferences;
  });

  function setup(opts: {
    settingsState?: 'loading' | 'error' | { default_agent_id: string | null; visible_agent_ids: string[] | null };
    agents?: typeof AGENTS;
  }) {
    const { settingsState = { default_agent_id: null, visible_agent_ids: null }, agents = AGENTS } = opts;

    if (settingsState === 'loading') {
      mockUseSettings.mockReturnValue({ state: { kind: 'loading' }, isSaving: false, updateSettings: vi.fn() });
    } else if (settingsState === 'error') {
      mockUseSettings.mockReturnValue({ state: { kind: 'error', message: 'fail' }, isSaving: false, updateSettings: vi.fn() });
    } else {
      mockUseSettings.mockReturnValue({
        state: { kind: 'loaded', data: { ...settingsState, id: '1', email: 'test@test.com', created_at: '', updated_at: '' } },
        isSaving: false,
        updateSettings: vi.fn().mockResolvedValue(true),
      });
    }

    mockUseAvailableAgents.mockReturnValue({ data: { agents } });
    return renderHook(() => useChatAgentPreferences());
  }

  it('returns loading state when settings loading', () => {
    const { result } = setup({ settingsState: 'loading' });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.visibleAgents).toEqual(AGENTS); // all agents visible when no settings
  });

  it('returns error state when settings error', () => {
    const { result } = setup({ settingsState: 'error' });
    expect(result.current.error).toBe('fail');
  });

  it('returns all agents when visible_agent_ids is null', () => {
    const { result } = setup({ settingsState: { default_agent_id: null, visible_agent_ids: null } });
    expect(result.current.visibleAgents).toHaveLength(3);
    expect(result.current.allAgents).toHaveLength(3);
  });

  it('filters agents by visible_agent_ids', () => {
    const { result } = setup({ settingsState: { default_agent_id: 'troy', visible_agent_ids: ['troy', 'helper'] } });
    expect(result.current.visibleAgents).toHaveLength(2);
    expect(result.current.visibleAgents.map(a => a.id)).toEqual(['troy', 'helper']);
  });

  it('uses user default_agent_id as first priority', () => {
    const { result } = setup({ settingsState: { default_agent_id: 'troy', visible_agent_ids: null } });
    expect(result.current.resolvedDefaultAgent?.id).toBe('troy');
  });

  it('falls back to gateway is_default when no user default', () => {
    const { result } = setup({ settingsState: { default_agent_id: null, visible_agent_ids: null } });
    expect(result.current.resolvedDefaultAgent?.id).toBe('arthouse'); // is_default: true
  });

  it('falls back to first visible agent when no defaults', () => {
    const agents = AGENTS.map(a => ({ ...a, is_default: false }));
    const { result } = setup({ settingsState: { default_agent_id: null, visible_agent_ids: null }, agents });
    expect(result.current.resolvedDefaultAgent?.id).toBe('troy');
  });

  it('ignores stale agent IDs in visible_agent_ids', () => {
    const { result } = setup({ settingsState: { default_agent_id: null, visible_agent_ids: ['troy', 'nonexistent'] } });
    expect(result.current.visibleAgents).toHaveLength(1);
    expect(result.current.visibleAgents[0].id).toBe('troy');
  });

  it('falls back when default_agent_id is stale', () => {
    const { result } = setup({ settingsState: { default_agent_id: 'deleted-agent', visible_agent_ids: null } });
    // Should fall back to gateway default (arthouse)
    expect(result.current.resolvedDefaultAgent?.id).toBe('arthouse');
  });

  it('returns null default when no visible agents', () => {
    const { result } = setup({ settingsState: { default_agent_id: null, visible_agent_ids: [] } });
    expect(result.current.visibleAgents).toHaveLength(0);
    expect(result.current.resolvedDefaultAgent).toBeNull();
  });

  it('returns empty arrays when agents data is undefined', () => {
    mockUseSettings.mockReturnValue({
      state: { kind: 'loaded', data: { default_agent_id: null, visible_agent_ids: null, id: '1', email: 'test@test.com', created_at: '', updated_at: '' } },
      isSaving: false,
      updateSettings: vi.fn(),
    });
    mockUseAvailableAgents.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useChatAgentPreferences());
    expect(result.current.allAgents).toEqual([]);
    expect(result.current.visibleAgents).toEqual([]);
  });

  it('exposes updateSettings from useSettings', () => {
    const mockUpdate = vi.fn().mockResolvedValue(true);
    mockUseSettings.mockReturnValue({
      state: { kind: 'loaded', data: { default_agent_id: null, visible_agent_ids: null, id: '1', email: 'test@test.com', created_at: '', updated_at: '' } },
      isSaving: false,
      updateSettings: mockUpdate,
    });
    mockUseAvailableAgents.mockReturnValue({ data: { agents: AGENTS } });
    const { result } = renderHook(() => useChatAgentPreferences());
    expect(result.current.updateSettings).toBe(mockUpdate);
  });
});
