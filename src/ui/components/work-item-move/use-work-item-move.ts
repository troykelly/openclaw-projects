import * as React from 'react';
import { apiClient } from '@/ui/lib/api-client';
import type { UseWorkItemMoveOptions, UseWorkItemMoveReturn } from './types';

export function useWorkItemMove(options: UseWorkItemMoveOptions = {}): UseWorkItemMoveReturn {
  const { onMoved, onError } = options;

  const [isMoving, setIsMoving] = React.useState(false);

  const moveItem = React.useCallback(
    async (item: { id: string; title: string }, newParentId: string | null) => {
      setIsMoving(true);
      try {
        await apiClient.patch(`/api/work-items/${item.id}`, { parent_id: newParentId });
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
        await Promise.all(items.map((item) => apiClient.patch(`/api/work-items/${item.id}`, { parent_id: newParentId })));
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
