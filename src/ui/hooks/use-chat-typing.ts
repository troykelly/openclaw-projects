/**
 * Typing indicator hook for chat (Epic #1940, Issue #1953).
 *
 * Tracks whether the agent is currently typing in a given session.
 * Auto-clears after 5 seconds of no typing event.
 * Filters events by session ID.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TypingEvent {
  session_id: string;
  is_typing: boolean;
  agent_id?: string | null;
  source_connection_id?: string;
}

interface UseChatTypingOptions {
  sessionId: string;
}

interface UseChatTypingReturn {
  isTyping: boolean;
  handleTypingEvent: (event: TypingEvent) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPING_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that tracks typing state for a chat session.
 * Automatically clears typing indicator after 5 seconds of inactivity.
 */
export function useChatTyping({ sessionId }: UseChatTypingOptions): UseChatTypingReturn {
  const [isTyping, setIsTyping] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleTypingEvent = useCallback(
    (event: TypingEvent) => {
      // Ignore events for different sessions
      if (event.session_id !== sessionId) return;

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (event.is_typing) {
        setIsTyping(true);

        // Auto-clear after timeout
        timeoutRef.current = setTimeout(() => {
          setIsTyping(false);
          timeoutRef.current = null;
        }, TYPING_TIMEOUT_MS);
      } else {
        setIsTyping(false);
      }
    },
    [sessionId],
  );

  return { isTyping, handleTypingEvent };
}
