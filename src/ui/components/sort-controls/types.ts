/**
 * Types for sort controls
 */

export type SortField =
  | 'title'
  | 'created'
  | 'updated'
  | 'dueDate'
  | 'startDate'
  | 'priority'
  | 'status'
  | 'estimate'
  | 'kind';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  field: SortField;
  direction: SortDirection;
  secondaryField?: SortField;
  secondaryDirection?: SortDirection;
}

export interface SortFieldConfig {
  field: SortField;
  label: string;
  defaultDirection?: SortDirection;
}

export interface SortControlsProps {
  /** Current sort state */
  sort: SortState;
  /** Called when sort changes */
  onSortChange: (sort: SortState) => void;
  /** Available sort fields (defaults to all) */
  fields?: SortField[];
  /** Show secondary sort option */
  showSecondarySort?: boolean;
  /** Custom className */
  className?: string;
  /** Compact mode for tight spaces */
  compact?: boolean;
}
