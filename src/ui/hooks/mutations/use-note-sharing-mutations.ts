/**
 * TanStack Query mutation hooks for note sharing.
 *
 * Provides mutations for creating, updating, and revoking note shares.
 * Includes cache invalidation for related queries.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  NoteUserShare,
  CreateUserShareBody,
  CreateLinkShareBody,
  CreateLinkShareResponse,
  UpdateShareBody,
  NoteShare,
} from '@/ui/lib/api-types.ts';
import { noteKeys } from '@/ui/hooks/queries/use-notes.ts';

/**
 * Share a note with a specific user.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useShareNoteWithUser();
 * mutate({ noteId: 'note-123', body: { email: 'user@example.com', permission: 'read' } });
 * ```
 */
export function useShareNoteWithUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: CreateUserShareBody }) =>
      apiClient.post<NoteUserShare>(
        `/api/notes/${encodeURIComponent(noteId)}/share`,
        body
      ),

    onSuccess: (_, { noteId }) => {
      // Invalidate shares for this note
      queryClient.invalidateQueries({ queryKey: noteKeys.shares(noteId) });

      // Invalidate the note detail (visibility may have changed)
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(noteId) });
    },
  });
}

/**
 * Create a shareable link for a note.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useCreateNoteShareLink();
 * mutate({ noteId: 'note-123', body: { permission: 'read', maxViews: 10 } });
 * ```
 */
export function useCreateNoteShareLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: CreateLinkShareBody }) =>
      apiClient.post<CreateLinkShareResponse>(
        `/api/notes/${encodeURIComponent(noteId)}/share/link`,
        body
      ),

    onSuccess: (_, { noteId }) => {
      // Invalidate shares for this note
      queryClient.invalidateQueries({ queryKey: noteKeys.shares(noteId) });

      // Invalidate the note detail (visibility may have changed)
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(noteId) });
    },
  });
}

/**
 * Update an existing share's permission or expiration.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useUpdateNoteShare();
 * mutate({ noteId: 'note-123', shareId: 'share-456', body: { permission: 'read_write' } });
 * ```
 */
export function useUpdateNoteShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      noteId,
      shareId,
      body,
    }: {
      noteId: string;
      shareId: string;
      body: UpdateShareBody;
    }) =>
      apiClient.put<NoteShare>(
        `/api/notes/${encodeURIComponent(noteId)}/shares/${encodeURIComponent(shareId)}`,
        body
      ),

    onSuccess: (_, { noteId }) => {
      // Invalidate shares for this note
      queryClient.invalidateQueries({ queryKey: noteKeys.shares(noteId) });
    },
  });
}

/**
 * Revoke a note share.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useRevokeNoteShare();
 * mutate({ noteId: 'note-123', shareId: 'share-456' });
 * ```
 */
export function useRevokeNoteShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, shareId }: { noteId: string; shareId: string }) =>
      apiClient.delete(
        `/api/notes/${encodeURIComponent(noteId)}/shares/${encodeURIComponent(shareId)}`
      ),

    onSuccess: (_, { noteId }) => {
      // Invalidate shares for this note
      queryClient.invalidateQueries({ queryKey: noteKeys.shares(noteId) });

      // Invalidate the note detail (visibility may have changed)
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(noteId) });

      // Invalidate shared-with-me in case this was a share we were receiving
      queryClient.invalidateQueries({ queryKey: noteKeys.sharedWithMe() });
    },
  });
}
