/**
 * Note history panel component.
 * Part of Epic #338, Issue #659 (component splitting).
 *
 * Displays version history for a note with restore capability.
 * Extracted from NotesPage.tsx to reduce component size.
 */
import { X } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import {
  Skeleton,
  SkeletonList,
  ErrorState,
} from '@/ui/components/feedback';
import { VersionHistory } from '@/ui/components/notes';
import { useNoteVersions } from '@/ui/hooks/queries/use-notes';

interface NoteHistoryPanelProps {
  noteId: string;
  onClose: () => void;
}

export function NoteHistoryPanel({ noteId, onClose }: NoteHistoryPanelProps) {
  const { data: versionsData, isLoading, isError } = useNoteVersions(noteId);

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
      <div className="flex-1 overflow-auto">
        <VersionHistory
          versions={versions}
          currentVersion={versionsData.currentVersion}
          onRestore={(version) => {
            // TODO: Implement restore functionality (#658)
            // This is tracked in a separate issue
          }}
          className="h-full"
        />
      </div>
    </div>
  );
}
