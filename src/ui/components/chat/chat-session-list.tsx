/**
 * Chat session list (Epic #1940, Issue #1948).
 *
 * Lists chat sessions sorted by last_activity_at DESC.
 * Shows agent name, last message preview, timestamp, unread indicator.
 * Click selects a session. "New Conversation" button at top.
 */

import * as React from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { useChat } from '@/ui/contexts/chat-context';
import { useChatSessions, useAvailableAgents } from '@/ui/hooks/queries/use-chat';
import { useCreateChatSession } from '@/ui/hooks/mutations/use-chat';
import { Button } from '@/ui/components/ui/button';
import { ChatSkeletonLoader } from './chat-skeleton-loader';
import type { ChatSession, ChatAgent } from '@/ui/lib/api-types';

/** Format a timestamp to relative time. */
function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHour < 24) return `${diffHour}h`;
  if (diffDay < 7) return `${diffDay}d`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ChatSessionList(): React.JSX.Element {
  const { setActiveSessionId } = useChat();
  const { data, isLoading } = useChatSessions('active');
  const { data: agentsData } = useAvailableAgents();
  const createSession = useCreateChatSession();

  const agentMap = React.useMemo(() => {
    const map = new Map<string, ChatAgent>();
    if (Array.isArray(agentsData?.agents)) {
      for (const agent of agentsData.agents) {
        map.set(agent.id, agent);
      }
    }
    return map;
  }, [agentsData?.agents]);

  const sessions = React.useMemo(() => {
    if (!Array.isArray(data?.sessions)) return [];
    return [...data.sessions].sort(
      (a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime(),
    );
  }, [data?.sessions]);

  const handleNewConversation = React.useCallback(() => {
    createSession.mutate({}, {
      onSuccess: (session) => {
        setActiveSessionId(session.id);
      },
    });
  }, [createSession, setActiveSessionId]);

  const handleSelectSession = React.useCallback(
    (session: ChatSession) => {
      setActiveSessionId(session.id);
    },
    [setActiveSessionId],
  );

  if (isLoading) {
    return <ChatSkeletonLoader type="session-list" />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="chat-session-list">
      {/* New Conversation button */}
      <div className="border-b border-border p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleNewConversation}
          disabled={createSession.isPending}
          data-testid="chat-new-conversation"
        >
          <Plus className="size-4" aria-hidden="true" />
          New Conversation
        </Button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto" role="list" aria-label="Chat sessions">
        {sessions.map((session) => {
          const agent = agentMap.get(session.agent_id);
          return (
            <button
              key={session.id}
              type="button"
              role="listitem"
              className={cn(
                'flex w-full items-start gap-3 border-b border-border p-3 text-left transition-colors',
                'hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden',
              )}
              onClick={() => handleSelectSession(session)}
              data-testid={`chat-session-item-${session.id}`}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {(agent?.display_name ?? agent?.name ?? 'A').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm font-medium">
                    {session.title ?? agent?.display_name ?? agent?.name ?? 'Agent'}
                  </span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(session.last_activity_at)}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {session.status === 'ended' ? 'Session ended' : 'Tap to continue'}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
