import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Clock, User, GripVertical } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Card } from '@/ui/components/ui/card';
import { Badge } from '@/ui/components/ui/badge';
import type { BoardItem, BoardPriority } from './types';

function getPriorityVariant(priority: BoardPriority): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (priority) {
    case 'urgent':
      return 'destructive';
    case 'high':
      return 'default';
    case 'medium':
      return 'secondary';
    case 'low':
      return 'outline';
  }
}

function getPriorityLabel(priority: BoardPriority): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function formatEstimate(minutes: number | undefined): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export interface BoardCardProps {
  item: BoardItem;
  onClick?: (item: BoardItem) => void;
  isDragging?: boolean;
  className?: string;
}

export function BoardCard({ item, onClick, isDragging, className }: BoardCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: item.id,
    data: {
      type: 'card',
      item,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragging = isDragging || isSortableDragging;
  const estimate = formatEstimate(item.estimateMinutes);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      data-testid="board-card"
      className={cn(
        'cursor-pointer p-3 transition-all',
        'hover:border-primary/50 hover:shadow-sm',
        dragging && 'opacity-50 rotate-2 scale-105 shadow-lg',
        className
      )}
      onClick={() => onClick?.(item)}
    >
      <div className="space-y-2">
        {/* Drag handle and title */}
        <div className="flex items-start gap-2">
          <div
            {...attributes}
            {...listeners}
            className="mt-0.5 cursor-grab text-muted-foreground opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="size-4" />
          </div>
          <h4 className="flex-1 text-sm font-medium leading-tight">{item.title}</h4>
        </div>

        {/* Metadata row */}
        <div className="flex items-center justify-between gap-2">
          <Badge variant={getPriorityVariant(item.priority)} className="text-xs">
            {getPriorityLabel(item.priority)}
          </Badge>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {estimate && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {estimate}
              </span>
            )}
            {item.assignee && (
              <span className="flex items-center gap-1" title={item.assignee}>
                {item.assigneeAvatar ? (
                  <img
                    src={item.assigneeAvatar}
                    alt={item.assignee}
                    className="size-5 rounded-full"
                  />
                ) : (
                  <div className="flex size-5 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {item.assignee.charAt(0).toUpperCase()}
                  </div>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// Simplified card for drag overlay (no sortable context)
export function BoardCardOverlay({ item }: { item: BoardItem }) {
  const estimate = formatEstimate(item.estimateMinutes);

  return (
    <Card className="w-64 rotate-2 p-3 shadow-xl ring-2 ring-primary">
      <div className="space-y-2">
        <h4 className="text-sm font-medium leading-tight">{item.title}</h4>
        <div className="flex items-center justify-between gap-2">
          <Badge variant={getPriorityVariant(item.priority)} className="text-xs">
            {getPriorityLabel(item.priority)}
          </Badge>
          {estimate && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" />
              {estimate}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
