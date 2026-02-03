/**
 * Note types for UI components.
 * Part of Epic #338, Issues #350-358
 */

export type NoteVisibility = 'private' | 'shared' | 'public';

export interface Note {
  id: string;
  title: string;
  content: string;
  notebookId?: string;
  notebookTitle?: string;
  visibility: NoteVisibility;
  hideFromAgents: boolean;
  isPinned: boolean;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: Date;
  createdBy: string;
}

export interface Notebook {
  id: string;
  name: string;
  description?: string;
  color?: string;
  noteCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NoteFilter {
  search?: string;
  notebookId?: string;
  visibility?: NoteVisibility;
  tags?: string[];
  isPinned?: boolean;
}

export interface NoteFormData {
  title: string;
  content: string;
  notebookId?: string;
  visibility?: NoteVisibility;
  hideFromAgents?: boolean;
  tags?: string[];
}

export interface NotebookFormData {
  name: string;
  description?: string;
  color?: string;
}
