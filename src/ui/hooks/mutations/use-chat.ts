/**
 * TanStack Query mutation hooks for chat (Epic #1940).
 *
 * Provides mutations for creating sessions, sending messages,
 * ending sessions, and updating session titles.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { chatKeys } from '@/ui/hooks/queries/use-chat.ts';
import type {
  ChatSession,
  ChatMessage,
  CreateChatSessionBody,
  SendChatMessageBody,
  UpdateChatSessionBody,
} from '@/ui/lib/api-types.ts';

/** Create a new chat session. */
export function useCreateChatSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateChatSessionBody) =>
      apiClient.post<ChatSession>('/api/chat/sessions', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.sessions() });
    },
  });
}

/** Send a message in a chat session. */
export function useSendChatMessage(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SendChatMessageBody) =>
      apiClient.post<ChatMessage>(
        `/api/chat/sessions/${sessionId}/messages`,
        body,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
      queryClient.invalidateQueries({ queryKey: chatKeys.sessions() });
    },
  });
}

/** End a chat session. */
export function useEndChatSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      apiClient.post(`/api/chat/sessions/${sessionId}/end`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.sessions() });
    },
  });
}

/** Update a chat session title. */
export function useUpdateChatSession(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateChatSessionBody) =>
      apiClient.patch<ChatSession>(
        `/api/chat/sessions/${sessionId}`,
        body,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.sessions() });
      queryClient.invalidateQueries({ queryKey: chatKeys.session(sessionId) });
    },
  });
}
