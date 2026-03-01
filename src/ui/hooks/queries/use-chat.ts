/**
 * TanStack Query hooks for chat sessions, messages, and agents (Epic #1940).
 *
 * Provides queries for chat sessions list, messages with cursor pagination,
 * available agents, and unread counts.
 */
import { useQuery } from '@tanstack/react-query';
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
 * Fetch chat sessions list.
 *
 * @param status - Optional filter by session status (active, ended, expired)
 */
export function useChatSessions(status?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const qs = params.toString();

  return useQuery({
    queryKey: chatKeys.sessionsList(status),
    queryFn: ({ signal }) =>
      apiClient.get<ChatSessionsResponse>(
        `/api/chat/sessions${qs ? `?${qs}` : ''}`,
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

  return useQuery({
    queryKey: chatKeys.messagesCursor(sessionId, cursor),
    queryFn: ({ signal }) =>
      apiClient.get<ChatMessagesResponse>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`,
        { signal, schema: chatMessagesResponseSchema },
      ),
    enabled: !!sessionId,
  });
}

/**
 * Fetch available agents for chat.
 */
export function useAvailableAgents() {
  return useQuery({
    queryKey: chatKeys.agents(),
    queryFn: ({ signal }) =>
      apiClient.get<ChatAgentsResponse>(
        '/api/chat/agents',
        { signal, schema: chatAgentsResponseSchema },
      ),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Fetch unread chat message count across all sessions.
 * Polls every 30 seconds to keep the badge current.
 */
export function useChatUnreadCount() {
  return useQuery({
    queryKey: chatKeys.unreadCount(),
    queryFn: ({ signal }) =>
      apiClient.get<{ count: number }>(
        '/api/chat/sessions/unread-count',
        { signal, schema: unreadCountResponseSchema },
      ),
    refetchInterval: 30_000,
  });
}
