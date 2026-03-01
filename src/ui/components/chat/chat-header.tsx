/**
 * Chat header (Epic #1940, Issue #1950).
 *
 * Shows agent name + avatar, session title (editable inline),
 * minimize/close/new session buttons, and ChatAgentSelector dropdown.
 */

import * as React from 'react';
import { ArrowLeft, Minus, X, Plus } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { useChat } from '@/ui/contexts/chat-context';
import { useChatSessions, useAvailableAgents } from '@/ui/hooks/queries/use-chat';
import { useUpdateChatSession, useCreateChatSession } from '@/ui/hooks/mutations/use-chat';
import { Button } from '@/ui/components/ui/button';
import type { ChatSession, ChatAgent } from '@/ui/lib/api-types';

export function ChatHeader(): React.JSX.Element {
  const { activeSessionId, setActiveSessionId, closePanel } = useChat();
  const { data: sessionsData } = useChatSessions();
  const { data: agentsData } = useAvailableAgents();
  const createSession = useCreateChatSession();

  const activeSession: ChatSession | null = React.useMemo(() => {
    if (!activeSessionId || !Array.isArray(sessionsData?.sessions)) return null;
    return sessionsData.sessions.find((s) => s.id === activeSessionId) ?? null;
  }, [activeSessionId, sessionsData?.sessions]);

  const agentMap = React.useMemo(() => {
    const map = new Map<string, ChatAgent>();
    if (Array.isArray(agentsData?.agents)) {
      for (const agent of agentsData.agents) {
        map.set(agent.id, agent);
      }
    }
    return map;
  }, [agentsData?.agents]);

  const agent = activeSession ? agentMap.get(activeSession.agent_id) : null;
  const updateSession = useUpdateChatSession(activeSessionId ?? '');

  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState('');
  const titleInputRef = React.useRef<HTMLInputElement>(null);

  const handleStartEditTitle = React.useCallback(() => {
    setTitleDraft(activeSession?.title ?? '');
    setIsEditingTitle(true);
    // Focus after render
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }, [activeSession?.title]);

  const handleSaveTitle = React.useCallback(() => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== activeSession?.title) {
      updateSession.mutate({ title: trimmed });
    }
    setIsEditingTitle(false);
  }, [titleDraft, activeSession?.title, updateSession]);

  const handleTitleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSaveTitle();
      }
      if (e.key === 'Escape') {
        setIsEditingTitle(false);
      }
    },
    [handleSaveTitle],
  );

  const handleBack = React.useCallback(() => {
    setActiveSessionId(null);
  }, [setActiveSessionId]);

  const handleNewSession = React.useCallback(() => {
    createSession.mutate({}, {
      onSuccess: (session) => {
        setActiveSessionId(session.id);
      },
    });
  }, [createSession, setActiveSessionId]);

  const agentName = agent?.display_name ?? agent?.name ?? 'Agent';

  return (
    <div
      className="flex items-center gap-2 border-b border-border px-3 py-2"
      data-testid="chat-header"
    >
      {/* Back button (to session list) */}
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={handleBack}
        aria-label="Back to conversations"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
      </Button>

      {/* Agent avatar */}
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold"
        aria-hidden="true"
      >
        {agentName.charAt(0).toUpperCase()}
      </div>

      {/* Title / agent name */}
      <div className="min-w-0 flex-1">
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={handleTitleKeyDown}
            maxLength={200}
            className={cn(
              'w-full rounded-xs border border-input bg-background px-1 py-0.5 text-sm font-medium',
              'focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
            )}
            aria-label="Edit session title"
          />
        ) : (
          <button
            type="button"
            onClick={handleStartEditTitle}
            className="w-full truncate text-left text-sm font-medium hover:underline focus-visible:outline-hidden focus-visible:underline"
            title="Click to edit title"
          >
            {activeSession?.title ?? agentName}
          </button>
        )}
        <p className="truncate text-[10px] text-muted-foreground">{agentName}</p>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleNewSession}
          disabled={createSession.isPending}
          aria-label="New conversation"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleBack}
          aria-label="Minimize"
        >
          <Minus className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={closePanel}
          aria-label="Close chat"
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
