/**
 * Calendar Item component
 * Issue #408: Implement calendar view for due dates
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import type { CalendarEvent } from './types';

export interface CalendarItemProps {
  event: CalendarEvent;
  onClick?: (event: CalendarEvent) => void;
  compact?: boolean;
}

const priorityColors: Record<string, string> = {
  high: 'bg-red-100 border-red-300 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-200',
  medium: 'bg-yellow-100 border-yellow-300 text-yellow-800 dark:bg-yellow-950 dark:border-yellow-800 dark:text-yellow-200',
  low: 'bg-green-100 border-green-300 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200',
};

const statusStyles: Record<string, string> = {
  open: '',
  in_progress: 'border-l-4 border-l-blue-500',
  closed: 'opacity-60 line-through',
};

export function CalendarItem({ event, onClick, compact = false }: CalendarItemProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(event);
  };

  const priorityClass = priorityColors[event.priority || 'medium'];
  const statusClass = statusStyles[event.status || 'open'];

  return (
    <div
      data-testid={`calendar-item-${event.id}`}
      data-priority={event.priority}
      data-status={event.status}
      className={cn(
        'truncate cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors hover:opacity-80',
        priorityClass,
        statusClass,
        compact && 'text-[10px] px-1',
      )}
      onClick={handleClick}
      title={event.title}
    >
      {event.title}
    </div>
  );
}
