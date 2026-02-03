/**
 * Note types for the notes API.
 * Part of Epic #337, Issue #344
 */

/** Valid note visibility levels */
export type NoteVisibility = 'private' | 'shared' | 'public';

/** Valid embedding statuses */
export type EmbeddingStatus = 'pending' | 'complete' | 'failed' | 'skipped';

/** A note entry from the database */
export interface Note {
  id: string;
  notebookId: string | null;
  userEmail: string;
  title: string;
  content: string;
  summary: string | null;
  tags: string[];
  isPinned: boolean;
  sortOrder: number;
  visibility: NoteVisibility;
  hideFromAgents: boolean;
  embeddingStatus: EmbeddingStatus;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Optional expanded fields
  notebook?: { id: string; name: string } | null;
  versionCount?: number;
}

/** Input for creating a new note */
export interface CreateNoteInput {
  title: string;
  content?: string;
  notebookId?: string;
  tags?: string[];
  visibility?: NoteVisibility;
  hideFromAgents?: boolean;
  summary?: string;
  isPinned?: boolean;
}

/** Input for updating a note */
export interface UpdateNoteInput {
  title?: string;
  content?: string;
  notebookId?: string | null;
  tags?: string[];
  visibility?: NoteVisibility;
  hideFromAgents?: boolean;
  summary?: string | null;
  isPinned?: boolean;
  sortOrder?: number;
}

/** Query options for listing notes */
export interface ListNotesOptions {
  notebookId?: string;
  tags?: string[];
  visibility?: NoteVisibility;
  search?: string;
  isPinned?: boolean;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
}

/** Result of listing notes */
export interface ListNotesResult {
  notes: Note[];
  total: number;
  limit: number;
  offset: number;
}

/** Options for getting a single note */
export interface GetNoteOptions {
  includeVersions?: boolean;
  includeReferences?: boolean;
}
