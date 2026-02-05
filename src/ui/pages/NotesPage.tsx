/**
 * Notes page component.
 * Part of Epic #338, Issues #624, #625
 *
 * Primary notes interface with three-panel layout:
 * - Notebooks sidebar (collapsible)
 * - Notes list with search/filter
 * - Note detail/editor panel
 *
 * Responsive: mobile uses stacked view, desktop uses side-by-side panels.
 *
 * URL structure:
 * - /notes - All notes
 * - /notes/:noteId - Direct link to specific note
 * - /notebooks/:notebookId - Notes in specific notebook
 * - /notebooks/:notebookId/notes/:noteId - Note in context of notebook
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import {
  Skeleton,
  SkeletonList,
  ErrorState,
  EmptyState,
} from '@/ui/components/feedback';
import { Card, CardContent } from '@/ui/components/ui/card';

// Notes components
import {
  NotesList,
  NoteDetail,
} from '@/ui/components/notes';
import { NotebooksSidebar } from '@/ui/components/notebooks/notebooks-sidebar';

// Query hooks
import { useNotes } from '@/ui/hooks/queries/use-notes';
import { useNotebooks } from '@/ui/hooks/queries/use-notebooks';
import {
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
} from '@/ui/hooks/mutations/use-note-mutations';
import {
  useCreateNotebook,
  useUpdateNotebook,
  useDeleteNotebook,
} from '@/ui/hooks/mutations/use-notebook-mutations';
import {
  useShareNoteWithUser,
  useRevokeNoteShare,
} from '@/ui/hooks/mutations/use-note-sharing-mutations';

// Extracted components (#659)
import {
  NotebookFormDialog,
  ShareDialogWrapper,
  NoteHistoryPanel,
  toUINote,
  toUINotebook,
} from './notes';
import type { ViewState, DialogState } from './notes';

// Types
import type {
  NoteVisibility,
  CreateNoteBody,
  UpdateNoteBody,
} from '@/ui/lib/api-types';
import type {
  Note as UINote,
  Notebook as UINotebook,
} from '@/ui/components/notes/types';

export function NotesPage(): React.JSX.Element {
  // URL params for deep linking
  const { noteId: urlNoteId, notebookId: urlNotebookId } = useParams<{
    noteId?: string;
    notebookId?: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();

  // View state
  const [view, setView] = useState<ViewState>({ type: 'list' });
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | undefined>(urlNotebookId);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Sync notebook ID from URL - separated from view sync to avoid race conditions (#668)
  useEffect(() => {
    // Only react to URL changes, using functional update to avoid stale state
    setSelectedNotebookId((current) => {
      if (urlNotebookId !== current) {
        return urlNotebookId;
      }
      return current;
    });
  }, [urlNotebookId]);

  // Sync note view state from URL - separated from notebook sync (#668)
  useEffect(() => {
    if (urlNoteId) {
      setView({ type: 'detail', noteId: urlNoteId });
    } else {
      // Use functional update to check current state without adding to deps
      setView((current) => {
        // If in detail/history view and URL has no noteId, go back to list
        // (skip if this is an internal navigation via location.state)
        if (
          (current.type === 'detail' || current.type === 'history') &&
          !location.state?.internal
        ) {
          return { type: 'list' };
        }
        return current;
      });
    }
  }, [urlNoteId, location.state]);

  // Query hooks
  const {
    data: notesData,
    isLoading: notesLoading,
    isError: notesError,
    error: notesErrorObj,
    refetch: refetchNotes,
  } = useNotes({ notebookId: selectedNotebookId });

  const {
    data: notebooksData,
    isLoading: notebooksLoading,
    isError: notebooksError,
    error: notebooksErrorObj,
    refetch: refetchNotebooks,
  } = useNotebooks({ includeNoteCounts: true });

  // Mutation hooks
  const createNoteMutation = useCreateNote();
  const updateNoteMutation = useUpdateNote();
  const deleteNoteMutation = useDeleteNote();
  const createNotebookMutation = useCreateNotebook();
  const updateNotebookMutation = useUpdateNotebook();
  const deleteNotebookMutation = useDeleteNotebook();
  const shareNoteMutation = useShareNoteWithUser();
  const revokeShareMutation = useRevokeNoteShare();

  // Transform data for UI components
  const notes: UINote[] = useMemo(
    () => (notesData?.notes ?? []).map(toUINote),
    [notesData?.notes]
  );

  const notebooks: UINotebook[] = useMemo(
    () => (notebooksData?.notebooks ?? []).map(toUINotebook),
    [notebooksData?.notebooks]
  );

  // Get current note for detail view
  const currentNote = useMemo(() => {
    if (view.type === 'detail' || view.type === 'history') {
      return notes.find((n) => n.id === view.noteId);
    }
    return undefined;
  }, [notes, view]);

  // Get API note for current note (needed for save operations)
  const currentApiNote = useMemo(() => {
    if (view.type === 'detail' || view.type === 'history') {
      return notesData?.notes.find((n) => n.id === view.noteId);
    }
    return undefined;
  }, [notesData?.notes, view]);

  // Build URL path based on current state
  const buildNotePath = useCallback(
    (noteId?: string, nbId?: string) => {
      const notebookId = nbId ?? selectedNotebookId;
      if (notebookId && noteId) {
        return `/notebooks/${notebookId}/notes/${noteId}`;
      } else if (notebookId) {
        return `/notebooks/${notebookId}`;
      } else if (noteId) {
        return `/notes/${noteId}`;
      }
      return '/notes';
    },
    [selectedNotebookId]
  );

  // Handlers
  const handleSelectNotebook = useCallback(
    (notebook: UINotebook | null) => {
      setSelectedNotebookId(notebook?.id);
      setView({ type: 'list' });
      // Update URL
      if (notebook) {
        navigate(`/notebooks/${notebook.id}`, { state: { internal: true } });
      } else {
        navigate('/notes', { state: { internal: true } });
      }
    },
    [navigate]
  );

  const handleNoteClick = useCallback(
    (note: UINote) => {
      setView({ type: 'detail', noteId: note.id });
      // Update URL
      navigate(buildNotePath(note.id, note.notebookId), { state: { internal: true } });
    },
    [navigate, buildNotePath]
  );

  const handleAddNote = useCallback(() => {
    setView({ type: 'new' });
  }, []);

  const handleBack = useCallback(() => {
    setView({ type: 'list' });
    // Update URL to remove noteId
    navigate(buildNotePath(undefined), { state: { internal: true } });
  }, [navigate, buildNotePath]);

  const handleSaveNote = useCallback(
    async (data: {
      title: string;
      content: string;
      notebookId?: string;
      visibility: NoteVisibility;
      hideFromAgents: boolean;
    }) => {
      if (view.type === 'new') {
        const body: CreateNoteBody = {
          title: data.title,
          content: data.content,
          notebookId: data.notebookId ?? selectedNotebookId,
          visibility: data.visibility,
          hideFromAgents: data.hideFromAgents,
        };
        const newNote = await createNoteMutation.mutateAsync(body);
        setView({ type: 'detail', noteId: newNote.id });
        // Update URL to include the new note ID
        navigate(buildNotePath(newNote.id, newNote.notebookId ?? undefined), {
          state: { internal: true },
        });
      } else if (view.type === 'detail' && currentApiNote) {
        const body: UpdateNoteBody = {
          title: data.title,
          content: data.content,
          notebookId: data.notebookId,
          visibility: data.visibility,
          hideFromAgents: data.hideFromAgents,
        };
        await updateNoteMutation.mutateAsync({ id: currentApiNote.id, body });
      }
    },
    [view, currentApiNote, selectedNotebookId, createNoteMutation, updateNoteMutation, navigate, buildNotePath]
  );

  const handleDeleteNote = useCallback(
    (note: UINote) => {
      setDialog({ type: 'deleteNote', note });
    },
    []
  );

  const handleConfirmDeleteNote = useCallback(async () => {
    if (dialog.type === 'deleteNote') {
      await deleteNoteMutation.mutateAsync(dialog.note.id);
      setDialog({ type: 'none' });
      setView({ type: 'list' });
      // Navigate back to list view
      navigate(buildNotePath(undefined), { state: { internal: true } });
    }
  }, [dialog, deleteNoteMutation, navigate, buildNotePath]);

  const handleShareNote = useCallback((note: UINote) => {
    setDialog({ type: 'share', noteId: note.id });
  }, []);

  const handleTogglePin = useCallback(
    async (note: UINote) => {
      await updateNoteMutation.mutateAsync({
        id: note.id,
        body: { isPinned: !note.isPinned },
      });
    },
    [updateNoteMutation]
  );

  const handleViewHistory = useCallback(() => {
    if (view.type === 'detail') {
      setView({ type: 'history', noteId: view.noteId });
    }
  }, [view]);

  const handleCloseHistory = useCallback(() => {
    if (view.type === 'history') {
      setView({ type: 'detail', noteId: view.noteId });
    }
  }, [view]);

  const handleCreateNotebook = useCallback(() => {
    setDialog({ type: 'newNotebook' });
  }, []);

  const handleEditNotebook = useCallback((notebook: UINotebook) => {
    setDialog({ type: 'editNotebook', notebook });
  }, []);

  const handleDeleteNotebook = useCallback((notebook: UINotebook) => {
    setDialog({ type: 'deleteNotebook', notebook });
  }, []);

  const handleConfirmDeleteNotebook = useCallback(async () => {
    if (dialog.type === 'deleteNotebook') {
      await deleteNotebookMutation.mutateAsync({
        id: dialog.notebook.id,
        deleteNotes: false,
      });
      setDialog({ type: 'none' });
      if (selectedNotebookId === dialog.notebook.id) {
        setSelectedNotebookId(undefined);
      }
    }
  }, [dialog, deleteNotebookMutation, selectedNotebookId]);

  // Loading state
  if (notesLoading || notebooksLoading) {
    return (
      <div data-testid="page-notes" className="flex h-full">
        {/* Sidebar skeleton */}
        <div className="w-56 border-r p-4">
          <Skeleton width="100%" height={24} className="mb-4" />
          <SkeletonList count={5} variant="text" />
        </div>
        {/* Main content skeleton */}
        <div className="flex-1 p-6">
          <div className="mb-6 flex items-center justify-between">
            <Skeleton width={200} height={32} />
            <Skeleton width={140} height={36} />
          </div>
          <div className="mb-4 flex gap-3">
            <Skeleton width="100%" height={40} className="max-w-md" />
            <Skeleton width={150} height={40} />
          </div>
          <SkeletonList count={6} variant="card" />
        </div>
      </div>
    );
  }

  // Error state
  if (notesError || notebooksError) {
    const errorMessage =
      notesErrorObj instanceof Error
        ? notesErrorObj.message
        : notebooksErrorObj instanceof Error
          ? notebooksErrorObj.message
          : 'Unknown error';

    return (
      <div data-testid="page-notes" className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load notes"
          description={errorMessage}
          onRetry={() => {
            refetchNotes();
            refetchNotebooks();
          }}
        />
      </div>
    );
  }

  // Determine if we're on mobile (show one panel at a time)
  const showDetailPanel = view.type === 'detail' || view.type === 'new' || view.type === 'history';

  return (
    <div data-testid="page-notes" className="flex h-full overflow-hidden">
      {/* Notebooks Sidebar */}
      <NotebooksSidebar
        notebooks={notebooks}
        selectedNotebookId={selectedNotebookId}
        onSelectNotebook={handleSelectNotebook}
        onCreateNotebook={handleCreateNotebook}
        onEditNotebook={handleEditNotebook}
        onDeleteNotebook={handleDeleteNotebook}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        className="hidden md:flex"
      />

      {/* Notes List Panel - hidden on mobile when viewing detail */}
      <div
        className={cn(
          'flex-1 border-r',
          showDetailPanel && 'hidden lg:block lg:w-[400px] lg:flex-none'
        )}
      >
        <NotesList
          notes={notes}
          notebooks={notebooks}
          onNoteClick={handleNoteClick}
          onAddNote={handleAddNote}
          onEditNote={handleNoteClick}
          onDeleteNote={handleDeleteNote}
          onShareNote={handleShareNote}
          onTogglePin={handleTogglePin}
          selectedNotebookId={selectedNotebookId}
          className="h-full"
        />
      </div>

      {/* Note Detail/Editor Panel */}
      {showDetailPanel && (
        <div className="flex-1 flex flex-col">
          {/* Mobile back button */}
          <div className="lg:hidden border-b p-2">
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ArrowLeft className="mr-2 size-4" />
              Back to list
            </Button>
          </div>

          {view.type === 'history' && currentNote ? (
            <NoteHistoryPanel
              noteId={currentNote.id}
              onClose={handleCloseHistory}
            />
          ) : (
            <NoteDetail
              note={currentNote}
              notebooks={notebooks}
              onSave={handleSaveNote}
              onBack={handleBack}
              onShare={
                currentNote
                  ? () => handleShareNote(currentNote)
                  : undefined
              }
              onViewHistory={
                currentNote && view.type === 'detail'
                  ? handleViewHistory
                  : undefined
              }
              onDelete={
                currentNote
                  ? () => handleDeleteNote(currentNote)
                  : undefined
              }
              onTogglePin={
                currentNote
                  ? () => handleTogglePin(currentNote)
                  : undefined
              }
              isNew={view.type === 'new'}
              saving={createNoteMutation.isPending || updateNoteMutation.isPending}
              className="flex-1"
            />
          )}
        </div>
      )}

      {/* Empty state when no detail selected (desktop only) */}
      {!showDetailPanel && (
        <div className="hidden lg:flex lg:flex-1 items-center justify-center bg-muted/20">
          <Card className="max-w-sm">
            <CardContent className="p-8">
              <EmptyState
                variant="documents"
                title="Select a note"
                description="Choose a note from the list or create a new one to get started."
                onAction={handleAddNote}
                actionLabel="New Note"
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Share Dialog */}
      {dialog.type === 'share' && (
        <ShareDialogWrapper
          noteId={dialog.noteId}
          onClose={() => setDialog({ type: 'none' })}
          onShare={async (email, permission) => {
            await shareNoteMutation.mutateAsync({
              noteId: dialog.noteId,
              body: { email, permission },
            });
          }}
          onRevoke={async (shareId) => {
            await revokeShareMutation.mutateAsync({
              noteId: dialog.noteId,
              shareId,
            });
          }}
        />
      )}

      {/* Delete Note Confirmation */}
      <Dialog
        open={dialog.type === 'deleteNote'}
        onOpenChange={(open) => {
          if (!open) setDialog({ type: 'none' });
        }}
      >
        <DialogContent className="sm:max-w-sm" data-testid="delete-note-dialog">
          <DialogHeader>
            <DialogTitle>Delete Note</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;
              {dialog.type === 'deleteNote' ? dialog.note.title : ''}
              &quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ type: 'none' })}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDeleteNote}
              disabled={deleteNoteMutation.isPending}
              data-testid="confirm-delete-note"
            >
              {deleteNoteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Notebook Dialog */}
      <NotebookFormDialog
        open={dialog.type === 'newNotebook'}
        onOpenChange={(open) => {
          if (!open) setDialog({ type: 'none' });
        }}
        onSubmit={async (data) => {
          await createNotebookMutation.mutateAsync(data);
          setDialog({ type: 'none' });
        }}
        isSubmitting={createNotebookMutation.isPending}
      />

      {/* Edit Notebook Dialog */}
      <NotebookFormDialog
        open={dialog.type === 'editNotebook'}
        onOpenChange={(open) => {
          if (!open) setDialog({ type: 'none' });
        }}
        notebook={dialog.type === 'editNotebook' ? dialog.notebook : undefined}
        onSubmit={async (data) => {
          if (dialog.type === 'editNotebook') {
            await updateNotebookMutation.mutateAsync({
              id: dialog.notebook.id,
              body: data,
            });
            setDialog({ type: 'none' });
          }
        }}
        isSubmitting={updateNotebookMutation.isPending}
      />

      {/* Delete Notebook Confirmation */}
      <Dialog
        open={dialog.type === 'deleteNotebook'}
        onOpenChange={(open) => {
          if (!open) setDialog({ type: 'none' });
        }}
      >
        <DialogContent className="sm:max-w-sm" data-testid="delete-notebook-dialog">
          <DialogHeader>
            <DialogTitle>Delete Notebook</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;
              {dialog.type === 'deleteNotebook' ? dialog.notebook.name : ''}
              &quot;? Notes in this notebook will be moved to &quot;All Notes&quot;.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ type: 'none' })}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDeleteNotebook}
              disabled={deleteNotebookMutation.isPending}
              data-testid="confirm-delete-notebook"
            >
              {deleteNotebookMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

