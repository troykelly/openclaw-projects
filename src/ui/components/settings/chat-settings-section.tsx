/**
 * Chat settings section for the Settings page (Issues #1957, #2424).
 *
 * Provides a "Chat" section where users can:
 * - Select their default agent from the available agents list
 * - Toggle which agents are visible in the chat UI
 *
 * Uses useChatAgentPreferences as single source of truth.
 * Visibility checkboxes use 400ms debounced save to prevent race conditions.
 */
import * as React from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { AgentStatusBadge } from '@/ui/components/chat/agent-status-badge';
import type { AgentStatus } from '@/ui/components/chat/agent-status-badge';
import { useChatAgentPreferences } from '@/ui/components/chat/use-chat-agent-preferences';

export function ChatSettingsSection(): React.JSX.Element {
  const { defaultAgentId, visibleAgentIds, allAgents, isLoading, error, isSaving, updateSettings } = useChatAgentPreferences();

  // Debounced visibility save (400ms, one inflight at a time)
  const pendingVisRef = React.useRef<string[] | null>(null);
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = React.useRef(false);

  const flushVisibility = React.useCallback(async () => {
    if (pendingVisRef.current === null) return;
    if (inflightRef.current) return;
    inflightRef.current = true;
    const ids = pendingVisRef.current;
    pendingVisRef.current = null;
    try {
      await updateSettings({ visible_agent_ids: ids.length > 0 ? ids : null });
    } finally {
      inflightRef.current = false;
      if (pendingVisRef.current !== null) {
        flushVisibility();
      }
    }
  }, [updateSettings]);

  const handleVisibilityToggle = React.useCallback(
    (agentId: string, checked: boolean) => {
      const current = visibleAgentIds ?? allAgents.map((a) => a.id);
      const next = checked
        ? [...new Set([...current, agentId])]
        : current.filter((id) => id !== agentId);
      pendingVisRef.current = next;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        flushVisibility();
      }, 400);
    },
    [visibleAgentIds, allAgents, flushVisibility],
  );

  React.useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const handleAgentChange = React.useCallback(
    (value: string) => {
      updateSettings({ default_agent_id: value === 'none' ? null : value });
    },
    [updateSettings],
  );

  if (isLoading) {
    return (
      <Card data-testid="chat-settings-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="size-5 text-muted-foreground" />
            <CardTitle>Chat</CardTitle>
          </div>
          <CardDescription>Configure chat agent preferences</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="chat-settings-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="size-5 text-muted-foreground" />
            <CardTitle>Chat</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Failed to load chat settings</p>
        </CardContent>
      </Card>
    );
  }

  if (allAgents.length === 0) {
    return (
      <Card data-testid="chat-settings-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="size-5 text-muted-foreground" />
            <CardTitle>Chat</CardTitle>
          </div>
          <CardDescription>Configure chat agent preferences</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No agents available. Configure agents in your OpenClaw gateway to enable chat.</p>
        </CardContent>
      </Card>
    );
  }

  const selectedAgent = allAgents.find((a) => a.id === defaultAgentId);

  return (
    <Card data-testid="chat-settings-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageSquare className="size-5 text-muted-foreground" />
          <CardTitle>Chat</CardTitle>
          {isSaving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        <CardDescription>Configure chat agent preferences</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 divide-y">
        {/* Default Agent selector */}
        <div className="flex items-center justify-between gap-4 py-3">
          <div className="flex-1">
            <label htmlFor="default-agent" className="text-sm font-medium">
              Default Agent
            </label>
            <p className="text-sm text-muted-foreground">
              The agent used for new chat sessions
            </p>
          </div>
          <div className="shrink-0">
            <Select value={defaultAgentId ?? 'none'} onValueChange={handleAgentChange}>
              <SelectTrigger className="w-[200px]" id="default-agent" aria-label="Default agent">
                <SelectValue>
                  {selectedAgent ? (selectedAgent.display_name ?? selectedAgent.name) : 'None selected'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None selected</SelectItem>
                {allAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.display_name ?? agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Visible Agents checkboxes */}
        <div className="space-y-3 py-3">
          <div>
            <p className="text-sm font-medium">Visible Agents</p>
            <p className="text-sm text-muted-foreground">
              Choose which agents appear in your chat
            </p>
          </div>
          <div className="space-y-2">
            {allAgents.map((agent) => {
              const isDefault = agent.id === defaultAgentId;
              const isVisible = visibleAgentIds === null || visibleAgentIds.includes(agent.id);
              return (
                <label
                  key={agent.id}
                  className="flex items-center gap-3 rounded-sm px-2 py-1.5 hover:bg-accent"
                >
                  <Checkbox
                    checked={isVisible}
                    onCheckedChange={(checked) => handleVisibilityToggle(agent.id, checked === true)}
                    disabled={isDefault}
                    aria-label={`Show ${agent.display_name ?? agent.name} in chat`}
                  />
                  <span className="flex-1 text-sm">
                    {agent.display_name ?? agent.name}
                  </span>
                  <AgentStatusBadge status={(agent.status ?? 'unknown') as AgentStatus} />
                  {isDefault && (
                    <span className="text-xs text-muted-foreground">(default)</span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
