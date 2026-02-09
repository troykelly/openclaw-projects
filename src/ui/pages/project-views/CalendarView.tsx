/**
 * Calendar view tab for project detail.
 *
 * Displays a month-view calendar grid showing work items
 * positioned by their due dates (not_after). Items appear as
 * colored dots/badges within their respective day cells.
 *
 * @see Issue #468
 */
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { EmptyState, Skeleton } from '@/ui/components/feedback';
import { priorityColors } from '@/ui/lib/work-item-utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Item shape accepted by CalendarView. */
export interface CalendarViewItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  kind: string;
  not_before?: string | null;
  not_after?: string | null;
}

interface CalendarViewProps {
  items: CalendarViewItem[];
  isLoading: boolean;
}

/** Status dot color classes. */
const statusDotColors: Record<string, string> = {
  open: 'bg-blue-400',
  not_started: 'bg-gray-400',
  in_progress: 'bg-yellow-400',
  blocked: 'bg-red-400',
  closed: 'bg-green-400',
  done: 'bg-green-400',
  cancelled: 'bg-gray-300',
};

/** Day names for the calendar header. */
const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Get the first day of a month. */
function getFirstDayOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

/** Get the number of days in a month. */
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Build a calendar grid for the given month. */
function buildCalendarGrid(year: number, month: number): Array<{ date: Date | null; dayOfMonth: number }> {
  const firstDay = getFirstDayOfMonth(year, month);
  const daysInMonth = getDaysInMonth(year, month);
  const startDayOfWeek = firstDay.getDay();

  const grid: Array<{ date: Date | null; dayOfMonth: number }> = [];

  // Leading empty cells
  for (let i = 0; i < startDayOfWeek; i++) {
    grid.push({ date: null, dayOfMonth: 0 });
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    grid.push({ date: new Date(year, month, day), dayOfMonth: day });
  }

  // Trailing empty cells to fill the last week
  while (grid.length % 7 !== 0) {
    grid.push({ date: null, dayOfMonth: 0 });
  }

  return grid;
}

/** Get items for a specific date string (YYYY-MM-DD). */
function getItemsForDate(items: CalendarViewItem[], dateStr: string): CalendarViewItem[] {
  return items.filter((item) => {
    if (item.not_after) {
      const dueDate = item.not_after.split('T')[0];
      return dueDate === dateStr;
    }
    return false;
  });
}

/** Format a date as YYYY-MM-DD. */
function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function CalendarView({ items, isLoading }: CalendarViewProps): React.JSX.Element {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());

  const grid = useMemo(() => buildCalendarGrid(currentYear, currentMonth), [currentYear, currentMonth]);

  const monthLabel = new Date(currentYear, currentMonth).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentYear((y) => y - 1);
      setCurrentMonth(11);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentYear((y) => y + 1);
      setCurrentMonth(0);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleToday = () => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  };

  const todayStr = toDateStr(today);

  // Count items that have due dates
  const itemsWithDates = items.filter((i) => i.not_after);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton width={200} height={24} />
          <div className="flex gap-2">
            <Skeleton width={32} height={32} />
            <Skeleton width={60} height={32} />
            <Skeleton width={32} height={32} />
          </div>
        </div>
        <Skeleton width="100%" height={400} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Calendar header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">{monthLabel}</h3>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={handlePrevMonth}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleToday}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={handleNextMonth}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="border border-border rounded-lg overflow-hidden">
        {/* Day name headers */}
        <div className="grid grid-cols-7 bg-muted/50">
          {dayNames.map((day) => (
            <div key={day} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground border-b border-border">
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {grid.map((cell, idx) => {
            if (!cell.date) {
              return <div key={`empty-${idx}`} className="min-h-[80px] sm:min-h-[100px] border-b border-r border-border bg-muted/10 last:border-r-0" />;
            }

            const dateStr = toDateStr(cell.date);
            const dayItems = getItemsForDate(items, dateStr);
            const isToday = dateStr === todayStr;
            const isWeekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;

            return (
              <div
                key={dateStr}
                className={`min-h-[80px] sm:min-h-[100px] border-b border-r border-border p-1 transition-colors ${
                  isToday ? 'bg-primary/5' : isWeekend ? 'bg-muted/20' : ''
                } last:border-r-0`}
              >
                {/* Day number */}
                <div className="flex items-center justify-between px-1 mb-1">
                  <span
                    className={`text-xs font-medium ${
                      isToday ? 'text-primary-foreground bg-primary size-5 rounded-full flex items-center justify-center' : 'text-muted-foreground'
                    }`}
                  >
                    {cell.dayOfMonth}
                  </span>
                  {dayItems.length > 2 && <span className="text-[10px] text-muted-foreground">+{dayItems.length - 2}</span>}
                </div>

                {/* Items */}
                <div className="space-y-0.5 overflow-hidden max-h-[60px]">
                  {dayItems.slice(0, 2).map((item) => (
                    <Link
                      key={item.id}
                      to={`/work-items/${item.id}`}
                      className="flex items-center gap-1 px-1 py-0.5 rounded text-[10px] leading-tight truncate hover:bg-muted/50 transition-colors"
                      title={item.title}
                    >
                      <span className={`shrink-0 size-1.5 rounded-full ${statusDotColors[item.status] ?? statusDotColors.open}`} />
                      <span className="truncate text-foreground">{item.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer info */}
      {itemsWithDates.length === 0 && items.length > 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">No items have due dates set. Add due dates to work items to see them on the calendar.</p>
      )}

      {items.length === 0 && (
        <EmptyState variant="calendar" title="No items to display" description="Add work items to this project to see them on the calendar." />
      )}
    </div>
  );
}
