/**
 * Notes page component.
 * Part of Epic #338, Issues #624, #625, #657, #660, #661, #663, #664, #665
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
import { useState, useCallback, useMemo, useEffect, useRef, type ErrorInfo } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { cn, validateUrlParam } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Skeleton, SkeletonList, ErrorState, EmptyState, useAnnounce } from '@/ui/components/feedback';
import { Card, CardContent } from '@/ui/components/ui/card';
import { ErrorBoundary } from '@/ui/components/error-boundary';

// Notes components
import { NotesList, NoteDetail } from '@/ui/components/notes';
import { NotebooksSidebar } from '@/ui/components/notebooks/notebooks-sidebar';

// Query hooks
import { useNotes } from '@/ui/hooks/queries/use-notes';
import { useNotebooks } from '@/ui/hooks/queries/use-notebooks';
import { useCreateNote, useUpdateNote, useDeleteNote } from '@/ui/hooks/mutations/use-note-mutations';
import { useCreateNotebook, useUpdateNotebook, useDeleteNotebook } from '@/ui/hooks/mutations/use-notebook-mutations';
import { useShareNoteWithUser, useRevokeNoteShare } from '@/ui/hooks/mutations/use-note-sharing-mutations';

// Extracted components (#659)
import { NotebookFormDialog, ShareDialogWrapper, NoteHistoryPanel, toUINote, toUINotebook } from './notes';
import type { ViewState, DialogState } from './notes';

// Types
import type { NoteVisibility, CreateNoteBody, UpdateNoteBody } from '@/ui/lib/api-types';
import type { Note as UINote, Notebook as UINotebook } from '@/ui/components/notes/types';
import { validateNote, getValidationErrorMessage } from '@/ui/lib/validation';

/**
 * Error handler for the Notes page error boundary.
 * Logs errors in development mode only (#693).
 */
function handleNotesPageError(error: Error, errorInfo: ErrorInfo): void {
  // Log in development only to avoid information leakage in production
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error('[NotesPage] Error caught by boundary:', error, errorInfo);
  }
  // TODO: Add error reporting service integration (#664)
}

/**
 * Notes page with error boundary wrapper.
 * Issue #664: Adds graceful error handling for the Notes page.
 */
export function NotesPage(): React.JSX.Element {
  return (
    <ErrorBoundary title="Notes Error" description="Something went wrong loading your notes. Please try again." onError={handleNotesPageError}>
      <NotesPageContent />
    </ErrorBoundary>
  );
}

function NotesPageContent(): React.JSX.Element {
  // URL params for deep linking - validate to prevent malformed URLs
  const { noteId: rawNoteId, notebookId: rawNotebookId } = useParams<{
    noteId?: string;
    notebookId?: string;
  }>();
  const navigate = useNavigate();

  // Ref to track internal navigations - more robust than location.state (#670)
  // This avoids the fragility of relying on history state which can be lost
  const isInternalNavigation = useRef(false);

  // Validate URL params - only accept valid UUIDs (#666)
  const urlNoteId = validateUrlParam(rawNoteId);
  const urlNotebookId = validateUrlParam(rawNotebookId);

  // Redirect to /notes if URL params are invalid (#666)
  useEffect(() => {
    if ((rawNoteId && !urlNoteId) || (rawNotebookId && !urlNotebookId)) {
      navigate('/notes', { replace: true });
    }
  }, [rawNoteId, rawNotebookId, urlNoteId, urlNotebookId, navigate]);

  // View state
  const [view, setView] = useState<ViewState>({ type: 'list' });
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | undefined>(urlNotebookId);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  /**
   * Navigate internally - marks navigation as coming from this component
   * so we don't reset view state in the URL sync effect.
   */
  const navigateInternal = useCallback(
    (path: string) => {
      isInternalNavigation.current = true;
      navigate(path);
    },
    [navigate],
  );

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
    // Skip state reset for internal navigations (#670)
    if (isInternalNavigation.current) {
      isInternalNavigation.current = false;
      return;
    }

    if (urlNoteId) {
      setView({ type: 'detail', noteId: urlNoteId });
    } else {
      // Use functional update to check current state without adding to deps
      setView((current) => {
        // If in detail/history view and URL has no noteId, go back to list
        if (current.type === 'detail' || current.type === 'history') {
          return { type: 'list' };
        }
        return current;
      });
    }
  }, [urlNoteId]);

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

  // Announce state changes to screen readers (#661)
  const { announce, LiveRegion } = useAnnounce();

  // Transform data for UI components
  const notes: UINote[] = useMemo(() => (notesData?.notes ?? []).map(toUINote), [notesData?.notes]);

  const notebooks: UINotebook[] = useMemo(() => (notebooksData?.notebooks ?? []).map(toUINotebook), [notebooksData?.notebooks]);

  // Get current note for detail view
  const currentNote = useMemo(() => {
    if (view.type === 'detail' || view.type === 'history') {
      return notes.find((n) => n.id === view.noteId);
    }
    return undefined;
  }, [notes, view]);

  // Check if requested note exists after data loads (#667)
  const noteNotFound = useMemo(() => {
    // Only check when we're in detail/history view and notes have loaded
    if ((view.type === 'detail' || view.type === 'history') && !notesLoading && !notesError && notesData) {
      // Note requested but not found in the data
      return !notes.find((n) => n.id === view.noteId);
    }
    return false;
  }, [view, notesLoading, notesError, notesData, notes]);

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
    [selectedNotebookId],
  );

  // Handlers
  const handleSelectNotebook = useCallback(
    (notebook: UINotebook | null) => {
      setSelectedNotebookId(notebook?.id);
      setView({ type: 'list' });
      // Update URL
      if (notebook) {
        navigateInternal(`/notebooks/${notebook.id}`);
      } else {
        navigateInternal('/notes');
      }
    },
    [navigateInternal],
  );

  const handleNoteClick = useCallback(
    (note: UINote) => {
      setView({ type: 'detail', noteId: note.id });
      // Update URL
      navigateInternal(buildNotePath(note.id, note.notebookId));
    },
    [navigateInternal, buildNotePath],
  );

  const handleAddNote = useCallback(() => {
    setView({ type: 'new' });
  }, []);

  const handleBack = useCallback(() => {
    setView({ type: 'list' });
    // Update URL to remove noteId
    navigateInternal(buildNotePath(undefined));
  }, [navigateInternal, buildNotePath]);

  const handleSaveNote = useCallback(
    async (data: { title: string; content: string; notebookId?: string; visibility: NoteVisibility; hideFromAgents: boolean }) => {
      // Client-side validation before API call (#656)
      const validation = validateNote({
        title: data.title,
        content: data.content,
        notebookId: data.notebookId,
      });

      if (!validation.valid) {
        // Throw error with validation message for consumer to handle
        throw new Error(getValidationErrorMessage(validation));
      }

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
        navigateInternal(buildNotePath(newNote.id, newNote.notebookId ?? undefined));
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
    [view, currentApiNote, selectedNotebookId, createNoteMutation, updateNoteMutation, navigateInternal, buildNotePath],
  );

  const handleDeleteNote = useCallback((note: UINote) => {
    setDialog({ type: 'deleteNote', note });
  }, []);

  const handleConfirmDeleteNote = useCallback(async () => {
    if (dialog.type === 'deleteNote') {
      await deleteNoteMutation.mutateAsync(dialog.note.id);
      setDialog({ type: 'none' });
      setView({ type: 'list' });
      // Navigate back to list view
      navigateInternal(buildNotePath(undefined));
    }
  }, [dialog, deleteNoteMutation, navigateInternal, buildNotePath]);

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
    [updateNoteMutation],
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

  // Share note handler with error handling (#660)
  const handleShare = useCallback(
    async (email: string, permission: 'read' | 'read_write') => {
      if (dialog.type !== 'share') return;
      try {
        await shareNoteMutation.mutateAsync({
          noteId: dialog.noteId,
          body: { email, permission },
        });
        announce('Note shared successfully');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to share note';
        announce(`Error: ${message}`);
        throw error; // Re-throw to let ShareDialogWrapper handle UI state
      }
    },
    [dialog, shareNoteMutation, announce],
  );

  // Revoke share handler with error handling (#660)
  const handleRevoke = useCallback(
    async (shareId: string) => {
      if (dialog.type !== 'share') return;
      try {
        await revokeShareMutation.mutateAsync({
          noteId: dialog.noteId,
          shareId,
        });
        announce('Share access revoked');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to revoke share';
        announce(`Error: ${message}`);
        throw error; // Re-throw to let ShareDialogWrapper handle UI state
      }
    },
    [dialog, revokeShareMutation, announce],
  );

  // Close share dialog handler (#665)
  const handleCloseShareDialog = useCallback(() => {
    setDialog({ type: 'none' });
  }, []);

  // Dialog close handler for delete note (#665)
  const handleCloseDeleteNoteDialog = useCallback((open: boolean) => {
    if (!open) setDialog({ type: 'none' });
  }, []);

  // Dialog close handler for new/edit notebook (#665)
  const handleCloseNotebookDialog = useCallback((open: boolean) => {
    if (!open) setDialog({ type: 'none' });
  }, []);

  // New notebook submit handler (#665)
  const handleSubmitNewNotebook = useCallback(
    async (data: Parameters<typeof createNotebookMutation.mutateAsync>[0]) => {
      await createNotebookMutation.mutateAsync(data);
      setDialog({ type: 'none' });
    },
    [createNotebookMutation],
  );

  // Edit notebook submit handler (#665)
  const handleSubmitEditNotebook = useCallback(
    async (data: Parameters<typeof updateNotebookMutation.mutateAsync>[0]['body']) => {
      if (dialog.type === 'editNotebook') {
        await updateNotebookMutation.mutateAsync({
          id: dialog.notebook.id,
          body: data,
        });
        setDialog({ type: 'none' });
      }
    },
    [dialog, updateNotebookMutation],
  );

  // Cancel dialog handler (#665)
  const handleCancelDialog = useCallback(() => {
    setDialog({ type: 'none' });
  }, []);

  // Memoized handlers for NoteDetail to prevent re-renders (#665)
  const handleShareCurrentNote = useMemo(() => (currentNote ? () => handleShareNote(currentNote) : undefined), [currentNote, handleShareNote]);

  const handleDeleteCurrentNote = useMemo(() => (currentNote ? () => handleDeleteNote(currentNote) : undefined), [currentNote, handleDeleteNote]);

  const handleTogglePinCurrentNote = useMemo(() => (currentNote ? () => handleTogglePin(currentNote) : undefined), [currentNote, handleTogglePin]);

  const handleViewHistoryIfDetail = useMemo(
    () => (currentNote && view.type === 'detail' ? handleViewHistory : undefined),
    [currentNote, view.type, handleViewHistory],
  );

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
      notesErrorObj instanceof Error ? notesErrorObj.message : notebooksErrorObj instanceof Error ? notebooksErrorObj.message : 'Unknown error';

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
      <div className={cn('flex-1 border-r', showDetailPanel && 'hidden lg:block lg:w-[400px] lg:flex-none')}>
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
          {/* Mobile back button (#661) */}
          <div className="lg:hidden border-b p-2">
            <Button variant="ghost" size="sm" onClick={handleBack} aria-label="Go back to notes list">
              <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
              Back to list
            </Button>
          </div>

          {/* Note not found error state (#667) */}
          {noteNotFound && view.type !== 'new' ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <ErrorState
                type="not-found"
                title="Note not found"
                description="This note may have been deleted or you don't have access to it."
                onRetry={handleBack}
                retryLabel="Back to notes"
              />
            </div>
          ) : view.type === 'history' && currentNote ? (
            <NoteHistoryPanel noteId={currentNote.id} onClose={handleCloseHistory} />
          ) : (
            <NoteDetail
              note={currentNote}
              notebooks={notebooks}
              onSave={handleSaveNote}
              onBack={handleBack}
              onShare={handleShareCurrentNote}
              onViewHistory={handleViewHistoryIfDetail}
              onDelete={handleDeleteCurrentNote}
              onTogglePin={handleTogglePinCurrentNote}
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

      {/* Share Dialog (#660, #663, #665) */}
      {dialog.type === 'share' && (
        <ShareDialogWrapper
          noteId={dialog.noteId}
          onClose={handleCloseShareDialog}
          onShare={handleShare}
          onRevoke={handleRevoke}
          isSharing={shareNoteMutation.isPending}
          isRevoking={revokeShareMutation.isPending}
        />
      )}

      {/* Delete Note Confirmation (#665) */}
      <Dialog open={dialog.type === 'deleteNote'} onOpenChange={handleCloseDeleteNoteDialog}>
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
            <Button variant="outline" onClick={handleCancelDialog}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteNote} disabled={deleteNoteMutation.isPending} data-testid="confirm-delete-note">
              {deleteNoteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Notebook Dialog (#665) */}
      <NotebookFormDialog
        open={dialog.type === 'newNotebook'}
        onOpenChange={handleCloseNotebookDialog}
        onSubmit={handleSubmitNewNotebook}
        isSubmitting={createNotebookMutation.isPending}
      />

      {/* Edit Notebook Dialog (#665) */}
      <NotebookFormDialog
        open={dialog.type === 'editNotebook'}
        onOpenChange={handleCloseNotebookDialog}
        notebook={dialog.type === 'editNotebook' ? dialog.notebook : undefined}
        onSubmit={handleSubmitEditNotebook}
        isSubmitting={updateNotebookMutation.isPending}
      />

      {/* Delete Notebook Confirmation (#665) */}
      <Dialog open={dialog.type === 'deleteNotebook'} onOpenChange={handleCloseNotebookDialog}>
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
            <Button variant="outline" onClick={handleCancelDialog}>
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

      {/* Screen reader announcements (#661) */}
      <LiveRegion />
    </div>
  );
}
