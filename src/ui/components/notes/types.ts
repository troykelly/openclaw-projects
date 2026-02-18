/**
 * Note types for UI components.
 * Part of Epic #338, Issues #350-358
 */

export type NoteVisibility = 'private' | 'shared' | 'public';

export interface Note {
  id: string;
  title: string;
  content: string;
  notebook_id?: string;
  notebook_title?: string;
  visibility: NoteVisibility;
  hide_from_agents: boolean;
  is_pinned: boolean;
  tags?: string[];
  created_at: Date;
  updated_at: Date;
  created_by: string;
  version: number;
}

export interface NoteVersion {
  id: string;
  note_id: string;
  version: number;
  title: string;
  content: string;
  changed_by: string;
  changed_at: Date;
  change_reason?: string;
}

export interface NoteShare {
  id: string;
  note_id: string;
  shared_with_email: string;
  permission: 'view' | 'edit';
  created_at: Date;
  created_by: string;
}

export interface Notebook {
  id: string;
  name: string;
  description?: string;
  color?: string;
  note_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface NoteFilter {
  search?: string;
  notebook_id?: string;
  visibility?: NoteVisibility;
  tags?: string[];
  is_pinned?: boolean;
}

export interface NoteFormData {
  title: string;
  content: string;
  notebook_id?: string;
  visibility?: NoteVisibility;
  hide_from_agents?: boolean;
  tags?: string[];
}

export interface NotebookFormData {
  name: string;
  description?: string;
  color?: string;
}
