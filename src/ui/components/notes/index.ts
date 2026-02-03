/**
 * Notes component exports.
 * Part of Epic #338, Issues #350-358
 */

// Types
export type {
  Note,
  NoteVersion,
  NoteShare,
  Notebook,
  NoteVisibility,
  NoteFilter,
  NoteFormData,
  NotebookFormData,
} from './types';

// Editor (Issue #350)
export { NoteEditor, type NoteEditorProps, type EditorMode } from './editor';

// List (Issue #353)
export { NotesList, type NotesListProps } from './list';
export { NoteCard, type NoteCardProps } from './list';

// Detail (Issue #354)
export { NoteDetail, type NoteDetailProps } from './detail';

// Sharing (Issue #355)
export { ShareDialog, type ShareDialogProps } from './sharing';

// History (Issue #356)
export { VersionHistory, type VersionHistoryProps } from './history';

// Shared access (Issue #357)
export { SharedNotePage, type SharedNotePageProps, type SharedNoteStatus } from './shared';

// Hooks (Issue #358)
export {
  useNoteKeyboardShortcuts,
  formatShortcut,
  getShortcutsByCategory,
  NOTE_SHORTCUTS,
  type NoteKeyboardShortcuts,
  type UseNoteKeyboardShortcutsOptions,
  type ShortcutDefinition,
} from './hooks';
