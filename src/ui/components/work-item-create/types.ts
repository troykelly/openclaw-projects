export type WorkItemKind = 'project' | 'initiative' | 'epic' | 'issue';

export type WorkItemStatus = 'not_started' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export type WorkItemPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface WorkItemCreatePayload {
  title: string;
  kind: WorkItemKind;
  description?: string;
  parent_id?: string | null;
  estimateMinutes?: number | null;
}

export interface CreatedWorkItem {
  id: string;
  title: string;
  kind: WorkItemKind;
  description?: string | null;
  parent_id?: string | null;
  estimate_minutes?: number | null;
}

export interface QuickAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (item: CreatedWorkItem) => void;
  defaultParentId?: string;
  defaultKind?: WorkItemKind;
}

export interface WorkItemCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (item: CreatedWorkItem) => void;
  defaultParentId?: string;
  defaultKind?: WorkItemKind;
}

export interface ParentSelectorItem {
  id: string;
  title: string;
  kind: WorkItemKind;
  depth: number;
}
