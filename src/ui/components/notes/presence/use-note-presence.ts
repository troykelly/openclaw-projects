/**
 * Hook for subscribing to note presence updates.
 * Part of Epic #338, Issue #634.
 *
 * Provides real-time tracking of who is viewing a note,
 * including their cursor positions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeOptional } from '@/ui/components/realtime/realtime-context';
import { apiClient } from '@/ui/lib/api-client';
import type { RealtimeEvent } from '@/ui/components/realtime/types';

/**
 * User presence information
 */
export interface NotePresenceUser {
  email: string;
  display_name?: string;
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
  | { type: 'note:presence_cursor'; data: { noteId: string; user_email: string; cursorPosition: { line: number; column: number } } };

interface UseNotePresenceOptions {
  /** The note ID to track presence for */
  noteId: string;
  /** Current user's email */
  user_email: string;
  /** Whether to automatically join presence on mount */
  autoJoin?: boolean;
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
 *   user_email: 'user@example.com',
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
export function useNotePresence({ noteId, user_email, autoJoin = true }: UseNotePresenceOptions): UseNotePresenceReturn {
  const [viewers, setViewers] = useState<NotePresenceUser[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const hasJoinedRef = useRef(false);
  const previousStatusRef = useRef<string | null>(null);

  // Use optional realtime hook - returns null when not inside RealtimeProvider (#692)
  const realtimeContext = useRealtimeOptional();

  /**
   * Join note presence via API
   * Security: user_email sent in body instead of query params (#689)
   */
  const join = useCallback(async () => {
    if (hasJoinedRef.current) return;

    try {
      const data = await apiClient.post<{ collaborators?: NotePresenceUser[] }>(`/api/notes/${noteId}/presence`, { user_email });
      setViewers(data.collaborators || []);
      setIsConnected(true);
      hasJoinedRef.current = true;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      setIsConnected(false);
    }
  }, [noteId, user_email]);

  /**
   * Leave note presence via API
   * Security: user_email sent in header instead of query params (#689)
   */
  const leave = useCallback(async () => {
    if (!hasJoinedRef.current) return;

    try {
      await apiClient.delete(`/api/notes/${noteId}/presence`, { headers: { 'X-User-Email': user_email } });
      hasJoinedRef.current = false;
      setIsConnected(false);
    } catch (err) {
      // Don't throw on leave errors - leaving is a best-effort operation
      // Log in development only to avoid information leakage in production (#693)
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error('[NotePresence] Error leaving:', err);
      }
    }
  }, [noteId, user_email]);

  /**
   * Update cursor position via API
   * Security: user_email sent in body instead of query params (#689)
   */
  const updateCursor = useCallback(
    async (position: { line: number; column: number }) => {
      try {
        await apiClient.put(`/api/notes/${noteId}/presence/cursor`, { user_email, cursorPosition: position });
      } catch (err) {
        // Don't throw on cursor update errors - cursor updates are non-critical
        // Log in development only to avoid information leakage in production (#693)
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error('[NotePresence] Error updating cursor:', err);
        }
      }
    },
    [noteId, user_email],
  );

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
            user_email: string;
            cursorPosition: { line: number; column: number };
          };
          setViewers((prev) => prev.map((v) => (v.email === cursorData.user_email ? { ...v, cursorPosition: cursorData.cursorPosition } : v)));
          break;
        }
      }
    },
    [noteId],
  );

  /**
   * Subscribe to WebSocket events when available
   */
  useEffect(() => {
    if (!realtimeContext) return;

    const eventTypes = ['note:presence_joined', 'note:presence_left', 'note:presence_list', 'note:presence_cursor'] as const;

    // Subscribe to each event type
    const unsubscribes = eventTypes.map((type) => realtimeContext.subscribe(type, handlePresenceEvent));

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [realtimeContext, handlePresenceEvent]);

  /**
   * Reconnect presence when WebSocket reconnects (#699)
   * Monitors the realtime connection status and re-joins presence
   * when the connection is restored after a disconnect.
   */
  useEffect(() => {
    if (!realtimeContext) return;

    const currentStatus = realtimeContext.status;
    const previousStatus = previousStatusRef.current;

    // If we transitioned from a non-connected state to connected, re-join
    if (previousStatus !== null && previousStatus !== 'connected' && currentStatus === 'connected' && hasJoinedRef.current) {
      // Reset the joined flag to allow re-joining
      hasJoinedRef.current = false;
      void join();
    }

    previousStatusRef.current = currentStatus;
  }, [realtimeContext, realtimeContext?.status, join]);

  /**
   * Clean up stale presence viewers (#700)
   * Removes viewers who haven't been seen in the last 5 minutes.
   * This handles cases where leave events are missed due to network issues.
   */
  useEffect(() => {
    const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    const CLEANUP_INTERVAL_MS = 60 * 1000; // Check every minute

    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setViewers((prev) =>
        prev.filter((viewer) => {
          const lastSeenTime = new Date(viewer.lastSeenAt).getTime();
          return now - lastSeenTime < STALE_THRESHOLD_MS;
        }),
      );
    }, CLEANUP_INTERVAL_MS);

    return () => {
      clearInterval(cleanupInterval);
    };
  }, []);

  /**
   * Auto-join on mount, leave on unmount
   * Note: leave() is async but called fire-and-forget in cleanup, which is acceptable
   * for cleanup functions. We track mounted state to prevent state updates after unmount. (#696)
   */
  useEffect(() => {
    let isMounted = true;

    if (autoJoin) {
      join().catch(() => {
        // Only update error state if still mounted
        if (isMounted) {
          // Error already handled in join()
        }
      });
    }

    return () => {
      isMounted = false;
      // Fire-and-forget is acceptable for cleanup - the request will complete
      // even after unmount, we just won't update state
      void leave();
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
