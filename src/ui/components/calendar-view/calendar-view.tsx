/**
 * Calendar View component
 * Issue #408: Implement calendar view for due dates
 */
import * as React from 'react';
import { CalendarHeader } from './calendar-header';
import { MonthView } from './month-view';
import { WeekView } from './week-view';
import type { CalendarEvent, CalendarViewMode } from './types';

export interface CalendarViewProps {
  events: CalendarEvent[];
  currentDate?: Date;
  viewMode?: CalendarViewMode;
  onEventClick?: (event: CalendarEvent) => void;
  onDateClick?: (date: Date) => void;
  onDateChange?: (date: Date) => void;
  onViewModeChange?: (mode: CalendarViewMode) => void;
}

export function CalendarView({
  events,
  currentDate: controlledDate,
  viewMode: controlledViewMode,
  onEventClick,
  onDateClick,
  onDateChange,
  onViewModeChange,
}: CalendarViewProps) {
  const [internalDate, setInternalDate] = React.useState(new Date());
  const [internalViewMode, setInternalViewMode] = React.useState<CalendarViewMode>('month');

  const currentDate = controlledDate ?? internalDate;
  const viewMode = controlledViewMode ?? internalViewMode;

  const handleDateChange = (date: Date) => {
    if (onDateChange) {
      onDateChange(date);
    } else {
      setInternalDate(date);
    }
  };

  const handleViewModeChange = (mode: CalendarViewMode) => {
    if (onViewModeChange) {
      onViewModeChange(mode);
    } else {
      setInternalViewMode(mode);
    }
  };

  const handlePrevious = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setDate(newDate.getDate() - 7);
    }
    handleDateChange(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() + 1);
    } else {
      newDate.setDate(newDate.getDate() + 7);
    }
    handleDateChange(newDate);
  };

  const handleToday = () => {
    handleDateChange(new Date());
  };

  return (
    <div data-testid="calendar-view" className="w-full">
      <CalendarHeader
        currentDate={currentDate}
        viewMode={viewMode}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onToday={handleToday}
        onViewModeChange={handleViewModeChange}
      />

      {viewMode === 'month' ? (
        <MonthView currentDate={currentDate} events={events} onEventClick={onEventClick} onDateClick={onDateClick} />
      ) : (
        <WeekView currentDate={currentDate} events={events} onEventClick={onEventClick} onDateClick={onDateClick} />
      )}
    </div>
  );
}
