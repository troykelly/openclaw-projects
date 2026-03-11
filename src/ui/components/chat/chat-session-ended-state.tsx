/**
 * Session ended state for chat input area (Epic #1940, Issue #1950).
 *
 * Shown when the current session has ended or expired.
 * Disabled input appearance, "Session ended" message,
 * "Start new conversation" button with agent picker.
 */

import * as React from 'react';
import { MessageCircle } from 'lucide-react';
import { useChat } from '@/ui/contexts/chat-context';
import { useCreateChatSession } from '@/ui/hooks/mutations/use-chat';
import { Button } from '@/ui/components/ui/button';
import { useChatAgentPreferences } from './use-chat-agent-preferences';
import { AgentPickerPopover } from './agent-picker-popover';

export function ChatSessionEndedState(): React.JSX.Element {
  const { setActiveSessionId } = useChat();
  const { visibleAgents, resolvedDefaultAgent } = useChatAgentPreferences();
  const createSession = useCreateChatSession();

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
    <div
      className="flex flex-col items-center gap-2 border-t border-border p-4 text-center"
      data-testid="chat-session-ended"
    >
      <p className="text-xs text-muted-foreground">This session has ended.</p>
      <AgentPickerPopover
        agents={visibleAgents}
        defaultAgentId={resolvedDefaultAgent?.id ?? null}
        onSelect={handleSelectAgent}
        disabled={createSession.isPending}
        trigger={
          <Button variant="outline" size="sm" className="gap-1.5" disabled={createSession.isPending}>
            <MessageCircle className="size-3.5" aria-hidden="true" />
            Start new conversation
          </Button>
        }
      />
    </div>
  );
}
