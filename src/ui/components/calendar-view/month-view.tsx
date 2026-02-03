/**
 * Month View component
 * Issue #408: Implement calendar view for due dates
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import { CalendarItem } from './calendar-item';
import type { CalendarEvent, DayEvents } from './types';

export interface MonthViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
  onDateClick?: (date: Date) => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getMonthDays(date: Date): DayEvents[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get first day of month and calculate start of grid (previous Sunday)
  const firstDay = new Date(year, month, 1);
  const startOfGrid = new Date(firstDay);
  startOfGrid.setDate(firstDay.getDate() - firstDay.getDay());

  // Get last day of month and calculate end of grid (next Saturday)
  const lastDay = new Date(year, month + 1, 0);
  const endOfGrid = new Date(lastDay);
  endOfGrid.setDate(lastDay.getDate() + (6 - lastDay.getDay()));

  const days: DayEvents[] = [];
  const current = new Date(startOfGrid);

  while (current <= endOfGrid) {
    days.push({
      date: new Date(current),
      events: [],
      isToday:
        current.getDate() === today.getDate() &&
        current.getMonth() === today.getMonth() &&
        current.getFullYear() === today.getFullYear(),
      isCurrentMonth: current.getMonth() === month,
    });
    current.setDate(current.getDate() + 1);
  }

  return days;
}

function getEventsForDate(events: CalendarEvent[], date: Date): CalendarEvent[] {
  const dateStr = date.toISOString().split('T')[0];
  return events.filter((event) => event.date === dateStr);
}

export function MonthView({
  currentDate,
  events,
  onEventClick,
  onDateClick,
}: MonthViewProps) {
  const days = getMonthDays(currentDate);

  // Add events to days
  const daysWithEvents = days.map((day) => ({
    ...day,
    events: getEventsForDate(events, day.date),
  }));

  return (
    <div data-testid="month-view" className="w-full">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b">
        {DAY_NAMES.map((name) => (
          <div
            key={name}
            className="px-2 py-2 text-sm font-medium text-muted-foreground text-center"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {daysWithEvents.map((day, index) => (
          <div
            key={index}
            data-testid={`day-${day.date.getDate()}`}
            data-today={day.isToday}
            className={cn(
              'min-h-24 border-b border-r p-1 cursor-pointer hover:bg-muted/50',
              !day.isCurrentMonth && 'bg-muted/30 text-muted-foreground',
              day.isToday && 'bg-accent/20'
            )}
            onClick={() => onDateClick?.(day.date)}
          >
            <div
              className={cn(
                'text-sm font-medium mb-1',
                day.isToday &&
                  'bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center'
              )}
            >
              {day.date.getDate()}
            </div>
            <div className="space-y-1">
              {day.events.slice(0, 3).map((event) => (
                <CalendarItem
                  key={event.id}
                  event={event}
                  onClick={onEventClick}
                  compact
                />
              ))}
              {day.events.length > 3 && (
                <div className="text-xs text-muted-foreground px-1">
                  +{day.events.length - 3} more
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
