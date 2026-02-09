export type TreeItemKind = 'project' | 'initiative' | 'epic' | 'issue';

export type TreeItemStatus = 'not_started' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export interface TreeItem {
  id: string;
  title: string;
  kind: TreeItemKind;
  status: TreeItemStatus;
  parentId: string | null;
  childCount?: number;
  children?: TreeItem[];
}

export interface TreeState {
  expandedIds: Set<string>;
  selectedId: string | null;
}

export interface TreeDragData {
  itemId: string;
  kind: TreeItemKind;
  parentId: string | null;
}

export interface TreeDropTarget {
  itemId: string;
  position: 'before' | 'after' | 'inside';
}
