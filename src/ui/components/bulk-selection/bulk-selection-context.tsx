/**
 * Context for managing bulk selection state
 * Issue #397: Implement bulk contact operations
 */
import * as React from 'react';

interface BulkSelectionContextValue {
  selectedIds: string[];
  toggleSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  deselectAll: () => void;
  isSelected: (id: string) => boolean;
  selectRange: (startId: string, endId: string, allIds: string[]) => void;
}

const BulkSelectionContext = React.createContext<BulkSelectionContextValue | null>(null);

export interface BulkSelectionProviderProps {
  children: React.ReactNode;
}

export function BulkSelectionProvider({ children }: BulkSelectionProviderProps) {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  const toggleSelection = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((i) => i !== id);
      }
      return [...prev, id];
    });
  }, []);

  const selectAll = React.useCallback((ids: string[]) => {
    setSelectedIds(ids);
  }, []);

  const deselectAll = React.useCallback(() => {
    setSelectedIds([]);
  }, []);

  const isSelected = React.useCallback(
    (id: string) => selectedIds.includes(id),
    [selectedIds]
  );

  const selectRange = React.useCallback(
    (startId: string, endId: string, allIds: string[]) => {
      const startIndex = allIds.indexOf(startId);
      const endIndex = allIds.indexOf(endId);

      if (startIndex === -1 || endIndex === -1) return;

      const minIndex = Math.min(startIndex, endIndex);
      const maxIndex = Math.max(startIndex, endIndex);
      const rangeIds = allIds.slice(minIndex, maxIndex + 1);

      setSelectedIds((prev) => {
        const newSelection = new Set(prev);
        for (const id of rangeIds) {
          newSelection.add(id);
        }
        return Array.from(newSelection);
      });
    },
    []
  );

  const value = React.useMemo(
    () => ({
      selectedIds,
      toggleSelection,
      selectAll,
      deselectAll,
      isSelected,
      selectRange,
    }),
    [selectedIds, toggleSelection, selectAll, deselectAll, isSelected, selectRange]
  );

  return (
    <BulkSelectionContext.Provider value={value}>
      {children}
    </BulkSelectionContext.Provider>
  );
}

export function useBulkSelection() {
  const context = React.useContext(BulkSelectionContext);
  if (!context) {
    throw new Error('useBulkSelection must be used within a BulkSelectionProvider');
  }
  return context;
}
