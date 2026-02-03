/**
 * Hook for managing grouping state with persistence
 */
import * as React from 'react';
import type { GroupField, UseGroupingReturn } from './types';

const STORAGE_PREFIX = 'grouping-';

interface StoredGroupingState {
  groupBy: GroupField;
  collapsedGroups: string[];
}

function loadState(viewId: string): StoredGroupingState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${viewId}`);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveState(viewId: string, state: StoredGroupingState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${viewId}`, JSON.stringify(state));
  } catch {
    // Storage might be full
  }
}

export function useGrouping(viewId: string): UseGroupingReturn {
  const [groupBy, setGroupByState] = React.useState<GroupField>(() => {
    const stored = loadState(viewId);
    return stored?.groupBy || 'none';
  });

  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(
    () => {
      const stored = loadState(viewId);
      return new Set(stored?.collapsedGroups || []);
    }
  );

  // Persist changes
  React.useEffect(() => {
    saveState(viewId, {
      groupBy,
      collapsedGroups: Array.from(collapsedGroups),
    });
  }, [viewId, groupBy, collapsedGroups]);

  const setGroupBy = React.useCallback((field: GroupField) => {
    setGroupByState(field);
    // Reset collapsed groups when changing grouping
    setCollapsedGroups(new Set());
  }, []);

  const toggleGroup = React.useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const expandAll = React.useCallback(() => {
    setCollapsedGroups(new Set());
  }, []);

  const collapseAll = React.useCallback(() => {
    // This would need knowledge of all current groups
    // For now, it's a no-op that can be enhanced with group keys
  }, []);

  return {
    groupBy,
    setGroupBy,
    collapsedGroups,
    toggleGroup,
    expandAll,
    collapseAll,
  };
}
