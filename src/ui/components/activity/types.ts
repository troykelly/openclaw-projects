export type ActorType = 'agent' | 'human';

export type ActionType =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_changed'
  | 'commented'
  | 'assigned'
  | 'completed'
  | 'moved';

export type EntityType =
  | 'project'
  | 'initiative'
  | 'epic'
  | 'issue'
  | 'contact'
  | 'memory';

export interface ActivityItem {
  id: string;
  actorType: ActorType;
  actorName: string;
  actorId?: string;
  action: ActionType;
  entityType: EntityType;
  entityId: string;
  entityTitle: string;
  parentEntityTitle?: string;
  parentEntityId?: string;
  detail?: string;
  timestamp: Date;
  read?: boolean;
}

export interface ActivityFilter {
  actorType?: ActorType;
  actionType?: ActionType;
  entityType?: EntityType;
  projectId?: string;
  timeRange?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'all';
}

export interface TimeGroup {
  label: string;
  items: ActivityItem[];
}
