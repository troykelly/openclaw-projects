/**
 * Chat settings section for the Settings page (Issue #1957).
 *
 * Provides a "Chat" section where users can select their default agent
 * from the available agents list. Saves immediately on change.
 *
 * Follows the same Card/CardHeader/CardContent pattern used by other
 * settings sections (NotificationPreferencesSection, LocationSection, etc.).
 */
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { apiClient } from '@/ui/lib/api-client';
import type { ChatAgent, ChatAgentsResponse } from '@/ui/lib/api-types';
import { useDefaultAgent } from './use-default-agent';

export function ChatSettingsSection(): React.JSX.Element {
  const { defaultAgentId, isLoading: settingsLoading, error: settingsError, isSaving, setDefaultAgent } = useDefaultAgent();
  const [agents, setAgents] = useState<ChatAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function fetchAgents() {
      try {
        const data = await apiClient.get<ChatAgentsResponse>('/api/chat/agents');
        if (!alive) return;
        setAgents(Array.isArray(data.agents) ? data.agents : []);
      } catch (err) {
        if (!alive) return;
        setAgentsError(err instanceof Error ? err.message : 'Failed to load agents');
      } finally {
        if (alive) setAgentsLoading(false);
      }
    }

    fetchAgents();
    return () => {
      alive = false;
    };
  }, []);

  const handleAgentChange = useCallback(
    (value: string) => {
      setDefaultAgent(value === 'none' ? null : value);
    },
    [setDefaultAgent],
  );

  const isLoading = settingsLoading || agentsLoading;
  const error = settingsError ?? agentsError;

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

  if (agents.length === 0) {
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

  const selectedAgent = agents.find((a) => a.id === defaultAgentId);

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
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.display_name ?? agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
