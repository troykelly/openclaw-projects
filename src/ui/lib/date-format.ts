/**
 * Timezone-aware date formatting utilities.
 *
 * All functions accept an IANA timezone string and delegate to Intl.DateTimeFormat
 * so that dates render in the user's stored timezone, falling back to the
 * browser's local timezone when no timezone is provided.
 *
 * A module-level default timezone can be set via `setDefaultTimezone()` — the
 * app root calls this once when settings load so that all formatting uses
 * the user's timezone without requiring explicit passing at every call site.
 *
 * @see Issue #2517 — Epic #2509
 */

/** Module-level default timezone (set by the app root via setDefaultTimezone). */
let _defaultTimezone: string | undefined;

/**
 * Set the default IANA timezone used by all formatting functions.
 * Called once by the app root when user settings load.
 */
export function setDefaultTimezone(tz: string | undefined): void {
  _defaultTimezone = tz;
}

/**
 * Get the current default timezone.
 */
export function getDefaultTimezone(): string | undefined {
  return _defaultTimezone;
}

/** Resolve timezone: explicit param > module default > undefined (browser default). */
function resolveTimezone(tz?: string): string | undefined {
  return tz ?? _defaultTimezone;
}

/**
 * Formats a date for display (e.g. "Mar 14, 2026").
 *
 * @param date - Date object, ISO string, or timestamp
 * @param timezone - IANA timezone string (e.g. "Australia/Sydney"). Omit for browser default.
 * @param options - Additional Intl.DateTimeFormat options to merge
 */
export function formatDate(
  date: Date | string | number,
  timezone?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(date);
  if (!d) return '';

  const tz = resolveTimezone(timezone);
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
    ...(tz ? { timeZone: tz } : {}),
  };

  return d.toLocaleDateString(undefined, opts);
}

/**
 * Formats a short date (e.g. "Mar 14").
 */
export function formatShortDate(
  date: Date | string | number,
  timezone?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return formatDate(date, timezone, { year: undefined, ...options });
}

/**
 * Formats a time for display (e.g. "2:30 PM").
 *
 * @param date - Date object, ISO string, or timestamp
 * @param timezone - IANA timezone string
 * @param options - Additional Intl.DateTimeFormat options to merge
 */
export function formatTime(
  date: Date | string | number,
  timezone?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(date);
  if (!d) return '';

  const tz = resolveTimezone(timezone);
  const opts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    ...options,
    ...(tz ? { timeZone: tz } : {}),
  };

  return d.toLocaleTimeString(undefined, opts);
}

/**
 * Formats a full date+time for display (e.g. "Mar 14, 2026, 2:30 PM").
 *
 * @param date - Date object, ISO string, or timestamp
 * @param timezone - IANA timezone string
 * @param options - Additional Intl.DateTimeFormat options to merge
 */
export function formatDateTime(
  date: Date | string | number,
  timezone?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(date);
  if (!d) return '';

  const tz = resolveTimezone(timezone);
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...options,
    ...(tz ? { timeZone: tz } : {}),
  };

  return d.toLocaleString(undefined, opts);
}

/**
 * Formats a relative date separator (e.g. "Today", "Yesterday", "Monday", "March 14, 2026").
 */
export function formatDateSeparator(
  date: Date | string | number,
  timezone?: string,
): string {
  const d = toDate(date);
  if (!d) return '';

  const now = new Date();
  const tz = resolveTimezone(timezone);
  const opts: Intl.DateTimeFormatOptions = tz ? { timeZone: tz } : {};
  const todayStr = now.toLocaleDateString(undefined, { ...opts, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateStr = d.toLocaleDateString(undefined, { ...opts, year: 'numeric', month: '2-digit', day: '2-digit' });

  if (dateStr === todayStr) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString(undefined, { ...opts, year: 'numeric', month: '2-digit', day: '2-digit' });
  if (dateStr === yesterdayStr) return 'Yesterday';

  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 7) return d.toLocaleDateString(undefined, { ...opts, weekday: 'long' });
  return d.toLocaleDateString(undefined, { ...opts, month: 'long', day: 'numeric', year: 'numeric' });
}

/** Safely coerce a value to a Date, returning null on failure. */
function toDate(value: Date | string | number): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}
