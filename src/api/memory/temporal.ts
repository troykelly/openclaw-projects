/**
 * Temporal/relative time resolution for memory search (Issue #1272).
 * Fixed: timezone handling and month-end rollover (Issue #2443).
 *
 * Parses relative durations ("7d", "2w", "1m", "24h"), ISO dates,
 * and period shorthands ("today", "last_week", etc.) into absolute Date objects.
 */

const DURATION_RE = /^(\d+)([hdwm])$/;

/** Strict ISO 8601 date-time with explicit offset */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Date-only: YYYY-MM-DD (interpreted as UTC start-of-day) */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Safely subtract months from a date, clamping to end-of-month.
 * Jan 31 minus 1 month = Dec 31 (not March 3).
 * Mar 31 minus 1 month = Feb 28/29.
 */
function subtractMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const targetMonth = result.getUTCMonth() - months;
  const targetYear = result.getUTCFullYear();

  // Move to first of the target month to avoid rollover
  result.setUTCDate(1);
  result.setUTCMonth(targetMonth);

  // Now clamp the day to the last day of the target month
  const originalDay = date.getUTCDate();
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();

  result.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return result;
}

/**
 * Resolve a relative time string to an absolute Date.
 *
 * Accepts:
 * - Relative durations: "7d", "24h", "2w", "1m"
 * - ISO date-time with explicit offset: "2026-01-01T00:00:00Z", "2026-01-01T10:00:00+05:30"
 * - Date-only strings: "2026-01-15" (interpreted as UTC start-of-day)
 *
 * Rejects:
 * - Timezone-less datetime strings (e.g., "2026-01-01T00:00:00")
 *
 * Returns null if the input cannot be parsed.
 */
export function resolveRelativeTime(input: string, now: Date = new Date()): Date | null {
  if (!input) return null;

  const trimmed = input.trim();

  const match = trimmed.match(DURATION_RE);
  if (match) {
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    const result = new Date(now);

    switch (unit) {
      case 'h':
        result.setUTCHours(result.getUTCHours() - amount);
        break;
      case 'd':
        result.setUTCDate(result.getUTCDate() - amount);
        break;
      case 'w':
        result.setUTCDate(result.getUTCDate() - amount * 7);
        break;
      case 'm':
        return subtractMonths(result, amount);
    }

    return result;
  }

  // Accept date-only strings (interpreted as UTC start-of-day)
  if (DATE_ONLY_RE.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    if (isNaN(parsed.getTime())) return null;
    return parsed;
  }

  // Accept strict ISO 8601 with explicit timezone offset
  if (ISO_DATETIME_RE.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return null;
    return parsed;
  }

  // Reject ambiguous formats (no timezone offset)
  return null;
}

/** Valid period shorthand values */
export const VALID_PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month'] as const;
export type Period = (typeof VALID_PERIODS)[number];

/**
 * Resolve a period shorthand to a { since, before } date range.
 * All calculations use UTC to ensure deterministic behavior.
 * Returns null if the period is not recognized.
 */
export function resolvePeriod(
  period: string,
  now: Date = new Date(),
): { since: Date; before?: Date } | null {
  switch (period) {
    case 'today': {
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      return { since };
    }
    case 'yesterday': {
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
      const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      return { since, before };
    }
    case 'this_week': {
      // Week starts on Monday (ISO 8601)
      const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ...
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMonday));
      return { since };
    }
    case 'last_week': {
      const dayOfWeek = now.getUTCDay();
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMonday));
      const lastMonday = new Date(thisMonday);
      lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
      return { since: lastMonday, before: thisMonday };
    }
    case 'this_month': {
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { since };
    }
    case 'last_month': {
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { since, before };
    }
    default:
      return null;
  }
}
