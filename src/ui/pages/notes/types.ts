/**
 * Type definitions for notes page components.
 * Part of Epic #338, Issue #659 (component splitting).
 */
import type { Note as ApiNote, Notebook as ApiNotebook } from '@/ui/lib/api-types';
import type { Note as UINote, Notebook as UINotebook } from '@/ui/components/notes/types';

/** View state for the page */
export type ViewState = { type: 'list' } | { type: 'new' } | { type: 'detail'; noteId: string } | { type: 'history'; noteId: string };

/** Dialog state */
export type DialogState =
  | { type: 'none' }
  | { type: 'share'; noteId: string }
  | { type: 'deleteNote'; note: UINote }
  | { type: 'newNotebook' }
  | { type: 'editNotebook'; notebook: UINotebook }
  | { type: 'deleteNotebook'; notebook: UINotebook };

/**
 * Transform API Note to UI Note type.
 * The UI components expect slightly different field names/types.
 */
export function toUINote(apiNote: ApiNote): UINote {
  return {
    id: apiNote.id,
    title: apiNote.title,
    content: apiNote.content,
    notebook_id: apiNote.notebook_id ?? undefined,
    notebookTitle: apiNote.notebook?.name,
    visibility: apiNote.visibility,
    hideFromAgents: apiNote.hideFromAgents,
    isPinned: apiNote.isPinned,
    tags: apiNote.tags,
    created_at: new Date(apiNote.created_at),
    updated_at: new Date(apiNote.updated_at),
    createdBy: apiNote.user_email,
    version: apiNote.versionCount ?? 1,
  };
}

/**
 * Transform API Notebook to UI Notebook type.
 */
export function toUINotebook(apiNotebook: ApiNotebook): UINotebook {
  return {
    id: apiNotebook.id,
    name: apiNotebook.name,
    description: apiNotebook.description ?? undefined,
    color: apiNotebook.color ?? undefined,
    noteCount: apiNotebook.noteCount ?? 0,
    created_at: new Date(apiNotebook.created_at),
    updated_at: new Date(apiNotebook.updated_at),
  };
}
