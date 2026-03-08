/**
 * Hook for subscribing to note presence updates.
 * Part of Epic #338, Issue #634, #2256.
 *
 * Provides real-time tracking of who is viewing a note.
 * When a Yjs awareness instance is provided (#2256), reads presence from Yjs
 * awareness state directly — no REST API calls for join/leave/cursor.
 * Falls back to REST-based presence when Yjs is not active.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeOptional } from '@/ui/components/realtime/realtime-context';
import { apiClient } from '@/ui/lib/api-client';
import type { RealtimeEvent } from '@/ui/components/realtime/types';
import type { WebsocketProvider } from 'y-websocket';

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
  /** Yjs WebSocket provider for awareness-based presence (#2256). When provided, REST calls are skipped. */
  yjsProvider?: WebsocketProvider | null;
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
 * When `yjsProvider` is provided (#2256), presence is read from Yjs awareness
 * state — no REST API calls are made for join/leave/cursor. The awareness
 * protocol handles real-time user presence natively.
 *
 * When `yjsProvider` is null/undefined, falls back to REST-based presence.
 */
export function useNotePresence({ noteId, user_email, autoJoin = true, yjsProvider }: UseNotePresenceOptions): UseNotePresenceReturn {
  const [viewers, setViewers] = useState<NotePresenceUser[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const hasJoinedRef = useRef(false);
  const previousStatusRef = useRef<string | null>(null);

  // Use optional realtime hook - returns null when not inside RealtimeProvider (#692)
  const realtimeContext = useRealtimeOptional();

  // --- Yjs awareness-based presence (#2256) ---
  useEffect(() => {
    if (!yjsProvider) return;

    const awareness = yjsProvider.awareness;
    setIsConnected(true);

    const updateViewers = () => {
      const states = awareness.getStates();
      const users: NotePresenceUser[] = [];
      states.forEach((state) => {
        if (state?.user?.email) {
          users.push({
            email: state.user.email as string,
            display_name: (state.user.name as string) ?? undefined,
            lastSeenAt: new Date().toISOString(),
            cursorPosition: state.cursor ?? undefined,
          });
        }
      });
      setViewers(users);
    };

    // Initial read
    updateViewers();

    // Listen for awareness changes
    awareness.on('update', updateViewers);

    return () => {
      awareness.off('update', updateViewers);
    };
  }, [yjsProvider]);

  // If Yjs is active, skip REST-based presence
  const useRestPresence = !yjsProvider;

  /**
   * Join note presence via API
   * Security: user_email sent in body instead of query params (#689)
   */
  const join = useCallback(async () => {
    if (!useRestPresence || hasJoinedRef.current) return;

    try {
      const data = await apiClient.post<{ collaborators?: NotePresenceUser[] }>(`/notes/${noteId}/presence`, { user_email });
      setViewers(data.collaborators || []);
      setIsConnected(true);
      hasJoinedRef.current = true;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      setIsConnected(false);
    }
  }, [noteId, user_email, useRestPresence]);

  /**
   * Leave note presence via API
   * Security: user_email sent in header instead of query params (#689)
   */
  const leave = useCallback(async () => {
    if (!useRestPresence || !hasJoinedRef.current) return;

    try {
      await apiClient.delete(`/notes/${noteId}/presence`, undefined, { headers: { 'X-User-Email': user_email } });
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
  }, [noteId, user_email, useRestPresence]);

  /**
   * Update cursor position via API
   * Security: user_email sent in body instead of query params (#689)
   */
  const updateCursor = useCallback(
    async (position: { line: number; column: number }) => {
      // When Yjs is active, cursors are handled natively by awareness
      if (!useRestPresence) return;

      try {
        await apiClient.put(`/notes/${noteId}/presence/cursor`, { user_email, cursor_position: position });
      } catch (err) {
        // Don't throw on cursor update errors - cursor updates are non-critical
        // Log in development only to avoid information leakage in production (#693)
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error('[NotePresence] Error updating cursor:', err);
        }
      }
    },
    [noteId, user_email, useRestPresence],
  );

  /**
   * Handle presence events from WebSocket
   */
  const handlePresenceEvent = useCallback(
    (event: RealtimeEvent) => {
      // Skip REST event handling when Yjs awareness is active
      if (!useRestPresence) return;

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
    [noteId, useRestPresence],
  );

  /**
   * Subscribe to WebSocket events when available (REST-based only)
   */
  useEffect(() => {
    if (!realtimeContext || !useRestPresence) return;

    const eventTypes = ['note:presence_joined', 'note:presence_left', 'note:presence_list', 'note:presence_cursor'] as const;

    // Subscribe to each event type
    const unsubscribes = eventTypes.map((type) => realtimeContext.subscribe(type, handlePresenceEvent));

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [realtimeContext, handlePresenceEvent, useRestPresence]);

  /**
   * Reconnect presence when WebSocket reconnects (#699)
   */
  useEffect(() => {
    if (!realtimeContext || !useRestPresence) return;

    const currentStatus = realtimeContext.status;
    const previousStatus = previousStatusRef.current;

    // If we transitioned from a non-connected state to connected, re-join
    if (previousStatus !== null && previousStatus !== 'connected' && currentStatus === 'connected' && hasJoinedRef.current) {
      // Reset the joined flag to allow re-joining
      hasJoinedRef.current = false;
      void join();
    }

    previousStatusRef.current = currentStatus;
  }, [realtimeContext, realtimeContext?.status, join, useRestPresence]);

  /**
   * Clean up stale presence viewers (#700) — REST-based only
   */
  useEffect(() => {
    if (!useRestPresence) return;

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
  }, [useRestPresence]);

  /**
   * Auto-join on mount, leave on unmount — REST-based only
   */
  useEffect(() => {
    if (!useRestPresence) return;

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
      void leave();
    };
  }, [autoJoin, join, leave, useRestPresence]);

  return {
    viewers,
    isConnected,
    error,
    join,
    leave,
    updateCursor,
  };
}
