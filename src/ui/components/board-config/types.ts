/**
 * Types for board configuration
 * Issue #409: Implement board view customization
 */

export type WorkItemStatus = 'open' | 'in_progress' | 'blocked' | 'closed';

export interface BoardColumn {
  id: string;
  name: string;
  status?: WorkItemStatus;
  order: number;
}

export type SwimlaneGroupBy = 'priority' | 'assignee' | 'label' | 'parent';

export interface SwimlaneSetting {
  groupBy: SwimlaneGroupBy;
}

export type WipLimit = number;

export type CardDisplayMode = 'compact' | 'detailed';

export type CardField = 'title' | 'status' | 'priority' | 'assignee' | 'dueDate' | 'labels' | 'estimate' | 'progress';

export interface BoardSettings {
  columns: BoardColumn[];
  swimlanes: SwimlaneSetting | null;
  wipLimits: Record<string, WipLimit>;
  cardDisplayMode: CardDisplayMode;
  visibleFields: CardField[];
}
