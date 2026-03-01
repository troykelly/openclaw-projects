/**
 * Chat message bubble (Epic #1940, Issue #1949, #1951).
 *
 * User messages: right-aligned, primary color.
 * Agent messages: left-aligned, muted background with avatar.
 * Supports streaming mode with progressive text rendering and cursor.
 * Shows relative timestamps and message status.
 */

import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import type { ChatMessage } from '@/ui/lib/api-types';
import { ChatMessageStatus } from './chat-message-status';
import type { StreamState } from '@/ui/hooks/use-chat-stream';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  onRetry?: () => void;
  /** Content from the stream buffer (overrides message.body during streaming). */
  streamContent?: string;
  /** Current stream state for this message. */
  streamState?: StreamState;
  /** Error message when stream failed. */
  streamError?: string;
  /** Callback to regenerate a failed response. */
  onRegenerate?: () => void;
}

/** Format a timestamp to a short time string. */
function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Animated cursor shown during streaming (reduced-motion aware). */
function StreamCursor(): React.JSX.Element {
  return (
    <span
      data-testid="stream-cursor"
      className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current motion-reduce:animate-none"
      aria-hidden="true"
    />
  );
}

export function ChatMessageBubble({
  message,
  onRetry,
  streamContent,
  streamState,
  streamError,
  onRegenerate,
}: ChatMessageBubbleProps): React.JSX.Element {
  const isUser = message.direction === 'outbound';
  const isStreaming = streamState === 'streaming' || streamState === 'started';
  const isFailed = streamState === 'failed';

  // During streaming, use stream content; otherwise use message body
  const displayContent = streamState != null ? (streamContent ?? '') : (message.body ?? '');

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
          <p className="whitespace-pre-wrap break-words">
            {displayContent}
            {isStreaming && <StreamCursor />}
          </p>
        </div>

        {/* Stream failure notice */}
        {isFailed && (
          <div className="mt-1 flex items-center gap-2 text-xs text-destructive">
            <span>Response was interrupted</span>
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="font-medium underline underline-offset-2 hover:no-underline"
              >
                Regenerate
              </button>
            )}
          </div>
        )}

        <div
          className={cn(
            'mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground',
            isUser ? 'justify-end' : 'justify-start',
          )}
        >
          <span>{formatTime(message.received_at)}</span>
          {isUser && <ChatMessageStatus status={message.status} onRetry={onRetry} />}
        </div>
      </div>
    </div>
  );
}
