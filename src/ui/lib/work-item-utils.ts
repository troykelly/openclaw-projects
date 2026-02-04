/**
 * Shared utility functions and constants for work item display.
 *
 * Used by page components to render consistent status icons, priority
 * colors, and kind indicators across the application.
 */
import type {
  WorkItemStatus,
  WorkItemPriority,
  WorkItemKind,
} from '@/ui/components/detail/types';
import type { TreeItem, TreeItemKind } from '@/ui/components/tree/types';
import type { WorkItemTreeNode } from '@/ui/lib/api-types';

/** CSS class map for priority badge backgrounds. */
export const priorityColors: Record<string, string> = {
  P0: 'bg-red-500 text-white',
  P1: 'bg-orange-500 text-white',
  P2: 'bg-yellow-500 text-white',
  P3: 'bg-green-500 text-white',
  P4: 'bg-gray-500 text-white',
};

/** CSS class map for kind badge backgrounds. */
export const kindColors: Record<string, string> = {
  project: 'bg-blue-500',
  initiative: 'bg-violet-500',
  epic: 'bg-emerald-500',
  issue: 'bg-gray-500',
};

/** SVG fill class map for kinds (used in timeline charts). */
export const kindFillColors: Record<string, string> = {
  project: 'fill-violet-500',
  initiative: 'fill-blue-500',
  epic: 'fill-green-500',
  issue: 'fill-amber-500',
};

/** Map API priority strings (P0-P4) to component priority type. */
export function mapApiPriority(priority: string): WorkItemPriority {
  const mapping: Record<string, WorkItemPriority> = {
    P0: 'urgent',
    P1: 'high',
    P2: 'medium',
    P3: 'low',
    P4: 'low',
  };
  return mapping[priority] ?? 'medium';
}

/** Map component priority type back to API priority string. */
export function mapPriorityToApi(priority: WorkItemPriority): string {
  const mapping: Record<WorkItemPriority, string> = {
    urgent: 'P0',
    high: 'P1',
    medium: 'P2',
    low: 'P3',
  };
  return mapping[priority] ?? 'P2';
}

/**
 * Recursively map API tree nodes to component TreeItem format.
 * Converts snake_case API fields to the camelCase format expected by ProjectTree.
 */
export function mapApiTreeToTreeItems(apiItems: WorkItemTreeNode[]): TreeItem[] {
  return apiItems.map((item) => ({
    id: item.id,
    title: item.title,
    kind: item.kind as TreeItemKind,
    status: item.status as 'not_started' | 'in_progress' | 'blocked' | 'done' | 'cancelled',
    parentId: item.parent_id,
    childCount: item.children_count,
    children: item.children.length > 0 ? mapApiTreeToTreeItems(item.children) : undefined,
  }));
}

/** Find a tree item by ID, searching recursively through children. */
export function findTreeItem(items: TreeItem[], id: string): TreeItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findTreeItem(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Flatten a tree into a list of potential parent items for the move dialog.
 * Returns id, title, and kind for each item in the hierarchy.
 */
export function flattenTreeForParents(
  items: TreeItem[],
): Array<{ id: string; title: string; kind: string }> {
  const result: Array<{ id: string; title: string; kind: string }> = [];
  const traverse = (treeItems: TreeItem[]): void => {
    for (const treeItem of treeItems) {
      result.push({ id: treeItem.id, title: treeItem.title, kind: treeItem.kind });
      if (treeItem.children) {
        traverse(treeItem.children);
      }
    }
  };
  traverse(items);
  return result;
}

/** Read the bootstrap JSON injected by the server into the page. */
export function readBootstrap<T = Record<string, unknown>>(): T | null {
  const el = document.getElementById('app-bootstrap');
  if (!el) return null;
  const text = el.textContent;
  if (!text) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Format minutes into a human-readable duration string. */
export function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h`;
  }
  return `${minutes}m`;
}

/** Get initials from a display name (max 2 characters). */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
