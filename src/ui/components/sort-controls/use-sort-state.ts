import { useState, useCallback, useEffect, useMemo } from 'react';
import type { SortState, SortField, SortDirection } from './types';

const STORAGE_PREFIX = 'openclaw-sort-';

const DEFAULT_SORT: SortState = {
  field: 'created',
  direction: 'desc',
};

// Priority order for sorting
const PRIORITY_ORDER: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// Status order for sorting
const STATUS_ORDER: Record<string, number> = {
  not_started: 1,
  in_progress: 2,
  blocked: 3,
  done: 4,
  cancelled: 5,
};

// Kind order for sorting
const KIND_ORDER: Record<string, number> = {
  project: 1,
  initiative: 2,
  epic: 3,
  issue: 4,
};

/**
 * Get sort value for comparison
 */
function getSortValue(item: Record<string, unknown>, field: SortField): string | number | null {
  switch (field) {
    case 'title':
      return (item.title as string)?.toLowerCase() ?? '';
    case 'created':
      return item.created_at ?? item.createdAt ?? item.created ?? '';
    case 'updated':
      return item.updated_at ?? item.updatedAt ?? item.updated ?? '';
    case 'dueDate':
      return item.due_date ?? item.dueDate ?? item.not_after ?? null;
    case 'startDate':
      return item.start_date ?? item.startDate ?? item.not_before ?? null;
    case 'priority':
      return PRIORITY_ORDER[(item.priority as string)?.toLowerCase()] ?? 0;
    case 'status':
      return STATUS_ORDER[(item.status as string)?.toLowerCase()] ?? 0;
    case 'estimate':
      return (item.estimate_minutes ?? item.estimateMinutes ?? 0) as number;
    case 'kind':
      return KIND_ORDER[(item.kind as string)?.toLowerCase()] ?? 0;
    default:
      return '';
  }
}

/**
 * Compare two values for sorting
 */
function compareValues(a: string | number | null, b: string | number | null, direction: SortDirection): number {
  // Handle null values - push to end
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  let result: number;
  if (typeof a === 'number' && typeof b === 'number') {
    result = a - b;
  } else {
    result = String(a).localeCompare(String(b));
  }

  return direction === 'asc' ? result : -result;
}

/**
 * Sort items by the given sort state
 */
export function sortItems<T extends Record<string, unknown>>(items: T[], sort: SortState): T[] {
  return [...items].sort((a, b) => {
    // Primary sort
    const aValue = getSortValue(a, sort.field);
    const bValue = getSortValue(b, sort.field);
    const primaryResult = compareValues(aValue, bValue, sort.direction);

    // If equal and secondary sort exists, use it
    if (primaryResult === 0 && sort.secondaryField) {
      const aSecondary = getSortValue(a, sort.secondaryField);
      const bSecondary = getSortValue(b, sort.secondaryField);
      return compareValues(aSecondary, bSecondary, sort.secondaryDirection ?? 'asc');
    }

    return primaryResult;
  });
}

/**
 * Hook for managing sort state with localStorage persistence
 */
export function useSortState(viewId: string, defaultSort: SortState = DEFAULT_SORT) {
  // Initialize from localStorage or default
  const [sort, setSortInternal] = useState<SortState>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_PREFIX + viewId);
        if (stored) {
          return JSON.parse(stored);
        }
      } catch {
        // Ignore parse errors
      }
    }
    return defaultSort;
  });

  // Persist to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_PREFIX + viewId, JSON.stringify(sort));
    }
  }, [viewId, sort]);

  const setSort = useCallback((newSort: SortState) => {
    setSortInternal(newSort);
  }, []);

  const setField = useCallback((field: SortField) => {
    setSortInternal((prev) => ({
      ...prev,
      field,
    }));
  }, []);

  const toggleDirection = useCallback(() => {
    setSortInternal((prev) => ({
      ...prev,
      direction: prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const setSecondarySort = useCallback((field: SortField | undefined, direction?: SortDirection) => {
    setSortInternal((prev) => ({
      ...prev,
      secondaryField: field,
      secondaryDirection: direction ?? 'asc',
    }));
  }, []);

  const clearSecondarySort = useCallback(() => {
    setSortInternal((prev) => {
      const { secondaryField, secondaryDirection, ...rest } = prev;
      return rest as SortState;
    });
  }, []);

  // Query string for API calls
  const queryString = useMemo(() => {
    const parts = [`${sort.field}:${sort.direction}`];
    if (sort.secondaryField) {
      parts.push(`${sort.secondaryField}:${sort.secondaryDirection ?? 'asc'}`);
    }
    return `sort=${parts.join(',')}`;
  }, [sort]);

  return {
    sort,
    setSort,
    setField,
    toggleDirection,
    setSecondarySort,
    clearSecondarySort,
    queryString,
  };
}
