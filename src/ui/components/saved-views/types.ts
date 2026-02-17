/**
 * Types for saved views with sharing
 * Issue #406: Implement saved views with sharing
 */

export type ViewType = 'list' | 'kanban' | 'calendar' | 'timeline';

export interface ViewConfig {
  filters?: Record<string, unknown>;
  sort?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  viewType?: ViewType;
  columns?: string[];
  groupBy?: string;
}

export interface SavedView {
  id: string;
  name: string;
  description?: string;
  config: ViewConfig;
  created_at: string;
  updated_at?: string;
  isShared?: boolean;
  sharedWith?: string[];
  ownerId?: string;
}

export interface SaveViewInput {
  name: string;
  description?: string;
  config: ViewConfig;
}

export interface UpdateViewInput {
  id: string;
  name: string;
  description?: string;
  config?: ViewConfig;
}
