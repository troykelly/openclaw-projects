export type BoardStatus = 'not_started' | 'in_progress' | 'blocked' | 'done';

export type BoardPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface BoardItem {
  id: string;
  title: string;
  status: BoardStatus;
  priority: BoardPriority;
  estimateMinutes?: number;
  assignee?: string;
  assigneeAvatar?: string;
}

export interface BoardColumn {
  id: BoardStatus;
  title: string;
  items: BoardItem[];
}

export interface BoardState {
  columns: BoardColumn[];
}
