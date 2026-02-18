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
  notebookTitle?: string;
  visibility: NoteVisibility;
  hideFromAgents: boolean;
  isPinned: boolean;
  tags?: string[];
  created_at: Date;
  updated_at: Date;
  createdBy: string;
  version: number;
}

export interface NoteVersion {
  id: string;
  noteId: string;
  version: number;
  title: string;
  content: string;
  changedBy: string;
  changedAt: Date;
  changeReason?: string;
}

export interface NoteShare {
  id: string;
  noteId: string;
  sharedWithEmail: string;
  permission: 'view' | 'edit';
  created_at: Date;
  createdBy: string;
}

export interface Notebook {
  id: string;
  name: string;
  description?: string;
  color?: string;
  noteCount: number;
  created_at: Date;
  updated_at: Date;
}

export interface NoteFilter {
  search?: string;
  notebook_id?: string;
  visibility?: NoteVisibility;
  tags?: string[];
  isPinned?: boolean;
}

export interface NoteFormData {
  title: string;
  content: string;
  notebook_id?: string;
  visibility?: NoteVisibility;
  hideFromAgents?: boolean;
  tags?: string[];
}

export interface NotebookFormData {
  name: string;
  description?: string;
  color?: string;
}
