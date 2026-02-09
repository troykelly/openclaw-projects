import * as React from 'react';
import type { UseWorkItemDeleteOptions, UseWorkItemDeleteReturn, UndoState } from './types';

export function useWorkItemDelete(options: UseWorkItemDeleteOptions = {}): UseWorkItemDeleteReturn {
  const { onDeleted, onRestored, onError } = options;

  const [isDeleting, setIsDeleting] = React.useState(false);
  const [undoState, setUndoState] = React.useState<UndoState | null>(null);

  // Store deleted item IDs for restore
  const deletedItemsRef = React.useRef<string[]>([]);

  const restoreItem = React.useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`/api/work-items/${id}/restore`, {
          method: 'POST',
        });

        if (!response.ok) {
          throw new Error('Failed to restore item');
        }

        setUndoState(null);
        deletedItemsRef.current = [];
        onRestored?.();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Unknown error'));
      }
    },
    [onRestored, onError],
  );

  const handleUndo = React.useCallback(async () => {
    // Restore all deleted items
    const itemsToRestore = deletedItemsRef.current;
    for (const id of itemsToRestore) {
      await restoreItem(id);
    }
  }, [restoreItem]);

  const deleteItem = React.useCallback(
    async (item: { id: string; title: string }) => {
      setIsDeleting(true);
      try {
        const response = await fetch(`/api/work-items/${item.id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error('Failed to delete item');
        }

        deletedItemsRef.current = [item.id];

        setUndoState({
          itemId: item.id,
          itemTitle: item.title,
          onUndo: handleUndo,
        });

        onDeleted?.();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Unknown error'));
      } finally {
        setIsDeleting(false);
      }
    },
    [onDeleted, onError, handleUndo],
  );

  const deleteItems = React.useCallback(
    async (items: { id: string; title: string }[]) => {
      setIsDeleting(true);
      try {
        // Delete items in parallel
        await Promise.all(
          items.map((item) =>
            fetch(`/api/work-items/${item.id}`, {
              method: 'DELETE',
            }),
          ),
        );

        deletedItemsRef.current = items.map((i) => i.id);

        setUndoState({
          itemId: items[0].id,
          itemTitle: items[0].title,
          itemCount: items.length,
          onUndo: handleUndo,
        });

        onDeleted?.();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Unknown error'));
      } finally {
        setIsDeleting(false);
      }
    },
    [onDeleted, onError, handleUndo],
  );

  const dismissUndo = React.useCallback(() => {
    setUndoState(null);
    deletedItemsRef.current = [];
  }, []);

  return {
    deleteItem,
    deleteItems,
    restoreItem,
    isDeleting,
    undoState,
    dismissUndo,
  };
}
