/**
 * TanStack Query mutation hooks for chat (Epic #1940).
 *
 * Provides mutations for creating sessions, sending messages,
 * ending sessions, and updating session titles.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { chatKeys } from '@/ui/hooks/queries/use-chat.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';
import type {
  ChatSession,
  ChatMessage,
  CreateChatSessionBody,
  SendChatMessageBody,
  UpdateChatSessionBody,
} from '@/ui/lib/api-types.ts';

/** Create a new chat session. */
export function useCreateChatSession() {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: CreateChatSessionBody) =>
      apiClient.post<ChatSession>('/chat/sessions', body),
    onSuccess: () => {
      nsInvalidate(chatKeys.sessions());
    },
  });
}

/** Send a message in a chat session. */
export function useSendChatMessage(sessionId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: SendChatMessageBody) =>
      apiClient.post<ChatMessage>(
        `/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
        body,
      ),
    onSuccess: () => {
      nsInvalidate(chatKeys.messages(sessionId));
      nsInvalidate(chatKeys.sessions());
    },
  });
}

/** End a chat session. */
export function useEndChatSession() {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (sessionId: string) =>
      apiClient.post(`/chat/sessions/${encodeURIComponent(sessionId)}/end`, {}),
    onSuccess: () => {
      nsInvalidate(chatKeys.sessions());
    },
  });
}

/** Update a chat session title. */
export function useUpdateChatSession(sessionId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: UpdateChatSessionBody) =>
      apiClient.patch<ChatSession>(
        `/chat/sessions/${encodeURIComponent(sessionId)}`,
        body,
      ),
    onSuccess: () => {
      nsInvalidate(chatKeys.sessions());
      nsInvalidate(chatKeys.session(sessionId));
    },
  });
}
