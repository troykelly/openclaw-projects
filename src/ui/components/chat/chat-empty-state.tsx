/**
 * Empty state for chat panel (Epic #1940, Issue #1948).
 *
 * Three-branch rendering (AD-7):
 * 1. No agents configured → link to Settings
 * 2. All agents hidden → link to Chat settings
 * 3. No conversations yet → agent picker CTA
 */

import * as React from 'react';
import { MessageCircle, Settings, EyeOff } from 'lucide-react';
import { useChatSessions } from '@/ui/hooks/queries/use-chat';
import { useCreateChatSession } from '@/ui/hooks/mutations/use-chat';
import { useChat } from '@/ui/contexts/chat-context';
import { Button } from '@/ui/components/ui/button';
import { useChatAgentPreferences } from './use-chat-agent-preferences';
import { AgentPickerPopover } from './agent-picker-popover';

export function ChatEmptyState(): React.JSX.Element | null {
  const { data: sessionsData, isLoading: sessionsLoading } = useChatSessions('active');
  const { allAgents, visibleAgents, resolvedDefaultAgent, isLoading: agentsLoading } = useChatAgentPreferences();
  const { setActiveSessionId } = useChat();
  const createSession = useCreateChatSession();

  if (sessionsLoading || agentsLoading) return null;

  const sessions = Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : [];

  // Don't show if we have sessions
  if (sessions.length > 0) return null;

  // Branch 1: No agents configured at all
  if (allAgents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" data-testid="chat-empty-no-agents">
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

  // Branch 2: Agents exist but all are hidden
  if (visibleAgents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" data-testid="chat-empty-all-hidden">
        <div className="rounded-full bg-muted p-3">
          <EyeOff className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="text-sm font-semibold">All agents are hidden</h3>
        <p className="text-xs text-muted-foreground">
          Update your Chat settings to make agents visible.
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href="/app/settings">Chat Settings</a>
        </Button>
      </div>
    );
  }

  // Branch 3: Agents visible, no sessions yet
  const handleSelectAgent = React.useCallback(
    (agentId: string) => {
      createSession.mutate(
        { agent_id: agentId },
        { onSuccess: (session) => setActiveSessionId(session.id) },
      );
    },
    [createSession, setActiveSessionId],
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" data-testid="chat-empty-no-sessions">
      <div className="rounded-full bg-muted p-3">
        <MessageCircle className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold">No conversations yet</h3>
      <p className="text-xs text-muted-foreground">Start a new conversation with your agent.</p>
      <AgentPickerPopover
        agents={visibleAgents}
        defaultAgentId={resolvedDefaultAgent?.id ?? null}
        onSelect={handleSelectAgent}
        disabled={createSession.isPending}
        trigger={
          <Button variant="outline" size="sm" disabled={createSession.isPending}>
            Start a conversation
          </Button>
        }
      />
    </div>
  );
}
