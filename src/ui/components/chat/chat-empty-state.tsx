/**
 * Empty state for chat panel (Epic #1940, Issue #1948).
 *
 * Shows when no sessions exist or no agents are available.
 * Provides actionable guidance (Settings link for no agents).
 */

import * as React from 'react';
import { MessageCircle, Settings } from 'lucide-react';
import { useChatSessions, useAvailableAgents } from '@/ui/hooks/queries/use-chat';
import { Button } from '@/ui/components/ui/button';

export function ChatEmptyState(): React.JSX.Element | null {
  const { data: sessionsData, isLoading: sessionsLoading } = useChatSessions('active');
  const { data: agentsData, isLoading: agentsLoading } = useAvailableAgents();

  // Don't show empty state while loading
  if (sessionsLoading || agentsLoading) return null;

  const sessions = Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : [];
  const agents = Array.isArray(agentsData?.agents) ? agentsData.agents : [];

  // Don't show if we have sessions
  if (sessions.length > 0) return null;

  // No agents available
  if (agents.length === 0) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
        data-testid="chat-empty-no-agents"
      >
        <div className="rounded-full bg-muted p-3">
          <Settings className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="text-sm font-semibold">No agents configured</h3>
        <p className="text-xs text-muted-foreground">
          Configure an agent in Settings to start chatting.
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href="/app/settings">Go to Settings</a>
        </Button>
      </div>
    );
  }

  // No sessions yet
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
      data-testid="chat-empty-no-sessions"
    >
      <div className="rounded-full bg-muted p-3">
        <MessageCircle className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold">No conversations yet</h3>
      <p className="text-xs text-muted-foreground">
        Start a new conversation with your agent.
      </p>
    </div>
  );
}
