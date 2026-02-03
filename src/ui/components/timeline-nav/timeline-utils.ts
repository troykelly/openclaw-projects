/**
 * Utility functions for timeline zoom and navigation
 * Issue #393: Implement timeline zoom enhancements and navigation
 */

/**
 * Available zoom levels from most granular to least
 */
export type ZoomLevel = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * Ordered zoom levels for in/out operations
 */
export const ZOOM_LEVELS: ZoomLevel[] = [
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
];

/**
 * Get the number of days represented by a zoom level
 */
export function getZoomLevelDays(level: ZoomLevel): number {
  const days: Record<ZoomLevel, number> = {
    hour: 1,
    day: 1,
    week: 7,
    month: 30,
    quarter: 90,
    year: 365,
  };
  return days[level];
}

/**
 * Format zoom level for display
 */
export function formatZoomLevel(level: ZoomLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * Calculate position of a date as percentage within a range
 * @returns Percentage (0-100), can be negative or >100 if outside range
 */
export function calculateDatePosition(
  date: Date,
  rangeStart: Date,
  rangeEnd: Date
): number {
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  const dateMs = date.getTime() - rangeStart.getTime();

  if (totalMs === 0) {
    return 0;
  }

  return (dateMs / totalMs) * 100;
}

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

/**
 * Get the start of day for a date
 */
export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Get next zoom level (more detailed)
 */
export function getNextZoomIn(current: ZoomLevel): ZoomLevel | null {
  const index = ZOOM_LEVELS.indexOf(current);
  if (index <= 0) {
    return null;
  }
  return ZOOM_LEVELS[index - 1];
}

/**
 * Get previous zoom level (less detailed)
 */
export function getNextZoomOut(current: ZoomLevel): ZoomLevel | null {
  const index = ZOOM_LEVELS.indexOf(current);
  if (index >= ZOOM_LEVELS.length - 1) {
    return null;
  }
  return ZOOM_LEVELS[index + 1];
}

/**
 * Format date for display based on zoom level
 */
export function formatDateForZoom(date: Date, zoom: ZoomLevel): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  };

  switch (zoom) {
    case 'hour':
    case 'day':
      return date.toLocaleDateString('en-US', {
        ...options,
        weekday: 'short',
      });
    case 'week':
      return date.toLocaleDateString('en-US', options);
    case 'month':
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
      });
    case 'quarter':
    case 'year':
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
      });
  }
}

/**
 * Get step size in days based on zoom level
 */
export function getStepDays(zoom: ZoomLevel): number {
  switch (zoom) {
    case 'hour':
    case 'day':
      return 1;
    case 'week':
      return 7;
    case 'month':
      return 30;
    case 'quarter':
      return 90;
    case 'year':
      return 365;
  }
}
