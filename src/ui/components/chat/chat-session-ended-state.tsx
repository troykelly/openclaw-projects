/**
 * Session ended state for chat input area (Epic #1940, Issue #1950).
 *
 * Shown when the current session has ended or expired.
 * Disabled input appearance, "Session ended" message,
 * "Start new conversation" button.
 */

import * as React from 'react';
import { MessageCircle } from 'lucide-react';
import { useChat } from '@/ui/contexts/chat-context';
import { useAvailableAgents } from '@/ui/hooks/queries/use-chat';
import { useCreateChatSession } from '@/ui/hooks/mutations/use-chat';
import { Button } from '@/ui/components/ui/button';

export function ChatSessionEndedState(): React.JSX.Element {
  const { setActiveSessionId } = useChat();
  const { data: agentsData } = useAvailableAgents();
  const createSession = useCreateChatSession();

  const handleNewConversation = React.useCallback(() => {
    const defaultAgent = Array.isArray(agentsData?.agents) ? agentsData.agents.find((a) => a.id) : null;
    createSession.mutate(
      { agent_id: defaultAgent?.id },
      {
        onSuccess: (session) => {
          setActiveSessionId(session.id);
        },
      },
    );
  }, [createSession, setActiveSessionId, agentsData?.agents]);

  return (
    <div
      className="flex flex-col items-center gap-2 border-t border-border p-4 text-center"
      data-testid="chat-session-ended"
    >
      <p className="text-xs text-muted-foreground">This session has ended.</p>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={handleNewConversation}
        disabled={createSession.isPending}
      >
        <MessageCircle className="size-3.5" aria-hidden="true" />
        Start new conversation
      </Button>
    </div>
  );
}
