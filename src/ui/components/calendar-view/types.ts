/**
 * Types for calendar view
 * Issue #408: Implement calendar view for due dates
 */

export type CalendarViewMode = 'month' | 'week';

export type Priority = 'high' | 'medium' | 'low';
export type Status = 'open' | 'in_progress' | 'closed';

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // ISO date string (YYYY-MM-DD)
  endDate?: string; // For multi-day events
  priority?: Priority;
  status?: Status;
  assignee?: string;
  color?: string;
}

export interface DayEvents {
  date: Date;
  events: CalendarEvent[];
  isToday: boolean;
  isCurrentMonth: boolean;
}
