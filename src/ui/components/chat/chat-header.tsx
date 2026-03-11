/**
 * Chat header (Epic #1940, Issue #1950).
 *
 * Shows agent name + avatar, session title (editable inline),
 * minimize/close/new session buttons, and ChatAgentSelector dropdown.
 */

import * as React from 'react';
import { ArrowLeft, Minus, X, Plus, PhoneOff } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { useChat } from '@/ui/contexts/chat-context';
import { useChatSessions } from '@/ui/hooks/queries/use-chat';
import { useUpdateChatSession, useCreateChatSession, useEndChatSession } from '@/ui/hooks/mutations/use-chat';
import { Button } from '@/ui/components/ui/button';
import { useChatAgentPreferences } from './use-chat-agent-preferences';
import { AgentPickerPopover } from './agent-picker-popover';
import type { ChatSession, ChatAgent } from '@/ui/lib/api-types';

export function ChatHeader(): React.JSX.Element {
  const { activeSessionId, setActiveSessionId, closePanel } = useChat();
  const { data: sessionsData } = useChatSessions();
  const { allAgents, visibleAgents, resolvedDefaultAgent } = useChatAgentPreferences();
  const createSession = useCreateChatSession();

  const activeSession: ChatSession | null = React.useMemo(() => {
    if (!activeSessionId || !Array.isArray(sessionsData?.sessions)) return null;
    return sessionsData.sessions.find((s) => s.id === activeSessionId) ?? null;
  }, [activeSessionId, sessionsData?.sessions]);

  // Use allAgents for the map so existing sessions with hidden agents still show proper names
  const agentMap = React.useMemo(() => {
    const map = new Map<string, ChatAgent>();
    for (const agent of allAgents) {
      map.set(agent.id, agent);
    }
    return map;
  }, [allAgents]);

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

  const handleSelectAgent = React.useCallback(
    (agentId: string) => {
      createSession.mutate(
        { agent_id: agentId },
        { onSuccess: (session) => setActiveSessionId(session.id) },
      );
    },
    [createSession, setActiveSessionId],
  );

  const endSession = useEndChatSession();
  const [showEndConfirm, setShowEndConfirm] = React.useState(false);

  // Reset end-session confirmation when switching sessions
  React.useEffect(() => {
    setShowEndConfirm(false);
  }, [activeSessionId]);

  const handleEndSession = React.useCallback(() => {
    if (!activeSessionId) return;
    endSession.mutate(activeSessionId, {
      onSuccess: () => {
        setShowEndConfirm(false);
      },
    });
  }, [endSession, activeSessionId]);

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
        {activeSession?.status === 'active' && !showEndConfirm && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:text-destructive"
            onClick={() => setShowEndConfirm(true)}
            aria-label="End conversation"
          >
            <PhoneOff className="size-3.5" aria-hidden="true" />
          </Button>
        )}
        {showEndConfirm && (
          <Button
            variant="destructive"
            size="sm"
            className="h-7 text-xs"
            onClick={handleEndSession}
            disabled={endSession.isPending}
          >
            {endSession.isPending ? 'Ending...' : 'End?'}
          </Button>
        )}
        <AgentPickerPopover
          agents={visibleAgents}
          defaultAgentId={resolvedDefaultAgent?.id ?? null}
          onSelect={handleSelectAgent}
          disabled={createSession.isPending}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={createSession.isPending}
              aria-label="New conversation"
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </Button>
          }
        />
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
