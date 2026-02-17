/**
 * Share dialog wrapper component.
 * Part of Epic #338, Issues #659, #660, #663, #665 (component splitting, error handling, loading states).
 *
 * Wraps the ShareDialog component with API data fetching.
 * Extracted from NotesPage.tsx to reduce component size.
 */
import { useMemo, useCallback } from 'react';
import { ShareDialog } from '@/ui/components/notes';
import { useNoteShares, useNote } from '@/ui/hooks/queries/use-notes';
import type { Note } from '@/ui/components/notes';

interface ShareDialogWrapperProps {
  noteId: string;
  onClose: () => void;
  onShare: (email: string, permission: 'read' | 'read_write') => Promise<void>;
  onRevoke: (shareId: string) => Promise<void>;
  /** External loading state for share operation (#663) */
  isSharing?: boolean;
  /** External loading state for revoke operation (#663) */
  isRevoking?: boolean;
}

export function ShareDialogWrapper({ noteId, onClose, onShare, onRevoke, isSharing, isRevoking }: ShareDialogWrapperProps) {
  const { data: sharesData, isLoading: sharesLoading } = useNoteShares(noteId);
  const { data: noteData, isLoading: noteLoading } = useNote(noteId);

  // Transform API shares to UI shares
  const shares = useMemo(() => {
    if (!sharesData?.shares) return [];
    return sharesData.shares
      .filter((s): s is Extract<typeof s, { type: 'user' }> => s.type === 'user')
      .map((s) => ({
        id: s.id,
        noteId: s.noteId,
        sharedWithEmail: s.sharedWithEmail,
        permission: s.permission === 'read_write' ? ('edit' as const) : ('view' as const),
        created_at: new Date(s.created_at),
        createdBy: s.createdByEmail,
      }));
  }, [sharesData?.shares]);

  // Create a minimal note object for the ShareDialog (#663)
  const note: Note = useMemo(
    () => ({
      id: noteId,
      title: noteData?.title ?? 'Note',
      content: noteData?.content ?? '',
      visibility: noteData?.visibility ?? 'private',
      hideFromAgents: noteData?.hideFromAgents ?? false,
      isPinned: noteData?.isPinned ?? false,
      created_at: noteData?.created_at ? new Date(noteData.created_at) : new Date(),
      updated_at: noteData?.updated_at ? new Date(noteData.updated_at) : new Date(),
    }),
    [noteId, noteData],
  );

  // Memoized close handler (#665)
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  // Memoized share handler with permission conversion (#665)
  const handleShare = useCallback(
    async (email: string, permission: 'view' | 'edit') => {
      await onShare(email, permission === 'edit' ? 'read_write' : 'read');
    },
    [onShare],
  );

  return (
    <ShareDialog
      open={true}
      onOpenChange={handleOpenChange}
      note={note}
      shares={shares}
      onAddShare={handleShare}
      onRemoveShare={onRevoke}
      className={isSharing || isRevoking ? 'pointer-events-auto' : undefined}
    />
  );
}
