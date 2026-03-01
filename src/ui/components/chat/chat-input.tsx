/**
 * Chat input with auto-expanding textarea (Epic #1940, Issue #1950).
 *
 * Cmd/Ctrl+Enter to send (follows CommentInput pattern).
 * Draft persistence via sessionStorage (ChatContext).
 * Disabled when session ended. Character limit indicator.
 * Auto-expanding textarea (max 5 lines).
 */

import * as React from 'react';
import { Send, Loader2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { useChat } from '@/ui/contexts/chat-context';
import { useSendChatMessage } from '@/ui/hooks/mutations/use-chat';
import { useChatSessions } from '@/ui/hooks/queries/use-chat';
import { Button } from '@/ui/components/ui/button';
import { ChatSessionEndedState } from './chat-session-ended-state';

const MAX_CHARS = 64_000; // 64KB limit per design doc

export function ChatInput(): React.JSX.Element {
  const { activeSessionId, getDraft, setDraft, clearDraft } = useChat();
  const { data: sessionsData } = useChatSessions();
  const sendMessage = useSendChatMessage(activeSessionId ?? '');
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const activeSession = React.useMemo(() => {
    if (!activeSessionId || !Array.isArray(sessionsData?.sessions)) return null;
    return sessionsData.sessions.find((s) => s.id === activeSessionId) ?? null;
  }, [activeSessionId, sessionsData?.sessions]);

  const isEnded = activeSession?.status === 'ended' || activeSession?.status === 'expired';

  const [content, setContent] = React.useState(() =>
    activeSessionId ? getDraft(activeSessionId) : '',
  );

  // Restore draft when session changes
  React.useEffect(() => {
    if (activeSessionId) {
      setContent(getDraft(activeSessionId));
    }
  }, [activeSessionId, getDraft]);

  // Persist draft on change
  React.useEffect(() => {
    if (activeSessionId) {
      setDraft(activeSessionId, content);
    }
  }, [activeSessionId, content, setDraft]);

  // Auto-expand textarea
  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const lineHeight = 20; // approx
    const maxHeight = lineHeight * 5; // max 5 lines
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, [content]);

  const handleSend = React.useCallback(() => {
    const trimmed = content.trim();
    if (!trimmed || !activeSessionId || sendMessage.isPending) return;

    const idempotencyKey = crypto.randomUUID();
    sendMessage.mutate(
      { content: trimmed, idempotency_key: idempotencyKey },
      {
        onSuccess: () => {
          setContent('');
          clearDraft(activeSessionId);
          textareaRef.current?.focus();
        },
      },
    );
  }, [content, activeSessionId, sendMessage, clearDraft]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  if (isEnded) {
    return <ChatSessionEndedState />;
  }

  const charCount = content.length;
  const isOverLimit = charCount > MAX_CHARS;

  return (
    <div className="border-t border-border p-3" data-testid="chat-input">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          disabled={sendMessage.isPending}
          aria-label="Chat message"
          className={cn(
            'flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm',
            'placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            isOverLimit && 'border-destructive',
          )}
        />
        <Button
          size="icon"
          className="size-9 shrink-0"
          onClick={handleSend}
          disabled={!content.trim() || sendMessage.isPending || isOverLimit}
          aria-label="Send message"
        >
          {sendMessage.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      {/* Character limit indicator */}
      {charCount > MAX_CHARS * 0.9 && (
        <div
          className={cn(
            'mt-1 text-right text-[10px]',
            isOverLimit ? 'text-destructive' : 'text-muted-foreground',
          )}
          aria-live="polite"
        >
          {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
        </div>
      )}
    </div>
  );
}
