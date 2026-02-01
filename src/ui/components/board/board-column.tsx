import * as React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { BoardCard } from './board-card';
import type { BoardColumn as ColumnType, BoardItem, BoardStatus } from './types';

function getStatusColor(status: BoardStatus): string {
  switch (status) {
    case 'not_started':
      return 'bg-muted-foreground/30';
    case 'in_progress':
      return 'bg-blue-500';
    case 'blocked':
      return 'bg-red-500';
    case 'done':
      return 'bg-green-500';
  }
}

export interface BoardColumnProps {
  column: ColumnType;
  onItemClick?: (item: BoardItem) => void;
  onAddItem?: (status: BoardStatus) => void;
  isOver?: boolean;
  className?: string;
}

export function BoardColumn({
  column,
  onItemClick,
  onAddItem,
  isOver,
  className,
}: BoardColumnProps) {
  const { setNodeRef, isOver: isDroppableOver } = useDroppable({
    id: column.id,
    data: {
      type: 'column',
      status: column.id,
    },
  });

  const itemIds = column.items.map((item) => item.id);
  const highlighted = isOver || isDroppableOver;

  return (
    <div
      ref={setNodeRef}
      data-testid="board-column"
      className={cn(
        'flex h-full w-72 shrink-0 flex-col rounded-lg border bg-muted/30',
        highlighted && 'ring-2 ring-primary ring-offset-2',
        className
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <div className={cn('size-2 rounded-full', getStatusColor(column.id))} />
          <h3 className="text-sm font-medium">{column.title}</h3>
          <span className="rounded-full bg-muted px-1.5 text-xs font-medium">
            {column.items.length}
          </span>
        </div>
        {onAddItem && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => onAddItem(column.id)}
          >
            <Plus className="size-4" />
            <span className="sr-only">Add item</span>
          </Button>
        )}
      </div>

      {/* Column content */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-2">
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            {column.items.map((item) => (
              <BoardCard key={item.id} item={item} onClick={onItemClick} />
            ))}
          </SortableContext>

          {column.items.length === 0 && (
            <div
              className={cn(
                'flex h-24 items-center justify-center rounded-md border-2 border-dashed',
                highlighted ? 'border-primary bg-primary/5' : 'border-muted-foreground/20'
              )}
            >
              <p className="text-xs text-muted-foreground">
                {highlighted ? 'Drop here' : 'No items'}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
