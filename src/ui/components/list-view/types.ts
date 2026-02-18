/**
 * Types for list view with configurable columns
 * Issue #407: Implement list view with configurable columns
 */

export type SortDirection = 'asc' | 'desc';

export interface ColumnDefinition {
  id: string;
  label: string;
  width: number;
  sortable?: boolean;
  required?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface Column extends ColumnDefinition {
  visible: boolean;
}

export interface ListItem {
  id: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  assignee?: string | null;
  dueDate?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  estimate?: number | null;
  [key: string]: unknown;
}

export interface SortState {
  column: string | null;
  direction: SortDirection;
}
