/**
 * Types for activity feed filtering and personalization
 * Issue #403: Implement activity feed filtering and personalization
 */

export type ActorType = 'human' | 'agent' | 'all';

export type ActionType = 'created' | 'updated' | 'status_changed' | 'commented' | 'assigned' | 'completed' | 'deleted' | 'moved';

export type EntityType = 'project' | 'initiative' | 'epic' | 'issue' | 'task' | 'contact' | 'memory';

export type TimeRange = 'today' | 'this_week' | 'this_month' | 'custom';

export interface ActivityFilters {
  actor_type?: ActorType;
  actionType?: ActionType[];
  entity_type?: EntityType[];
  timeRange?: TimeRange;
  startDate?: string;
  endDate?: string;
  myActivityOnly?: boolean;
  project_id?: string;
  contact_id?: string;
  excludeActions?: ActionType[];
}

export interface ActivityChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface ActivityItem {
  id: string;
  action: ActionType;
  entity_type: EntityType;
  entity_id: string;
  entityTitle: string;
  actor_id: string;
  actorName: string;
  actorAvatar?: string;
  actor_type: ActorType;
  timestamp: string;
  changes?: ActivityChange[];
  comment?: string;
}

export interface QuickFilterPreset {
  id: string;
  name: string;
  filters: ActivityFilters;
  icon?: string;
}

export interface ActivityPersonalizationSettings {
  defaultFilters: ActivityFilters;
  showMyActivityFirst: boolean;
  collapseThreshold: number;
  autoRefresh: boolean;
  refreshInterval: number;
}

export const ACTION_TYPES: { value: ActionType; label: string }[] = [
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'status_changed', label: 'Status Changed' },
  { value: 'commented', label: 'Commented' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'completed', label: 'Completed' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'moved', label: 'Moved' },
];

export const ACTOR_TYPES: { value: ActorType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'human', label: 'Human' },
  { value: 'agent', label: 'Agent' },
];

export const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'initiative', label: 'Initiative' },
  { value: 'epic', label: 'Epic' },
  { value: 'issue', label: 'Issue' },
  { value: 'task', label: 'Task' },
  { value: 'contact', label: 'Contact' },
  { value: 'memory', label: 'Memory' },
];

export const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'custom', label: 'Custom Range' },
];

export function countActiveFilters(filters: ActivityFilters): number {
  let count = 0;
  if (filters.actor_type && filters.actor_type !== 'all') count++;
  if (filters.actionType && filters.actionType.length > 0) count++;
  if (filters.entity_type && filters.entity_type.length > 0) count++;
  if (filters.timeRange) count++;
  if (filters.myActivityOnly) count++;
  if (filters.project_id) count++;
  if (filters.contact_id) count++;
  if (filters.excludeActions && filters.excludeActions.length > 0) count++;
  return count;
}
