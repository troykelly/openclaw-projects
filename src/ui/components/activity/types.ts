/**
 * Types for contact activity timeline
 * Issue #396: Implement contact activity timeline
 */

/** Activity types */
export type ActivityType =
  | 'work_item_assignment'
  | 'work_item_mention'
  | 'email_sent'
  | 'email_received'
  | 'calendar_event'
  | 'relationship_added'
  | 'relationship_removed'
  | 'contact_updated'
  | 'note_added';

/** Source types for navigation */
export type ActivitySourceType = 'work_item' | 'email' | 'calendar' | 'relationship' | 'contact' | 'note';

/** An activity entry */
export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  description?: string;
  timestamp: string;
  sourceType: ActivitySourceType;
  sourceId: string;
  metadata?: Record<string, string>;
}

/** A group of activities by date */
export interface ActivityGroup {
  label: string;
  date: Date;
  activities: Activity[];
}

/** Date range for filtering */
export interface DateRange {
  start: Date;
  end: Date;
}

/** Activity statistics */
export interface ActivityStatistics {
  total: number;
  mostCommonType: ActivityType | null;
  lastInteraction: Date | null;
  typeCounts: Record<ActivityType, number>;
}

/** Actor type for activity feed */
export type ActorType = 'agent' | 'human' | 'system';

/** Action type for activity items */
export type ActionType = 'created' | 'updated' | 'deleted' | 'commented' | 'completed' | 'assigned' | 'mentioned';

/** Entity type for activity items */
export type EntityType = 'issue' | 'project' | 'task' | 'comment' | 'contact';

/** Time range for filtering */
export type TimeRange = 'all' | 'today' | 'yesterday' | 'this_week' | 'this_month';

/** Activity item for feed display */
export interface ActivityItem {
  id: string;
  actorType: ActorType;
  actorName: string;
  action: ActionType;
  entityType: EntityType;
  entityId: string;
  entityTitle: string;
  parentEntityTitle?: string;
  parentEntityId?: string;
  timestamp: Date;
  read: boolean;
  detail?: string;
}

/** Filter options for activity feed */
export interface ActivityFilter {
  actorType?: ActorType;
  actionType?: ActionType;
  entityType?: EntityType;
  projectId?: string;
  timeRange?: TimeRange;
}

/** Time-grouped activities */
export interface TimeGroup {
  label: string;
  items: ActivityItem[];
}
