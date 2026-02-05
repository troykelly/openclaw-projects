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
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { Plus, X, ArrowLeft } from 'lucide-react';
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
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Textarea } from '@/ui/components/ui/textarea';
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
  ShareDialog,
  VersionHistory,
} from '@/ui/components/notes';
import { NotebooksSidebar } from '@/ui/components/notebooks/notebooks-sidebar';

// Query hooks
import { useNotes, useNoteVersions } from '@/ui/hooks/queries/use-notes';
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
import { useNoteShares } from '@/ui/hooks/queries/use-notes';

// Types
import type {
  Note as ApiNote,
  Notebook as ApiNotebook,
  NoteVisibility,
  CreateNoteBody,
  UpdateNoteBody,
  CreateNotebookBody,
  UpdateNotebookBody,
} from '@/ui/lib/api-types';
import type {
  Note as UINote,
  Notebook as UINotebook,
} from '@/ui/components/notes/types';

/**
 * Transform API Note to UI Note type.
 * The UI components expect slightly different field names/types.
 */
function toUINote(apiNote: ApiNote): UINote {
  return {
    id: apiNote.id,
    title: apiNote.title,
    content: apiNote.content,
    notebookId: apiNote.notebookId ?? undefined,
    notebookTitle: apiNote.notebook?.name,
    visibility: apiNote.visibility,
    hideFromAgents: apiNote.hideFromAgents,
    isPinned: apiNote.isPinned,
    tags: apiNote.tags,
    createdAt: new Date(apiNote.createdAt),
    updatedAt: new Date(apiNote.updatedAt),
    createdBy: apiNote.userEmail,
    version: apiNote.versionCount ?? 1,
  };
}

/**
 * Transform API Notebook to UI Notebook type.
 */
function toUINotebook(apiNotebook: ApiNotebook): UINotebook {
  return {
    id: apiNotebook.id,
    name: apiNotebook.name,
    description: apiNotebook.description ?? undefined,
    color: apiNotebook.color ?? undefined,
    noteCount: apiNotebook.noteCount ?? 0,
    createdAt: new Date(apiNotebook.createdAt),
    updatedAt: new Date(apiNotebook.updatedAt),
  };
}

/** View state for the page */
type ViewState =
  | { type: 'list' }
  | { type: 'new' }
  | { type: 'detail'; noteId: string }
  | { type: 'history'; noteId: string };

/** Dialog state */
type DialogState =
  | { type: 'none' }
  | { type: 'share'; noteId: string }
  | { type: 'deleteNote'; note: UINote }
  | { type: 'newNotebook' }
  | { type: 'editNotebook'; notebook: UINotebook }
  | { type: 'deleteNotebook'; notebook: UINotebook };

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
  // Mutation error state for user feedback
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Auto-dismiss mutation errors after 5 seconds
  useEffect(() => {
    if (mutationError) {
      const timer = setTimeout(() => setMutationError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [mutationError]);

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
      try {
        setMutationError(null);
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
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to save note';
        setMutationError(message);
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
      try {
        setMutationError(null);
        await deleteNoteMutation.mutateAsync(dialog.note.id);
        setDialog({ type: 'none' });
        setView({ type: 'list' });
        // Navigate back to list view
        navigate(buildNotePath(undefined), { state: { internal: true } });
      } catch (error) {
        setDialog({ type: 'none' });
        const message =
          error instanceof Error ? error.message : 'Failed to delete note';
        setMutationError(message);
      }
    }
  }, [dialog, deleteNoteMutation, navigate, buildNotePath]);

  const handleShareNote = useCallback((note: UINote) => {
    setDialog({ type: 'share', noteId: note.id });
  }, []);

  const handleTogglePin = useCallback(
    async (note: UINote) => {
      try {
        setMutationError(null);
        await updateNoteMutation.mutateAsync({
          id: note.id,
          body: { isPinned: !note.isPinned },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to update pin status';
        setMutationError(message);
      }
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
      try {
        setMutationError(null);
        await deleteNotebookMutation.mutateAsync({
          id: dialog.notebook.id,
          deleteNotes: false,
        });
        setDialog({ type: 'none' });
        if (selectedNotebookId === dialog.notebook.id) {
          setSelectedNotebookId(undefined);
        }
      } catch (error) {
        setDialog({ type: 'none' });
        const message =
          error instanceof Error ? error.message : 'Failed to delete notebook';
        setMutationError(message);
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
    <div data-testid="page-notes" className="flex h-full overflow-hidden relative">
      {/* Mutation error notification */}
      {mutationError && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-50 max-w-md rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 shadow-lg"
          role="alert"
          data-testid="mutation-error-notification"
        >
          <div className="flex items-center gap-3">
            <span className="text-sm text-destructive">{mutationError}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-1 text-destructive hover:text-destructive"
              onClick={() => setMutationError(null)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}

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

// ---------------------------------------------------------------------------
// Helper Components
// ---------------------------------------------------------------------------

interface NotebookFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebook?: UINotebook;
  onSubmit: (data: CreateNotebookBody | UpdateNotebookBody) => Promise<void>;
  isSubmitting: boolean;
}

function NotebookFormDialog({
  open,
  onOpenChange,
  notebook,
  onSubmit,
  isSubmitting,
}: NotebookFormDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6366f1');

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setName(notebook?.name ?? '');
      setDescription(notebook?.description ?? '');
      setColor(notebook?.color ?? '#6366f1');
    }
  }, [open, notebook]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      color,
    });
  };

  const isValid = name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="notebook-form-dialog">
        <DialogHeader>
          <DialogTitle>
            {notebook ? 'Edit Notebook' : 'New Notebook'}
          </DialogTitle>
          <DialogDescription>
            {notebook
              ? 'Update the notebook details below.'
              : 'Create a new notebook to organize your notes.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notebook-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="notebook-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Notebook"
              required
              data-testid="notebook-name-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notebook-description">Description</Label>
            <Textarea
              id="notebook-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
              data-testid="notebook-description-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notebook-color">Color</Label>
            <div className="flex items-center gap-2">
              <input
                id="notebook-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border"
                data-testid="notebook-color-input"
              />
              <span className="text-sm text-muted-foreground">{color}</span>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || isSubmitting}
              data-testid="notebook-form-submit"
            >
              {notebook ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ShareDialogWrapperProps {
  noteId: string;
  onClose: () => void;
  onShare: (email: string, permission: 'read' | 'read_write') => Promise<void>;
  onRevoke: (shareId: string) => Promise<void>;
}

function ShareDialogWrapper({
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

interface NoteHistoryPanelProps {
  noteId: string;
  onClose: () => void;
}

function NoteHistoryPanel({ noteId, onClose }: NoteHistoryPanelProps) {
  const { data: versionsData, isLoading, isError } = useNoteVersions(noteId);

  if (isLoading) {
    return (
      <div className="flex-1 p-6">
        <div className="flex items-center justify-between mb-4">
          <Skeleton width={200} height={24} />
          <Button variant="ghost" size="icon" onClick={onClose}>
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
          <Button variant="ghost" size="icon" onClick={onClose}>
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
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto">
        <VersionHistory
          versions={versions}
          currentVersion={versionsData.currentVersion}
          onRestore={(version) => {
            // TODO: Implement restore functionality
            console.log('Restore version:', version);
          }}
          className="h-full"
        />
      </div>
    </div>
  );
}
