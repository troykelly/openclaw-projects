/**
 * Notebook types for the notebooks API.
 * Part of Epic #337, Issue #345
 */

/** A notebook from the database */
export interface Notebook {
  id: string;
  userEmail: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parentNotebookId: string | null;
  sortOrder: number;
  isArchived: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Optional computed/expanded fields
  noteCount?: number;
  childCount?: number;
  parent?: { id: string; name: string } | null;
  children?: Notebook[];
  notes?: NotebookNote[];
}

/** Minimal note info for notebook expansion */
export interface NotebookNote {
  id: string;
  title: string;
  updatedAt: Date;
}

/** Input for creating a new notebook */
export interface CreateNotebookInput {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  parentNotebookId?: string;
}

/** Input for updating a notebook */
export interface UpdateNotebookInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  parentNotebookId?: string | null;
  sortOrder?: number;
}

/** Query options for listing notebooks */
export interface ListNotebooksOptions {
  parentId?: string | null;
  includeArchived?: boolean;
  includeNoteCounts?: boolean;
  includeChildCounts?: boolean;
  limit?: number;
  offset?: number;
}

/** Result of listing notebooks */
export interface ListNotebooksResult {
  notebooks: Notebook[];
  total: number;
}

/** Options for getting a single notebook */
export interface GetNotebookOptions {
  includeNotes?: boolean;
  includeChildren?: boolean;
  includeNoteCounts?: boolean;
}

/** Tree node for notebook hierarchy */
export interface NotebookTreeNode {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  noteCount?: number;
  children: NotebookTreeNode[];
}

/** Input for moving notes between notebooks */
export interface MoveNotesInput {
  noteIds: string[];
  action: 'move' | 'copy';
}

/** Result of moving notes */
export interface MoveNotesResult {
  moved: string[];
  failed: string[];
}
