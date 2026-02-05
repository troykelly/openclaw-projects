/**
 * Note history panel component.
 * Part of Epic #338, Issue #659 (component splitting).
 *
 * Displays version history for a note with restore capability.
 * Extracted from NotesPage.tsx to reduce component size.
 * Updated with restore functionality (#658).
 */
import { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import {
  Skeleton,
  SkeletonList,
  ErrorState,
} from '@/ui/components/feedback';
import { VersionHistory } from '@/ui/components/notes';
import { useNoteVersions } from '@/ui/hooks/queries/use-notes';
import { useRestoreNoteVersion } from '@/ui/hooks/mutations/use-note-mutations';

interface NoteHistoryPanelProps {
  noteId: string;
  onClose: () => void;
}

export function NoteHistoryPanel({ noteId, onClose }: NoteHistoryPanelProps) {
  const { data: versionsData, isLoading, isError, refetch } = useNoteVersions(noteId);
  const restoreVersionMutation = useRestoreNoteVersion();
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Handle version restore
  const handleRestore = useCallback(
    async (version: { version: number }) => {
      setRestoreError(null);
      try {
        await restoreVersionMutation.mutateAsync({
          id: noteId,
          versionNumber: version.version,
        });
        // Refetch versions to show updated state
        refetch();
        // Close panel after successful restore
        onClose();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to restore version';
        setRestoreError(message);
      }
    },
    [noteId, restoreVersionMutation, refetch, onClose]
  );

  if (isLoading) {
    return (
      <div className="flex-1 p-6">
        <div className="flex items-center justify-between mb-4">
          <Skeleton width={200} height={24} />
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close history">
            <X className="size-4" />
          </Button>
        </div>
        <SkeletonList count={5} variant="text" />
      </div>
    );
  }

  if (isError || !versionsData) {
    return (
      <div className="flex-1 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Version History</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close history">
            <X className="size-4" />
          </Button>
        </div>
        <ErrorState
          type="generic"
          title="Failed to load versions"
          description="Unable to load version history for this note."
        />
      </div>
    );
  }

  // Transform to UI version format
  const versions = versionsData.versions.map((v) => ({
    id: v.id,
    noteId: versionsData.noteId,
    version: v.versionNumber,
    title: v.title,
    content: '', // Content not in summary
    changedBy: v.changedByEmail ?? 'Unknown',
    changedAt: new Date(v.createdAt),
    changeReason: v.changeType,
  }));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">Version History</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close history">
          <X className="size-4" />
        </Button>
      </div>
      {/* Restore error display */}
      {restoreError && (
        <div
          className="mx-4 mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {restoreError}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <VersionHistory
          versions={versions}
          currentVersion={versionsData.currentVersion}
          onRestore={handleRestore}
          className="h-full"
        />
      </div>
    </div>
  );
}
