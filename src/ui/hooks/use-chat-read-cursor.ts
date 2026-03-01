/**
 * Hook for managing chat read cursor with debounced updates (Issue #1959).
 *
 * Tracks the last-read message per session and debounces POST updates
 * to /api/chat/sessions/:id/read. Supports forward-only cursor movement
 * and accepts remote cursor updates from other devices.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { apiClient } from '@/ui/lib/api-client';

/** Debounce interval for read cursor updates (milliseconds). */
const DEBOUNCE_MS = 2000;

interface ReadCursorResponse {
  last_read_message_id: string;
  last_read_at: string;
}

interface UseChatReadCursorReturn {
  /** The last message ID marked as read. */
  lastReadMessageId: string | null;
  /** Timestamp of the last read. */
  lastReadAt: string | null;
  /** Mark a message as read (debounced). */
  markRead: (messageId: string) => void;
  /** Accept a remote cursor update from another device. */
  handleRemoteCursorUpdate: (messageId: string, readAt: string) => void;
}

export function useChatReadCursor(sessionId: string): UseChatReadCursorReturn {
  const [lastReadMessageId, setLastReadMessageId] = useState<string | null>(null);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const confirmedRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const flush = useCallback(async () => {
    const messageId = pendingRef.current;
    if (!messageId) return;

    pendingRef.current = null;

    try {
      const data = await apiClient.post<ReadCursorResponse>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/read`,
        { last_read_message_id: messageId },
      );
      if (!mountedRef.current) return;
      confirmedRef.current = data.last_read_message_id;
      setLastReadMessageId(data.last_read_message_id);
      setLastReadAt(data.last_read_at);
    } catch {
      // Silently fail — cursor sync is best-effort
    }
  }, [sessionId]);

  const markRead = useCallback(
    (messageId: string) => {
      // Skip if same as confirmed server state
      if (messageId === confirmedRef.current) {
        return;
      }
      // Skip if same as already-pending
      if (messageId === pendingRef.current) {
        return;
      }

      pendingRef.current = messageId;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  const handleRemoteCursorUpdate = useCallback(
    (messageId: string, readAt: string) => {
      // Forward-only: only update if the remote cursor is newer
      if (!lastReadAt || readAt > lastReadAt) {
        confirmedRef.current = messageId;
        setLastReadMessageId(messageId);
        setLastReadAt(readAt);
      }
    },
    [lastReadAt],
  );

  return {
    lastReadMessageId,
    lastReadAt,
    markRead,
    handleRemoteCursorUpdate,
  };
}
