/**
 * TanStack Query hooks for chat sessions, messages, and agents (Epic #1940).
 *
 * Issue #2080: Uses WebSocket push for real-time cache invalidation
 * instead of aggressive polling.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import {
  chatSessionsResponseSchema,
  chatMessagesResponseSchema,
  chatAgentsResponseSchema,
  unreadCountResponseSchema,
} from '@/ui/lib/api-schemas.ts';
import type {
  ChatSessionsResponse,
  ChatMessagesResponse,
  ChatAgentsResponse,
} from '@/ui/lib/api-types.ts';
import { useRealtimeOptional } from '@/ui/components/realtime/realtime-context.tsx';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';
import { namespaceAwareInvalidation } from '@/ui/lib/namespace-invalidation';

/** Query key factory for chat. */
export const chatKeys = {
  all: ['chat'] as const,
  sessions: () => [...chatKeys.all, 'sessions'] as const,
  sessionsList: (status?: string) => [...chatKeys.sessions(), 'list', status] as const,
  session: (id: string) => [...chatKeys.sessions(), 'detail', id] as const,
  messages: (sessionId: string) => [...chatKeys.all, 'messages', sessionId] as const,
  messagesCursor: (sessionId: string, cursor?: string) => [...chatKeys.messages(sessionId), cursor] as const,
  agents: () => [...chatKeys.all, 'agents'] as const,
  unreadCount: () => [...chatKeys.all, 'unread-count'] as const,
};

/**
 * Subscribes to WebSocket `chat:message_received` events and invalidates
 * the chat unread count cache when one arrives.
 *
 * Issue #2080: Replaces 30-second polling with push-based invalidation.
 */
export function useRealtimeChatInvalidation(): void {
  const realtime = useRealtimeOptional();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!realtime) return;

    const cleanupMsg = realtime.addEventHandler('chat:message_received', (event) => {
      void queryClient.invalidateQueries(namespaceAwareInvalidation(chatKeys.unreadCount()));
      void queryClient.invalidateQueries(namespaceAwareInvalidation(chatKeys.sessions()));
      // Invalidate messages for the specific session so agent replies appear (#2493)
      const payload = event.payload as { session_id?: string } | null;
      if (typeof payload?.session_id === 'string') {
        void queryClient.invalidateQueries(namespaceAwareInvalidation(chatKeys.messages(payload.session_id)));
      }
    });

    const cleanupSession = realtime.addEventHandler('chat:session_created', () => {
      void queryClient.invalidateQueries(namespaceAwareInvalidation(chatKeys.sessions()));
    });

    const cleanupEnded = realtime.addEventHandler('chat:session_ended', () => {
      void queryClient.invalidateQueries(namespaceAwareInvalidation(chatKeys.sessions()));
    });

    return () => {
      cleanupMsg();
      cleanupSession();
      cleanupEnded();
    };
  }, [realtime, queryClient]);
}

/**
 * Invalidate agent cache on status changes (Issue #2424 — AD-9).
 *
 * Consolidates agent:status_changed handling so all consumers of
 * chatKeys.agents() get invalidated. Call from ChatBubble (always mounted).
 */
export function useRealtimeAgentInvalidation(): void {
  const realtime = useRealtimeOptional();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!realtime) return;
    const cleanup = realtime.addEventHandler('agent:status_changed', () => {
      void queryClient.invalidateQueries(namespaceAwareInvalidation(chatKeys.agents()));
    });
    return cleanup;
  }, [realtime, queryClient]);
}

/**
 * Fetch chat sessions list.
 *
 * @param status - Optional filter by session status (active, ended, expired)
 */
export function useChatSessions(status?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const qs = params.toString();

  const queryKey = useNamespaceQueryKey(chatKeys.sessionsList(status));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<ChatSessionsResponse>(
        `/chat/sessions${qs ? `?${qs}` : ''}`,
        { signal, schema: chatSessionsResponseSchema },
      ),
  });
}

/**
 * Fetch chat messages for a session with cursor pagination.
 *
 * @param sessionId - The chat session UUID
 * @param cursor - Optional cursor for pagination
 */
export function useChatMessages(sessionId: string, cursor?: string) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();

  const queryKey = useNamespaceQueryKey(chatKeys.messagesCursor(sessionId, cursor));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<ChatMessagesResponse>(
        `/chat/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`,
        { signal, schema: chatMessagesResponseSchema },
      ),
    enabled: !!sessionId,
  });
}

/**
 * Fetch available agents for chat.
 */
export function useAvailableAgents() {
  const queryKey = useNamespaceQueryKey(chatKeys.agents());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<ChatAgentsResponse>(
        '/chat/agents',
        { signal, schema: chatAgentsResponseSchema },
      ),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Fetch unread chat message count across all sessions.
 *
 * Issue #2080: Polling reduced to 5-minute fallback. Primary updates
 * arrive via WebSocket events (see useRealtimeChatInvalidation).
 */
export function useChatUnreadCount() {
  const queryKey = useNamespaceQueryKey(chatKeys.unreadCount());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<{ count: number }>(
        '/chat/sessions/unread-count',
        { signal, schema: unreadCountResponseSchema },
      ),
    refetchInterval: 300_000,
  });
}
