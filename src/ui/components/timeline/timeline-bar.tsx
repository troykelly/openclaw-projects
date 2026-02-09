import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import type { TimelineItem, TimelineItemStatus } from './types';

function getStatusColor(status: TimelineItemStatus): string {
  switch (status) {
    case 'not_started':
      return 'bg-muted-foreground/50';
    case 'in_progress':
      return 'bg-blue-500';
    case 'blocked':
      return 'bg-red-500';
    case 'done':
      return 'bg-green-500';
  }
}

function getOverdueColor(): string {
  return 'bg-red-600';
}

export interface TimelineBarProps {
  item: TimelineItem;
  left: number;
  width: number;
  isOverdue?: boolean;
  isCriticalPath?: boolean;
  showProgress?: boolean;
  onClick?: (item: TimelineItem) => void;
  onDragStart?: (item: TimelineItem, edge: 'start' | 'end') => void;
  className?: string;
}

export function TimelineBar({ item, left, width, isOverdue, isCriticalPath, showProgress = true, onClick, onDragStart, className }: TimelineBarProps) {
  const progress = item.progress ?? 0;
  const baseColor = isOverdue ? getOverdueColor() : getStatusColor(item.status);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(item);
  };

  const handleDragStart = (edge: 'start' | 'end') => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onDragStart?.(item, edge);
  };

  return (
    <div
      data-testid="timeline-bar"
      className={cn(
        'absolute top-1 h-6 cursor-pointer rounded-sm transition-all',
        'hover:ring-2 hover:ring-ring hover:ring-offset-1',
        isCriticalPath && 'ring-2 ring-amber-500',
        className,
      )}
      style={{ left: `${left}px`, width: `${Math.max(width, 4)}px` }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`${item.title}: ${item.startDate.toLocaleDateString()} - ${item.endDate.toLocaleDateString()}`}
    >
      {/* Background */}
      <div className={cn('absolute inset-0 rounded-sm opacity-30', baseColor)} />

      {/* Progress fill */}
      {showProgress && progress > 0 && <div className={cn('absolute inset-y-0 left-0 rounded-l-sm', baseColor)} style={{ width: `${progress}%` }} />}

      {/* Title (only show if bar is wide enough) */}
      {width > 60 && (
        <span className="absolute inset-0 flex items-center overflow-hidden px-2 text-xs font-medium">
          <span className="truncate">{item.title}</span>
        </span>
      )}

      {/* Drag handles */}
      {onDragStart && (
        <>
          <div className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" onMouseDown={handleDragStart('start')} />
          <div className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" onMouseDown={handleDragStart('end')} />
        </>
      )}
    </div>
  );
}
