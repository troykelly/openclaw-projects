export type TreeItemKind = 'project' | 'initiative' | 'epic' | 'issue';

export type TreeItemStatus = 'not_started' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export interface TreeItem {
  id: string;
  title: string;
  kind: TreeItemKind;
  status: TreeItemStatus;
  parent_id: string | null;
  childCount?: number;
  children?: TreeItem[];
}

export interface TreeState {
  expandedIds: Set<string>;
  selectedId: string | null;
}

export interface TreeDragData {
  item_id: string;
  kind: TreeItemKind;
  parent_id: string | null;
}

export interface TreeDropTarget {
  item_id: string;
  position: 'before' | 'after' | 'inside';
}
