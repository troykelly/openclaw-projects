/**
 * Utilities for grouping items
 */
import type { ItemGroup, GroupField } from './types';
import { STATUS_LABELS, PRIORITY_LABELS, KIND_LABELS, DUE_DATE_LABELS } from './types';

// Re-export for convenience
export type { GroupField };

/**
 * Order for status values
 */
const STATUS_ORDER = ['not_started', 'in_progress', 'blocked', 'done', 'cancelled'];

/**
 * Order for priority values
 */
const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'];

/**
 * Order for kind values
 */
const KIND_ORDER = ['project', 'initiative', 'epic', 'issue', 'task'];

/**
 * Order for due date groups
 */
const DUE_DATE_ORDER = ['overdue', 'today', 'this_week', 'next_week', 'later', 'no_date'];

/**
 * Get the due date group for a date string
 */
function getDueDateGroup(dateStr?: string): string {
  if (!dateStr) return 'no_date';

  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 7) return 'this_week';
  if (diffDays <= 14) return 'next_week';
  return 'later';
}

/**
 * Get label for a group value
 */
function getGroupLabel(field: GroupField, value: string): string {
  switch (field) {
    case 'status':
      return STATUS_LABELS[value] || value;
    case 'priority':
      return PRIORITY_LABELS[value] || value;
    case 'kind':
      return KIND_LABELS[value] || value;
    case 'dueDate':
      return DUE_DATE_LABELS[value] || value;
    case 'assignee':
      return value === 'unassigned' ? 'Unassigned' : value;
    default:
      return value;
  }
}

/**
 * Get sort order for groups
 */
function getGroupOrder(field: GroupField): string[] {
  switch (field) {
    case 'status':
      return STATUS_ORDER;
    case 'priority':
      return PRIORITY_ORDER;
    case 'kind':
      return KIND_ORDER;
    case 'dueDate':
      return DUE_DATE_ORDER;
    default:
      return [];
  }
}

/**
 * Group items by a field
 */
export function groupItems<T extends Record<string, unknown>>(items: T[], field: GroupField): ItemGroup<T>[] {
  if (field === 'none') {
    return [
      {
        key: 'all',
        label: 'All Items',
        items,
      },
    ];
  }

  // Create groups
  const groupMap = new Map<string, T[]>();

  for (const item of items) {
    let key: string;

    switch (field) {
      case 'status':
        key = (item.status as string) || 'not_started';
        break;
      case 'priority':
        key = (item.priority as string) || 'medium';
        break;
      case 'kind':
        key = (item.kind as string) || 'issue';
        break;
      case 'assignee':
        key = (item.assigneeId as string) || 'unassigned';
        break;
      case 'parent':
        key = (item.parentId as string) || 'no_parent';
        break;
      case 'dueDate':
        key = getDueDateGroup(item.dueDate as string | undefined);
        break;
      case 'label':
        // Items can appear in multiple label groups
        const labels = (item.labels as string[]) || [];
        if (labels.length === 0) {
          const existing = groupMap.get('no_label') || [];
          groupMap.set('no_label', [...existing, item]);
        } else {
          for (const label of labels) {
            const existing = groupMap.get(label) || [];
            groupMap.set(label, [...existing, item]);
          }
        }
        continue; // Skip the normal grouping for labels
      default:
        key = 'unknown';
    }

    const existing = groupMap.get(key) || [];
    groupMap.set(key, [...existing, item]);
  }

  // Convert to array and sort
  const groups: ItemGroup<T>[] = Array.from(groupMap.entries()).map(([key, groupItems]) => ({
    key,
    label: getGroupLabel(field, key),
    items: groupItems,
  }));

  // Sort groups by predefined order
  const order = getGroupOrder(field);
  if (order.length > 0) {
    groups.sort((a, b) => {
      const aIndex = order.indexOf(a.key);
      const bIndex = order.indexOf(b.key);
      if (aIndex === -1 && bIndex === -1) return a.key.localeCompare(b.key);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  } else {
    // Alphabetical for fields without predefined order
    groups.sort((a, b) => a.label.localeCompare(b.label));
  }

  return groups;
}

/**
 * Get all possible group keys for a field (for ensuring all groups are shown)
 */
export function getAllGroupKeys(field: GroupField): string[] {
  switch (field) {
    case 'status':
      return STATUS_ORDER;
    case 'priority':
      return PRIORITY_ORDER;
    case 'kind':
      return KIND_ORDER;
    case 'dueDate':
      return DUE_DATE_ORDER;
    default:
      return [];
  }
}
