import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { LayoutGrid, List } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { ScrollArea, ScrollBar } from '@/ui/components/ui/scroll-area';
import { BoardColumn } from './board-column';
import { BoardCardOverlay } from './board-card';
import type { BoardItem, BoardStatus, BoardColumn as ColumnType, BoardPriority } from './types';

const DEFAULT_COLUMNS: ColumnType[] = [
  { id: 'not_started', title: 'To Do', items: [] },
  { id: 'in_progress', title: 'In Progress', items: [] },
  { id: 'blocked', title: 'Blocked', items: [] },
  { id: 'done', title: 'Done', items: [] },
];

function groupItemsByStatus(items: BoardItem[]): ColumnType[] {
  const columns = DEFAULT_COLUMNS.map((col) => ({
    ...col,
    items: items.filter((item) => item.status === col.id),
  }));
  return columns;
}

export type ViewMode = 'board' | 'list';

export interface KanbanBoardProps {
  items: BoardItem[];
  onItemsChange?: (items: BoardItem[]) => void;
  onItemClick?: (item: BoardItem) => void;
  onAddItem?: (status: BoardStatus) => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  className?: string;
  /** Called when a card title is edited inline */
  onTitleChange?: (id: string, newTitle: string) => void;
  /** Called when a card priority is cycled */
  onPriorityChange?: (id: string, newPriority: BoardPriority) => void;
}

export function KanbanBoard({
  items,
  onItemsChange,
  onItemClick,
  onAddItem,
  viewMode = 'board',
  onViewModeChange,
  className,
  onTitleChange,
  onPriorityChange,
}: KanbanBoardProps) {
  const [activeItem, setActiveItem] = useState<BoardItem | null>(null);
  const [overColumn, setOverColumn] = useState<BoardStatus | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const columns = useMemo(() => groupItemsByStatus(items), [items]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const item = items.find((i) => i.id === active.id);
      if (item) {
        setActiveItem(item);
      }
    },
    [items],
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setOverColumn(null);
      return;
    }

    // Check if over a column
    if (over.data.current?.type === 'column') {
      setOverColumn(over.id as BoardStatus);
    } else if (over.data.current?.type === 'card') {
      // Find which column the card is in
      const cardItem = over.data.current.item as BoardItem;
      setOverColumn(cardItem.status);
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveItem(null);
      setOverColumn(null);

      if (!over) return;

      const activeId = active.id as string;
      let newStatus: BoardStatus | null = null;

      // Determine the target status
      if (over.data.current?.type === 'column') {
        newStatus = over.id as BoardStatus;
      } else if (over.data.current?.type === 'card') {
        const overItem = over.data.current.item as BoardItem;
        newStatus = overItem.status;
      }

      if (!newStatus) return;

      // Find the item and update its status if changed
      const itemIndex = items.findIndex((i) => i.id === activeId);
      if (itemIndex === -1) return;

      const item = items[itemIndex];
      if (item.status === newStatus) return; // No change

      // Optimistic update
      const newItems = items.map((i) => (i.id === activeId ? { ...i, status: newStatus! } : i));
      onItemsChange?.(newItems);
    },
    [items, onItemsChange],
  );

  const handleDragCancel = useCallback(() => {
    setActiveItem(null);
    setOverColumn(null);
  }, []);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* View mode toggle */}
      {onViewModeChange && (
        <div className="flex items-center justify-end gap-1 border-b p-2">
          <Button variant={viewMode === 'board' ? 'secondary' : 'ghost'} size="sm" onClick={() => onViewModeChange('board')}>
            <LayoutGrid className="mr-1 size-4" />
            Board
          </Button>
          <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="sm" onClick={() => onViewModeChange('list')}>
            <List className="mr-1 size-4" />
            List
          </Button>
        </div>
      )}

      {/* Board */}
      <ScrollArea className="flex-1">
        <div className="flex gap-4 p-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {columns.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                onItemClick={onItemClick}
                onAddItem={onAddItem}
                isOver={overColumn === column.id}
                onTitleChange={onTitleChange}
                onPriorityChange={onPriorityChange}
              />
            ))}
            <DragOverlay>{activeItem && <BoardCardOverlay item={activeItem} />}</DragOverlay>
          </DndContext>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-muted-foreground">No items on this board</p>
            {onAddItem && (
              <Button variant="outline" size="sm" className="mt-4" onClick={() => onAddItem('not_started')}>
                Add first item
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
