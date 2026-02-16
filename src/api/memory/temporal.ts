/**
 * Temporal/relative time resolution for memory search (Issue #1272).
 *
 * Parses relative durations ("7d", "2w", "1m", "24h"), ISO dates,
 * and period shorthands ("today", "last_week", etc.) into absolute Date objects.
 */

const DURATION_RE = /^(\d+)([hdwm])$/;

/**
 * Resolve a relative time string to an absolute Date.
 *
 * Accepts:
 * - Relative durations: "7d", "24h", "2w", "1m"
 * - ISO date strings: "2026-01-01T00:00:00Z"
 * - Date-only strings: "2026-01-15"
 *
 * Returns null if the input cannot be parsed.
 */
export function resolveRelativeTime(input: string, now: Date = new Date()): Date | null {
  if (!input) return null;

  const match = input.match(DURATION_RE);
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
        result.setUTCMonth(result.getUTCMonth() - amount);
        break;
    }

    return result;
  }

  // Try parsing as ISO date or date-only string
  const parsed = new Date(input);
  if (isNaN(parsed.getTime())) return null;
  return parsed;
}

/** Valid period shorthand values */
export const VALID_PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month'] as const;
export type Period = (typeof VALID_PERIODS)[number];

/**
 * Resolve a period shorthand to a { since, before } date range.
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
