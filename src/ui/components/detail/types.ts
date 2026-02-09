export type WorkItemKind = 'project' | 'initiative' | 'epic' | 'issue';

export type WorkItemStatus = 'not_started' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export type WorkItemPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface WorkItemTodo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: Date;
  completedAt?: Date;
}

export interface WorkItemAttachment {
  id: string;
  type: 'memory' | 'contact' | 'email' | 'calendar';
  title: string;
  subtitle?: string;
  linkedAt: Date;
}

export interface WorkItemDependency {
  id: string;
  title: string;
  kind: WorkItemKind;
  status: WorkItemStatus;
  direction: 'blocks' | 'blocked_by';
}

export interface WorkItemDetail {
  id: string;
  title: string;
  kind: WorkItemKind;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  description?: string;
  parentId?: string;
  parentTitle?: string;
  assignee?: string;
  estimateMinutes?: number;
  actualMinutes?: number;
  dueDate?: Date;
  startDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  todos: WorkItemTodo[];
  attachments: WorkItemAttachment[];
  dependencies: WorkItemDependency[];
}
