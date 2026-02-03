/**
 * Week View component
 * Issue #408: Implement calendar view for due dates
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import { CalendarItem } from './calendar-item';
import type { CalendarEvent, DayEvents } from './types';

export interface WeekViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
  onDateClick?: (date: Date) => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getWeekDays(date: Date): DayEvents[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get start of week (Sunday)
  const startOfWeek = new Date(date);
  startOfWeek.setDate(date.getDate() - date.getDay());

  const days: DayEvents[] = [];

  for (let i = 0; i < 7; i++) {
    const day = new Date(startOfWeek);
    day.setDate(startOfWeek.getDate() + i);
    days.push({
      date: day,
      events: [],
      isToday:
        day.getDate() === today.getDate() &&
        day.getMonth() === today.getMonth() &&
        day.getFullYear() === today.getFullYear(),
      isCurrentMonth: day.getMonth() === date.getMonth(),
    });
  }

  return days;
}

function getEventsForDate(events: CalendarEvent[], date: Date): CalendarEvent[] {
  const dateStr = date.toISOString().split('T')[0];
  return events.filter((event) => event.date === dateStr);
}

export function WeekView({
  currentDate,
  events,
  onEventClick,
  onDateClick,
}: WeekViewProps) {
  const days = getWeekDays(currentDate);

  // Add events to days
  const daysWithEvents = days.map((day) => ({
    ...day,
    events: getEventsForDate(events, day.date),
  }));

  return (
    <div data-testid="week-view" className="w-full">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b">
        {daysWithEvents.map((day, index) => (
          <div
            key={index}
            className={cn(
              'px-2 py-2 text-center border-r',
              day.isToday && 'bg-accent/20'
            )}
          >
            <div className="text-sm text-muted-foreground">
              {DAY_NAMES[index]} {day.date.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* Day columns */}
      <div className="grid grid-cols-7 min-h-[400px]">
        {daysWithEvents.map((day, index) => (
          <div
            key={index}
            data-testid={`week-day-${index}`}
            className={cn(
              'border-r p-2 cursor-pointer hover:bg-muted/50',
              day.isToday && 'bg-accent/10'
            )}
            onClick={() => onDateClick?.(day.date)}
          >
            <div className="space-y-2">
              {day.events.map((event) => (
                <CalendarItem
                  key={event.id}
                  event={event}
                  onClick={onEventClick}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
