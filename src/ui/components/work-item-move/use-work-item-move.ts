import * as React from 'react';
import type { UseWorkItemMoveOptions, UseWorkItemMoveReturn } from './types';

export function useWorkItemMove(options: UseWorkItemMoveOptions = {}): UseWorkItemMoveReturn {
  const { onMoved, onError } = options;

  const [isMoving, setIsMoving] = React.useState(false);

  const moveItem = React.useCallback(
    async (item: { id: string; title: string }, newParentId: string | null) => {
      setIsMoving(true);
      try {
        const response = await fetch(`/api/work-items/${item.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            parent_id: newParentId,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to move item');
        }

        onMoved?.();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Unknown error'));
      } finally {
        setIsMoving(false);
      }
    },
    [onMoved, onError],
  );

  const moveItems = React.useCallback(
    async (items: { id: string; title: string }[], newParentId: string | null) => {
      setIsMoving(true);
      try {
        // Move items in parallel
        await Promise.all(
          items.map((item) =>
            fetch(`/api/work-items/${item.id}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                parent_id: newParentId,
              }),
            }),
          ),
        );

        onMoved?.();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Unknown error'));
      } finally {
        setIsMoving(false);
      }
    },
    [onMoved, onError],
  );

  return {
    moveItem,
    moveItems,
    isMoving,
  };
}
