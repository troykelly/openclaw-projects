/**
 * TanStack Query mutation hooks for note sharing.
 *
 * Provides mutations for creating, updating, and revoking note shares.
 * Supports both user-based sharing (by email) and link-based sharing.
 * All mutations automatically invalidate relevant cached queries on success.
 * Mutations include optimistic updates for better UX and proper error handling.
 *
 * @module use-note-sharing-mutations
 *
 * @example Error handling
 * ```ts
 * import { ApiRequestError } from '@/ui/lib/api-client';
 *
 * const { mutate } = useShareNoteWithUser();
 *
 * mutate(
 *   { noteId: 'note-123', body: { email: 'user@example.com', permission: 'read' } },
 *   {
 *     onError: (error) => {
 *       if (error instanceof ApiRequestError) {
 *         if (error.status === 404) {
 *           toast.error('User not found');
 *         } else {
 *           toast.error(error.message);
 *         }
 *       }
 *     },
 *   }
 * );
 * ```
 *
 * @example Optimistic updates
 * ```ts
 * const { mutate } = useRevokeNoteShare();
 *
 * // Share is removed immediately from the UI, then synced with server
 * mutate({ noteId: 'note-123', shareId: 'share-456' });
 * // If server rejects, UI automatically rolls back
 * ```
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { ApiRequestError } from '@/ui/lib/api-client.ts';
import type {
  NoteUserShare,
  NoteSharesResponse,
  CreateUserShareBody,
  CreateLinkShareBody,
  CreateLinkShareResponse,
  UpdateShareBody,
  NoteShare,
} from '@/ui/lib/api-types.ts';
import { noteKeys } from '@/ui/hooks/queries/use-notes.ts';

/**
 * Variables for the shareNoteWithUser mutation.
 */
export interface ShareNoteWithUserVariables {
  /** The note ID to share. */
  noteId: string;
  /** The share details (email and permission). */
  body: CreateUserShareBody;
}

/**
 * Variables for the createNoteShareLink mutation.
 */
export interface CreateNoteShareLinkVariables {
  /** The note ID to create a share link for. */
  noteId: string;
  /** The link settings (permission, expiration, view limits). */
  body: CreateLinkShareBody;
}

/**
 * Variables for the updateNoteShare mutation.
 */
export interface UpdateNoteShareVariables {
  /** The note ID the share belongs to. */
  noteId: string;
  /** The share ID to update. */
  shareId: string;
  /** The fields to update (permission, expiration). */
  body: UpdateShareBody;
}

/**
 * Variables for the revokeNoteShare mutation.
 */
export interface RevokeNoteShareVariables {
  /** The note ID the share belongs to. */
  noteId: string;
  /** The share ID to revoke. */
  shareId: string;
}

/**
 * Share a note with a specific user.
 *
 * Creates a user-based share that grants access to a specific email address.
 * The user must have an account to access the shared note.
 *
 * On success, invalidates:
 * - Shares query for this note
 * - Note detail query (visibility status may change)
 *
 * @returns TanStack mutation result with:
 *   - `mutate({ noteId, body })` - Trigger the mutation
 *   - `mutateAsync({ noteId, body })` - Trigger and return a Promise
 *   - `data` - The created {@link NoteUserShare} on success
 *   - `error` - {@link ApiRequestError} on failure (404 if user not found)
 *   - `isPending` - Loading state
 *   - `isSuccess` / `isError` - Result states
 *
 * @example Basic usage
 * ```ts
 * const { mutate, isPending } = useShareNoteWithUser();
 *
 * mutate({
 *   noteId: 'note-123',
 *   body: { email: 'colleague@example.com', permission: 'read' },
 * });
 * ```
 *
 * @example With read_write permission
 * ```ts
 * const { mutate } = useShareNoteWithUser();
 *
 * mutate(
 *   {
 *     noteId: noteId,
 *     body: { email: userEmail, permission: 'read_write' },
 *   },
 *   {
 *     onSuccess: (share) => {
 *       toast.success(`Shared with ${share.sharedWithEmail}`);
 *     },
 *     onError: (error) => {
 *       if (error.status === 404) {
 *         toast.error('User not found. They may need to create an account first.');
 *       } else {
 *         toast.error(error.message);
 *       }
 *     },
 *   }
 * );
 * ```
 *
 * @example In a share dialog
 * ```ts
 * const { mutate, isPending } = useShareNoteWithUser();
 *
 * const handleShare = (email: string, permission: 'read' | 'read_write') => {
 *   mutate(
 *     { noteId, body: { email, permission } },
 *     { onSuccess: () => setDialogOpen(false) }
 *   );
 * };
 * ```
 */
export function useShareNoteWithUser(): UseMutationResult<
  NoteUserShare,
  ApiRequestError,
  ShareNoteWithUserVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, body }: ShareNoteWithUserVariables) =>
      apiClient.post<NoteUserShare>(
        `/api/notes/${encodeURIComponent(noteId)}/share`,
        body
      ),

    onSuccess: (_, { noteId }) => {
      // Invalidate shares and note detail for this note
      queryClient.invalidateQueries({ queryKey: noteKeys.shares(noteId) });
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(noteId) });
    },

    onError: (error) => {
      console.error(
        '[useShareNoteWithUser] Failed to share note:',
        error.message
      );
    },
  });
}

/**
 * Create a shareable link for a note.
 *
 * Creates a link-based share that can be accessed by anyone with the link.
 * Links can have optional expiration dates and view limits.
 *
 * On success, invalidates:
 * - Shares query for this note
 * - Note detail query (visibility status may change)
 *
 * @returns TanStack mutation result with:
 *   - `mutate({ noteId, body })` - Trigger the mutation
 *   - `mutateAsync({ noteId, body })` - Trigger and return a Promise
 *   - `data` - {@link CreateLinkShareResponse} containing the share URL and token
 *   - `error` - {@link ApiRequestError} on failure
 *   - `isPending` - Loading state
 *
 * @example Basic read-only link
 * ```ts
 * const { mutate, isPending } = useCreateNoteShareLink();
 *
 * mutate({
 *   noteId: 'note-123',
 *   body: { permission: 'read' },
 * });
 * ```
 *
 * @example Link with expiration and view limit
 * ```ts
 * const { mutate } = useCreateNoteShareLink();
 *
 * mutate(
 *   {
 *     noteId: noteId,
 *     body: {
 *       permission: 'read',
 *       expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
 *       maxViews: 10,
 *     },
 *   },
 *   {
 *     onSuccess: (response) => {
 *       navigator.clipboard.writeText(response.shareUrl);
 *       toast.success('Link copied to clipboard');
 *     },
 *   }
 * );
 * ```
 *
 * @example Editable link
 * ```ts
 * mutate({
 *   noteId: 'note-123',
 *   body: { permission: 'read_write' },
 * });
 * ```
 */
export function useCreateNoteShareLink(): UseMutationResult<
  CreateLinkShareResponse,
  ApiRequestError,
  CreateNoteShareLinkVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, body }: CreateNoteShareLinkVariables) =>
      apiClient.post<CreateLinkShareResponse>(
        `/api/notes/${encodeURIComponent(noteId)}/share/link`,
        body
      ),

    onSuccess: (_, { noteId }) => {
      // Invalidate shares and note detail for this note
      queryClient.invalidateQueries({ queryKey: noteKeys.shares(noteId) });
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(noteId) });
    },

    onError: (error) => {
      console.error(
        '[useCreateNoteShareLink] Failed to create share link:',
        error.message
      );
    },
  });
}

/**
 * Update an existing share's permission or expiration.
 *
 * Modifies an existing share without revoking it. Can change permission level
 * or update expiration settings.
 *
 * On success, invalidates:
 * - Shares query for this note
 *
 * Note: Does not invalidate note detail since visibility status is unchanged.
 *
 * @returns TanStack mutation result with:
 *   - `mutate({ noteId, shareId, body })` - Trigger the mutation
 *   - `mutateAsync({ noteId, shareId, body })` - Trigger and return a Promise
 *   - `data` - The updated {@link NoteShare} on success
 *   - `error` - {@link ApiRequestError} on failure (404 if share not found)
 *   - `isPending` - Loading state
 *
 * @example Change permission
 * ```ts
 * const { mutate } = useUpdateNoteShare();
 *
 * mutate({
 *   noteId: 'note-123',
 *   shareId: 'share-456',
 *   body: { permission: 'read_write' },
 * });
 * ```
 *
 * @example Update expiration
 * ```ts
 * const { mutate, isPending } = useUpdateNoteShare();
 *
 * mutate(
 *   {
 *     noteId,
 *     shareId,
 *     body: {
 *       expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
 *     },
 *   },
 *   {
 *     onSuccess: () => toast.success('Share updated'),
 *     onError: (error) => toast.error(error.message),
 *   }
 * );
 * ```
 *
 * @example Downgrade to read-only
 * ```ts
 * mutate({
 *   noteId: 'note-123',
 *   shareId: 'share-456',
 *   body: { permission: 'read' },
 * });
 * ```
 */
export function useUpdateNoteShare(): UseMutationResult<
  NoteShare,
  ApiRequestError,
  UpdateNoteShareVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, shareId, body }: UpdateNoteShareVariables) =>
      apiClient.put<NoteShare>(
        `/api/notes/${encodeURIComponent(noteId)}/shares/${encodeURIComponent(shareId)}`,
        body
      ),

    onMutate: async ({ noteId, shareId, body }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: noteKeys.shares(noteId) });

      // Snapshot previous value
      const previousShares = queryClient.getQueryData<NoteSharesResponse>(
        noteKeys.shares(noteId)
      );

      // Optimistically update the share
      if (previousShares) {
        queryClient.setQueryData<NoteSharesResponse>(noteKeys.shares(noteId), {
          ...previousShares,
          shares: previousShares.shares.map((share) =>
            share.id === shareId ? { ...share, ...body } : share
          ),
        });
      }

      return { previousShares };
    },

    onError: (error, { noteId }, context) => {
      // Roll back on error
      if (context?.previousShares) {
        queryClient.setQueryData(noteKeys.shares(noteId), context.previousShares);
      }
      console.error(
        '[useUpdateNoteShare] Failed to update share:',
        error.message
      );
    },

    onSettled: (_, _error, { noteId }) => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: noteKeys.shares(noteId) });
    },
  });
}

/**
 * Revoke a note share.
 *
 * Permanently removes access for a user share or invalidates a link share.
 * The share cannot be recovered after revocation.
 *
 * On success, invalidates:
 * - Shares query for this note
 * - Note detail query (may become private if last share)
 * - Shared-with-me query (in case this was a share the current user received)
 *
 * @returns TanStack mutation result with:
 *   - `mutate({ noteId, shareId })` - Trigger the mutation
 *   - `mutateAsync({ noteId, shareId })` - Trigger and return a Promise
 *   - `data` - `void` on success
 *   - `error` - {@link ApiRequestError} on failure (404 if share not found)
 *   - `isPending` - Loading state
 *
 * @example Basic usage
 * ```ts
 * const { mutate } = useRevokeNoteShare();
 *
 * mutate({ noteId: 'note-123', shareId: 'share-456' });
 * ```
 *
 * @example With confirmation
 * ```ts
 * const { mutate, isPending } = useRevokeNoteShare();
 *
 * const handleRevoke = (share: NoteShare) => {
 *   const message = share.type === 'user'
 *     ? `Remove ${share.sharedWithEmail}'s access?`
 *     : 'Invalidate this share link?';
 *
 *   if (confirm(message)) {
 *     mutate(
 *       { noteId, shareId: share.id },
 *       {
 *         onSuccess: () => toast.success('Share revoked'),
 *         onError: (error) => toast.error(error.message),
 *       }
 *     );
 *   }
 * };
 * ```
 *
 * @example In a shares list
 * ```ts
 * const { mutate, isPending } = useRevokeNoteShare();
 *
 * {shares.map((share) => (
 *   <button
 *     key={share.id}
 *     disabled={isPending}
 *     onClick={() => mutate({ noteId, shareId: share.id })}
 *   >
 *     Revoke
 *   </button>
 * ))}
 * ```
 */
export function useRevokeNoteShare(): UseMutationResult<
  void,
  ApiRequestError,
  RevokeNoteShareVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, shareId }: RevokeNoteShareVariables) =>
      apiClient.delete(
        `/api/notes/${encodeURIComponent(noteId)}/shares/${encodeURIComponent(shareId)}`
      ),

    onMutate: async ({ noteId, shareId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: noteKeys.shares(noteId) });

      // Snapshot previous value
      const previousShares = queryClient.getQueryData<NoteSharesResponse>(
        noteKeys.shares(noteId)
      );

      // Optimistically remove the share
      if (previousShares) {
        queryClient.setQueryData<NoteSharesResponse>(noteKeys.shares(noteId), {
          ...previousShares,
          shares: previousShares.shares.filter((share) => share.id !== shareId),
        });
      }

      return { previousShares };
    },

    onError: (error, { noteId }, context) => {
      // Roll back on error
      if (context?.previousShares) {
        queryClient.setQueryData(noteKeys.shares(noteId), context.previousShares);
      }
      console.error(
        '[useRevokeNoteShare] Failed to revoke share:',
        error.message
      );
    },

    onSettled: (_, _error, { noteId }) => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: noteKeys.shares(noteId) });
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(noteId) });
      queryClient.invalidateQueries({ queryKey: noteKeys.sharedWithMe() });
    },
  });
}
