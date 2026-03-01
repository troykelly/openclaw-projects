/**
 * Chat conversation / message list (Epic #1940, Issue #1949).
 *
 * Renders messages in chronological order with auto-scroll to bottom
 * on new messages (when already at bottom). Shows "X new messages" pill
 * when scrolled up. Date separators between messages on different days.
 * Load-more pagination on scroll to top.
 */

import * as React from 'react';
import { useChat } from '@/ui/contexts/chat-context';
import { useChatMessages } from '@/ui/hooks/queries/use-chat';
import { ChatMessageBubble } from './chat-message-bubble';
import { ChatNewMessagesPill } from './chat-new-messages-pill';
import { ChatSkeletonLoader } from './chat-skeleton-loader';

/** Check if two dates are on different days. */
function isDifferentDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() !== db.getFullYear() ||
    da.getMonth() !== db.getMonth() ||
    da.getDate() !== db.getDate();
}

/** Format a date as a separator label. */
function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86_400_000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function ChatConversation(): React.JSX.Element {
  const { activeSessionId } = useChat();
  const { data, isLoading } = useChatMessages(activeSessionId ?? '');
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const scrollAnchorRef = React.useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = React.useState(true);
  const [newMessageCount, setNewMessageCount] = React.useState(0);
  const prevMessageCountRef = React.useRef(0);

  const messages = React.useMemo(
    () => (Array.isArray(data?.messages) ? data.messages : []),
    [data?.messages],
  );

  // Track scroll position
  const handleScroll = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 100;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    setIsAtBottom(atBottom);
    if (atBottom) {
      setNewMessageCount(0);
    }
  }, []);

  // Auto-scroll to bottom when new messages arrive and user is at bottom
  React.useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      const diff = messages.length - prevMessageCountRef.current;
      if (isAtBottom) {
        scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        setNewMessageCount((prev) => prev + diff);
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, isAtBottom]);

  // Scroll to bottom on initial load or session change
  const hasMessages = messages.length > 0;
  React.useEffect(() => {
    if (!isLoading && hasMessages) {
      scrollAnchorRef.current?.scrollIntoView();
    }
  }, [isLoading, hasMessages, activeSessionId]);

  const handleScrollToBottom = React.useCallback(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
    setNewMessageCount(0);
  }, []);

  if (isLoading) {
    return <ChatSkeletonLoader type="message-list" />;
  }

  if (messages.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground"
        data-testid="chat-no-messages"
      >
        Send a message to start the conversation.
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollContainerRef}
        className="flex h-full flex-col gap-1 overflow-y-auto p-3"
        onScroll={handleScroll}
        data-testid="chat-conversation"
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
      >
        {messages.map((msg, i) => {
          const showDateSeparator =
            i === 0 || isDifferentDay(messages[i - 1].received_at, msg.received_at);

          return (
            <React.Fragment key={msg.id}>
              {showDateSeparator && (
                <div className="flex items-center gap-2 py-2" aria-hidden="true">
                  <hr className="flex-1 border-t border-border" />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {formatDateSeparator(msg.received_at)}
                  </span>
                  <hr className="flex-1 border-t border-border" />
                </div>
              )}
              <ChatMessageBubble message={msg} />
            </React.Fragment>
          );
        })}
        <div ref={scrollAnchorRef} aria-hidden="true" />
      </div>

      {newMessageCount > 0 && !isAtBottom && (
        <ChatNewMessagesPill count={newMessageCount} onClick={handleScrollToBottom} />
      )}
    </div>
  );
}
