/**
 * Notebook types for the notebooks API.
 * Part of Epic #337, Issue #345
 *
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 */

/** A notebook from the database */
export interface Notebook {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parent_notebook_id: string | null;
  sort_order: number;
  is_archived: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  // Optional computed/expanded fields
  note_count?: number;
  child_count?: number;
  parent?: { id: string; name: string } | null;
  children?: Notebook[];
  notes?: NotebookNote[];
}

/** Minimal note info for notebook expansion */
export interface NotebookNote {
  id: string;
  title: string;
  updated_at: Date;
}

/** Input for creating a new notebook */
export interface CreateNotebookInput {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  parent_notebook_id?: string;
}

/** Input for updating a notebook */
export interface UpdateNotebookInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  parent_notebook_id?: string | null;
  sort_order?: number;
}

/** Query options for listing notebooks */
export interface ListNotebooksOptions {
  parent_id?: string | null;
  include_archived?: boolean;
  include_note_counts?: boolean;
  include_child_counts?: boolean;
  limit?: number;
  offset?: number;
  /** Epic #1418: namespace scoping (preferred over user_email) */
  queryNamespaces?: string[];
}

/** Result of listing notebooks */
export interface ListNotebooksResult {
  notebooks: Notebook[];
  total: number;
}

/** Options for getting a single notebook */
export interface GetNotebookOptions {
  include_notes?: boolean;
  include_children?: boolean;
  include_note_counts?: boolean;
}

/** Tree node for notebook hierarchy */
export interface NotebookTreeNode {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  note_count?: number;
  children: NotebookTreeNode[];
}

/** Input for moving notes between notebooks */
export interface MoveNotesInput {
  note_ids: string[];
  action: 'move' | 'copy';
}

/** Result of moving notes */
export interface MoveNotesResult {
  moved: string[];
  failed: string[];
}
