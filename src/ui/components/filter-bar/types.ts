/**
 * Types for the filter bar component
 */

export type FilterField = 'status' | 'priority' | 'kind' | 'assignee' | 'createdDate' | 'updatedDate' | 'dueDate' | 'parent' | 'hasDescription' | 'hasEstimate';

export type DateRangePreset = 'today' | 'this_week' | 'this_month' | 'overdue' | 'upcoming' | 'custom';

export interface DateRange {
  preset?: DateRangePreset;
  from?: string; // ISO date string
  to?: string; // ISO date string
}

export interface FilterState {
  status?: string[];
  priority?: string[];
  kind?: string[];
  assignee?: string[]; // 'me' is a special value for current user
  createdDate?: DateRange | string;
  updatedDate?: DateRange | string;
  dueDate?: DateRange | string;
  parent?: string | null; // null means root only
  hasDescription?: boolean;
  hasEstimate?: boolean;
  search?: string;
}

export interface SavedFilter {
  id: string;
  name: string;
  filters: FilterState;
  created_at?: string;
  isDefault?: boolean;
}

export interface FilterFieldConfig {
  field: FilterField;
  label: string;
  icon?: React.ReactNode;
  type: 'multi-select' | 'date-range' | 'boolean' | 'single-select';
  options?: Array<{ value: string; label: string }>;
}

export interface QuickFilter {
  id: string;
  label: string;
  filters: FilterState;
  icon?: React.ReactNode;
}

export interface FilterBarProps {
  /** Current filter state */
  filters: FilterState;
  /** Called when filters change */
  onFiltersChange: (filters: FilterState) => void;
  /** Show quick filter chips */
  showQuickFilters?: boolean;
  /** Available quick filters */
  quickFilters?: QuickFilter[];
  /** Saved filters for dropdown */
  savedFilters?: SavedFilter[];
  /** Called when user wants to save current filter */
  onSaveFilter?: (name: string, filters: FilterState) => void;
  /** Called when user wants to delete a saved filter */
  onDeleteFilter?: (id: string) => void;
  /** Additional fields to show beyond defaults */
  additionalFields?: FilterFieldConfig[];
  /** Hide certain fields */
  hideFields?: FilterField[];
  /** Custom className */
  className?: string;
}
