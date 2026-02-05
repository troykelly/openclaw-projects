/**
 * Share dialog wrapper component.
 * Part of Epic #338, Issue #659 (component splitting).
 *
 * Wraps the ShareDialog component with API data fetching.
 * Extracted from NotesPage.tsx to reduce component size.
 */
import { useMemo } from 'react';
import { ShareDialog } from '@/ui/components/notes';
import { useNoteShares } from '@/ui/hooks/queries/use-notes';

interface ShareDialogWrapperProps {
  noteId: string;
  onClose: () => void;
  onShare: (email: string, permission: 'read' | 'read_write') => Promise<void>;
  onRevoke: (shareId: string) => Promise<void>;
}

export function ShareDialogWrapper({
  noteId,
  onClose,
  onShare,
  onRevoke,
}: ShareDialogWrapperProps) {
  const { data: sharesData, isLoading } = useNoteShares(noteId);

  // Transform API shares to UI shares
  const shares = useMemo(() => {
    if (!sharesData?.shares) return [];
    return sharesData.shares
      .filter((s): s is Extract<typeof s, { type: 'user' }> => s.type === 'user')
      .map((s) => ({
        id: s.id,
        noteId: s.noteId,
        sharedWithEmail: s.sharedWithEmail,
        permission: s.permission === 'read_write' ? 'edit' as const : 'view' as const,
        createdAt: new Date(s.createdAt),
        createdBy: s.createdByEmail,
      }));
  }, [sharesData?.shares]);

  return (
    <ShareDialog
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      noteTitle="Note"
      shares={shares}
      onShare={async (email, permission) => {
        await onShare(email, permission === 'edit' ? 'read_write' : 'read');
      }}
      onRevoke={onRevoke}
      loading={isLoading}
    />
  );
}
