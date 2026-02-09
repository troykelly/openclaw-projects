import * as React from 'react';
import { createContext, useContext, useState, useCallback, useMemo } from 'react';

export interface BulkSelectionContextValue {
  selectedIds: Set<string>;
  isSelected: (id: string) => boolean;
  select: (id: string) => void;
  deselect: (id: string) => void;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  deselectAll: () => void;
  selectRange: (ids: string[], fromId: string, toId: string) => void;
  count: number;
  hasSelection: boolean;
}

const BulkSelectionContext = createContext<BulkSelectionContextValue | null>(null);

export function BulkSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const select = useCallback((id: string) => {
    setSelectedIds((prev) => new Set([...prev, id]));
  }, []);

  const deselect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectRange = useCallback((ids: string[], fromId: string, toId: string) => {
    const fromIndex = ids.indexOf(fromId);
    const toIndex = ids.indexOf(toId);

    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const rangeIds = ids.slice(start, end + 1);

    setSelectedIds((prev) => new Set([...prev, ...rangeIds]));
  }, []);

  const value = useMemo(
    () => ({
      selectedIds,
      isSelected,
      select,
      deselect,
      toggle,
      selectAll,
      deselectAll,
      selectRange,
      count: selectedIds.size,
      hasSelection: selectedIds.size > 0,
    }),
    [selectedIds, isSelected, select, deselect, toggle, selectAll, deselectAll, selectRange],
  );

  return <BulkSelectionContext.Provider value={value}>{children}</BulkSelectionContext.Provider>;
}

export function useBulkSelection() {
  const context = useContext(BulkSelectionContext);
  if (!context) {
    throw new Error('useBulkSelection must be used within a BulkSelectionProvider');
  }
  return context;
}

export function useBulkSelectionOptional() {
  return useContext(BulkSelectionContext);
}
