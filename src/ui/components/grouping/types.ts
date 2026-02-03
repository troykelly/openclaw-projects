/**
 * Types for grouping system
 */

/**
 * Fields that can be used for grouping
 */
export type GroupField =
  | 'none'
  | 'status'
  | 'priority'
  | 'kind'
  | 'assignee'
  | 'parent'
  | 'label'
  | 'dueDate';

/**
 * A group of items
 */
export interface ItemGroup<T> {
  key: string;
  label: string;
  items: T[];
}

/**
 * Grouping state
 */
export interface GroupState {
  groupBy: GroupField;
  collapsedGroups: Set<string>;
}

/**
 * Props for GroupBySelect component
 */
export interface GroupBySelectProps {
  value: GroupField;
  onChange: (field: GroupField) => void;
  availableFields?: GroupField[];
  className?: string;
}

/**
 * Props for GroupHeader component
 */
export interface GroupHeaderProps {
  label: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * Props for GroupedList component
 */
export interface GroupedListProps<T> {
  items: T[];
  groupBy: GroupField;
  renderItem: (item: T) => React.ReactNode;
  collapsedGroups?: Set<string>;
  onToggleGroup?: (key: string) => void;
  hideEmptyGroups?: boolean;
  className?: string;
}

/**
 * Return type for useGrouping hook
 */
export interface UseGroupingReturn {
  groupBy: GroupField;
  setGroupBy: (field: GroupField) => void;
  collapsedGroups: Set<string>;
  toggleGroup: (key: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

/**
 * Labels for group fields
 */
export const GROUP_FIELD_LABELS: Record<GroupField, string> = {
  none: 'None',
  status: 'Status',
  priority: 'Priority',
  kind: 'Kind',
  assignee: 'Assignee',
  parent: 'Parent',
  label: 'Label',
  dueDate: 'Due Date',
};

/**
 * Labels for status values
 */
export const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

/**
 * Labels for priority values
 */
export const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * Labels for kind values
 */
export const KIND_LABELS: Record<string, string> = {
  project: 'Project',
  initiative: 'Initiative',
  epic: 'Epic',
  issue: 'Issue',
  task: 'Task',
};

/**
 * Labels for due date groups
 */
export const DUE_DATE_LABELS: Record<string, string> = {
  overdue: 'Overdue',
  today: 'Today',
  this_week: 'This Week',
  next_week: 'Next Week',
  later: 'Later',
  no_date: 'No Date',
};
