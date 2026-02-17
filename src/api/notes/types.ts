/**
 * Note types for the notes API.
 * Part of Epic #337, Issue #344
 *
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 */

/** Valid note visibility levels */
export type NoteVisibility = 'private' | 'shared' | 'public';

/** Valid embedding statuses */
export type EmbeddingStatus = 'pending' | 'complete' | 'failed' | 'skipped';

/** A note entry from the database */
export interface Note {
  id: string;
  notebook_id: string | null;
  user_email: string;
  title: string;
  content: string;
  summary: string | null;
  tags: string[];
  is_pinned: boolean;
  sort_order: number;
  visibility: NoteVisibility;
  hide_from_agents: boolean;
  embedding_status: EmbeddingStatus;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  // Optional expanded fields
  notebook?: { id: string; name: string } | null;
  version_count?: number;
}

/** Input for creating a new note */
export interface CreateNoteInput {
  title: string;
  content?: string;
  notebook_id?: string;
  tags?: string[];
  visibility?: NoteVisibility;
  hide_from_agents?: boolean;
  summary?: string;
  is_pinned?: boolean;
}

/** Input for updating a note */
export interface UpdateNoteInput {
  title?: string;
  content?: string;
  notebook_id?: string | null;
  tags?: string[];
  visibility?: NoteVisibility;
  hide_from_agents?: boolean;
  summary?: string | null;
  is_pinned?: boolean;
  sort_order?: number;
}

/** Query options for listing notes */
export interface ListNotesOptions {
  notebook_id?: string;
  tags?: string[];
  visibility?: NoteVisibility;
  search?: string;
  is_pinned?: boolean;
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
  sort_by?: 'created_at' | 'updated_at' | 'title';
  sort_order?: 'asc' | 'desc';
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
  include_versions?: boolean;
  include_references?: boolean;
}
