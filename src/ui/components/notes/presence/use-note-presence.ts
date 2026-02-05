/**
 * Hook for subscribing to note presence updates.
 * Part of Epic #338, Issue #634.
 *
 * Provides real-time tracking of who is viewing a note,
 * including their cursor positions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtime } from '@/ui/components/realtime/realtime-context';
import type { RealtimeEvent } from '@/ui/components/realtime/types';

/**
 * User presence information
 */
export interface NotePresenceUser {
  email: string;
  displayName?: string;
  avatarUrl?: string;
  lastSeenAt: string;
  cursorPosition?: {
    line: number;
    column: number;
  };
}

/**
 * Presence event types from the server
 */
type NotePresenceEvent =
  | { type: 'note:presence_joined'; data: { noteId: string; user: NotePresenceUser } }
  | { type: 'note:presence_left'; data: { noteId: string; user: NotePresenceUser } }
  | { type: 'note:presence_list'; data: { noteId: string; users: NotePresenceUser[] } }
  | { type: 'note:presence_cursor'; data: { noteId: string; userEmail: string; cursorPosition: { line: number; column: number } } };

interface UseNotePresenceOptions {
  /** The note ID to track presence for */
  noteId: string;
  /** Current user's email */
  userEmail: string;
  /** Whether to automatically join presence on mount */
  autoJoin?: boolean;
  /** API base URL */
  apiUrl?: string;
}

interface UseNotePresenceReturn {
  /** List of users currently viewing the note */
  viewers: NotePresenceUser[];
  /** Whether the presence connection is active */
  isConnected: boolean;
  /** Any error that occurred */
  error: Error | null;
  /** Join the note presence */
  join: () => Promise<void>;
  /** Leave the note presence */
  leave: () => Promise<void>;
  /** Update cursor position */
  updateCursor: (position: { line: number; column: number }) => Promise<void>;
}

/**
 * Hook for real-time note presence tracking.
 *
 * @example
 * ```tsx
 * const { viewers, join, leave } = useNotePresence({
 *   noteId: '123',
 *   userEmail: 'user@example.com',
 *   autoJoin: true,
 * });
 *
 * return (
 *   <div>
 *     {viewers.length} people viewing
 *   </div>
 * );
 * ```
 */
export function useNotePresence({
  noteId,
  userEmail,
  autoJoin = true,
  apiUrl = '/api',
}: UseNotePresenceOptions): UseNotePresenceReturn {
  const [viewers, setViewers] = useState<NotePresenceUser[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const hasJoinedRef = useRef(false);

  // Try to use realtime context, but gracefully degrade if not available
  let realtimeContext: ReturnType<typeof useRealtime> | null = null;
  try {
    realtimeContext = useRealtime();
  } catch {
    // Realtime context not available, will use polling fallback
  }

  /**
   * Join note presence via API
   */
  const join = useCallback(async () => {
    if (hasJoinedRef.current) return;

    try {
      const response = await fetch(
        `${apiUrl}/notes/${noteId}/presence?user_email=${encodeURIComponent(userEmail)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to join presence: ${response.status}`);
      }

      const data = await response.json();
      setViewers(data.collaborators || []);
      setIsConnected(true);
      hasJoinedRef.current = true;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      setIsConnected(false);
    }
  }, [noteId, userEmail, apiUrl]);

  /**
   * Leave note presence via API
   */
  const leave = useCallback(async () => {
    if (!hasJoinedRef.current) return;

    try {
      await fetch(
        `${apiUrl}/notes/${noteId}/presence?user_email=${encodeURIComponent(userEmail)}`,
        { method: 'DELETE' }
      );
      hasJoinedRef.current = false;
      setIsConnected(false);
    } catch (err) {
      // Don't throw on leave errors, just log
      console.error('[NotePresence] Error leaving:', err);
    }
  }, [noteId, userEmail, apiUrl]);

  /**
   * Update cursor position via API
   */
  const updateCursor = useCallback(async (position: { line: number; column: number }) => {
    try {
      await fetch(
        `${apiUrl}/notes/${noteId}/presence/cursor?user_email=${encodeURIComponent(userEmail)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cursorPosition: position }),
        }
      );
    } catch (err) {
      // Don't throw on cursor update errors, just log
      console.error('[NotePresence] Error updating cursor:', err);
    }
  }, [noteId, userEmail, apiUrl]);

  /**
   * Handle presence events from WebSocket
   */
  const handlePresenceEvent = useCallback(
    (event: RealtimeEvent) => {
      const presenceEvent = event as unknown as NotePresenceEvent;

      // Only handle events for this note
      if (!('data' in presenceEvent) || !presenceEvent.data) return;
      const eventData = presenceEvent.data as { noteId?: string };
      if (eventData.noteId !== noteId) return;

      switch (presenceEvent.type) {
        case 'note:presence_joined': {
          const joinData = presenceEvent.data as { user: NotePresenceUser };
          setViewers((prev) => {
            // Don't add if already in list
            if (prev.some((v) => v.email === joinData.user.email)) {
              return prev;
            }
            return [...prev, joinData.user];
          });
          break;
        }

        case 'note:presence_left': {
          const leftData = presenceEvent.data as { user: NotePresenceUser };
          setViewers((prev) => prev.filter((v) => v.email !== leftData.user.email));
          break;
        }

        case 'note:presence_list': {
          const listData = presenceEvent.data as { users: NotePresenceUser[] };
          setViewers(listData.users);
          break;
        }

        case 'note:presence_cursor': {
          const cursorData = presenceEvent.data as {
            userEmail: string;
            cursorPosition: { line: number; column: number }
          };
          setViewers((prev) =>
            prev.map((v) =>
              v.email === cursorData.userEmail
                ? { ...v, cursorPosition: cursorData.cursorPosition }
                : v
            )
          );
          break;
        }
      }
    },
    [noteId]
  );

  /**
   * Subscribe to WebSocket events when available
   */
  useEffect(() => {
    if (!realtimeContext) return;

    const eventTypes = [
      'note:presence_joined',
      'note:presence_left',
      'note:presence_list',
      'note:presence_cursor',
    ] as const;

    // Subscribe to each event type
    const unsubscribes = eventTypes.map((type) =>
      realtimeContext.subscribe(type, handlePresenceEvent)
    );

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [realtimeContext, handlePresenceEvent]);

  /**
   * Auto-join on mount, leave on unmount
   */
  useEffect(() => {
    if (autoJoin) {
      join();
    }

    return () => {
      leave();
    };
  }, [autoJoin, join, leave]);

  return {
    viewers,
    isConnected,
    error,
    join,
    leave,
    updateCursor,
  };
}
