/**
 * Chat typing indicator (Epic #1940, Issue #1953).
 *
 * Shows three animated bouncing dots when the agent is typing.
 * Respects prefers-reduced-motion (shows static text instead).
 */

import * as React from 'react';

interface ChatTypingIndicatorProps {
  visible: boolean;
}

export function ChatTypingIndicator({ visible }: ChatTypingIndicatorProps): React.JSX.Element | null {
  if (!visible) return null;

  return (
    <div
      data-testid="typing-indicator"
      className="flex items-center gap-2 px-3 py-2"
    >
      {/* Agent avatar placeholder */}
      <div
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold"
        aria-hidden="true"
      >
        A
      </div>

      <div className="flex items-center gap-1 rounded-lg bg-muted px-3 py-2">
        {/* Animated dots */}
        <span
          data-testid="typing-dot"
          className="inline-block size-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none"
          style={{ animationDelay: '0ms' }}
          aria-hidden="true"
        />
        <span
          data-testid="typing-dot"
          className="inline-block size-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none"
          style={{ animationDelay: '150ms' }}
          aria-hidden="true"
        />
        <span
          data-testid="typing-dot"
          className="inline-block size-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none"
          style={{ animationDelay: '300ms' }}
          aria-hidden="true"
        />

        {/* Screen reader text */}
        <span className="sr-only">Agent is typing</span>
      </div>
    </div>
  );
}
