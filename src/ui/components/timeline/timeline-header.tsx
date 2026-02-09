import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import type { TimelineZoom, TimelineDateRange } from './types';

function getDaysBetween(start: Date, end: Date): number {
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function formatHeaderDate(date: Date, zoom: TimelineZoom): string {
  switch (zoom) {
    case 'day':
      return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
    case 'week':
      return `W${getWeekNumber(date)}`;
    case 'month':
      return date.toLocaleDateString(undefined, { month: 'short' });
    case 'quarter':
      return `Q${Math.floor(date.getMonth() / 3) + 1}`;
  }
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getUnitWidth(zoom: TimelineZoom): number {
  switch (zoom) {
    case 'day':
      return 40;
    case 'week':
      return 80;
    case 'month':
      return 120;
    case 'quarter':
      return 200;
  }
}

function getUnits(range: TimelineDateRange, zoom: TimelineZoom): Date[] {
  const units: Date[] = [];
  const current = new Date(range.start);

  while (current <= range.end) {
    units.push(new Date(current));

    switch (zoom) {
      case 'day':
        current.setDate(current.getDate() + 1);
        break;
      case 'week':
        current.setDate(current.getDate() + 7);
        break;
      case 'month':
        current.setMonth(current.getMonth() + 1);
        break;
      case 'quarter':
        current.setMonth(current.getMonth() + 3);
        break;
    }
  }

  return units;
}

export interface TimelineHeaderProps {
  dateRange: TimelineDateRange;
  zoom: TimelineZoom;
  todayPosition?: number;
  className?: string;
}

export function TimelineHeader({ dateRange, zoom, todayPosition, className }: TimelineHeaderProps) {
  const units = getUnits(dateRange, zoom);
  const unitWidth = getUnitWidth(zoom);

  return (
    <div className={cn('relative flex h-8 border-b bg-muted/30', className)}>
      {units.map((date, i) => {
        const isToday = date.toDateString() === new Date().toDateString();
        return (
          <div
            key={i}
            className={cn('shrink-0 border-r px-2 text-xs', 'flex items-center justify-center', isToday && 'bg-primary/10 font-medium')}
            style={{ width: `${unitWidth}px` }}
          >
            {formatHeaderDate(date, zoom)}
          </div>
        );
      })}

      {/* Today marker */}
      {todayPosition !== undefined && todayPosition >= 0 && (
        <div className="absolute top-0 bottom-0 w-0.5 bg-red-500" style={{ left: `${todayPosition}px` }}>
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 rounded bg-red-500 px-1 text-xs text-white">Today</div>
        </div>
      )}
    </div>
  );
}

export { getUnitWidth, getDaysBetween };
