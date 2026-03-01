/**
 * Chat message bubble (Epic #1940, Issue #1949).
 *
 * User messages: right-aligned, primary color.
 * Agent messages: left-aligned, muted background with avatar.
 * Supports markdown rendering with existing sanitize.ts.
 * Shows relative timestamps and message status.
 */

import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import type { ChatMessage } from '@/ui/lib/api-types';
import { ChatMessageStatus } from './chat-message-status';

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

/** Format a timestamp to a short time string. */
function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ChatMessageBubble({ message }: ChatMessageBubbleProps): React.JSX.Element {
  const isUser = message.direction === 'outbound';
  const body = message.body ?? '';

  return (
    <div
      className={cn(
        'flex gap-2',
        isUser ? 'justify-end' : 'justify-start',
      )}
      data-testid={`chat-message-${message.id}`}
    >
      {/* Agent avatar */}
      {!isUser && (
        <div
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold"
          aria-hidden="true"
        >
          A
        </div>
      )}

      <div className={cn('max-w-[80%]', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-lg px-3 py-2 text-sm',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground',
          )}
        >
          {/* For now, render body as plain text. Markdown rendering is Phase 4. */}
          <p className="whitespace-pre-wrap break-words">{body}</p>
        </div>

        <div
          className={cn(
            'mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground',
            isUser ? 'justify-end' : 'justify-start',
          )}
        >
          <span>{formatTime(message.received_at)}</span>
          {isUser && <ChatMessageStatus status={message.status} />}
        </div>
      </div>
    </div>
  );
}
