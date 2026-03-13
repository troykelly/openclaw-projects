/**
 * Temporal/relative time resolution for plugin memory tools.
 * Shared by memory_store (TTL), memory_digest, and memory_reap.
 *
 * Replicates the logic from src/api/memory/temporal.ts but in the plugin layer,
 * so plugin tools can resolve relative time strings client-side before sending
 * absolute ISO timestamps to the API.
 *
 * All calculations use UTC to ensure deterministic behaviour.
 * Issue #2434 (TTL shorthand), #2430 (memory_digest), #2443 (UTC fix reference).
 */

/** Relative duration regex: e.g. "24h", "7d", "2w", "1m", "30d" */
const DURATION_RE = /^(\d+)([hdwm])$/;

/** Strict ISO 8601 date-time with explicit timezone offset */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Date-only: YYYY-MM-DD (interpreted as UTC start-of-day) */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Supported TTL shorthand values for memory_store (Issue #2434) */
export const TTL_SHORTHANDS = ['1h', '6h', '24h', '3d', '7d', '30d'] as const;
export type TtlShorthand = typeof TTL_SHORTHANDS[number];

/**
 * Safely subtract months from a date, clamping to end-of-month.
 * Handles month-end rollover correctly (e.g. March 31 - 1 month = Feb 28/29).
 */
function subtractMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const targetMonth = result.getUTCMonth() - months;

  // Move to first of the month to avoid rollover during month change
  result.setUTCDate(1);
  result.setUTCMonth(targetMonth);

  // Clamp to last day of the target month
  const originalDay = date.getUTCDate();
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();

  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

/**
 * Add hours to a Date using UTC arithmetic.
 */
function addHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setUTCHours(result.getUTCHours() + hours);
  return result;
}

/**
 * Add days to a Date using UTC arithmetic.
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Resolve a relative or absolute time string to an absolute Date.
 *
 * Accepts:
 * - Relative durations: "24h", "7d", "2w", "1m" (subtracted from now)
 * - ISO datetime with explicit timezone: "2026-01-01T00:00:00Z"
 * - Date-only: "2026-01-15" (interpreted as UTC start-of-day)
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

  // Date-only: YYYY-MM-DD
  if (DATE_ONLY_RE.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  // Strict ISO 8601 with explicit timezone
  if (ISO_DATETIME_RE.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  return null;
}

/**
 * Resolve a TTL shorthand string (e.g. "24h", "7d") to an absolute expires_at Date.
 * Returns the date after which the memory should expire.
 *
 * Supported: "1h", "6h", "24h", "3d", "7d", "30d"
 * Max TTL: 365 days (Issue #2434 security constraint)
 *
 * Returns null if the TTL cannot be parsed or is invalid.
 */
export function resolveTtl(ttl: string, now: Date = new Date()): Date | null {
  if (!ttl) return null;

  const trimmed = ttl.trim().toLowerCase();

  const match = trimmed.match(DURATION_RE);
  if (!match) return null;

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  if (amount <= 0) return null;

  // Max 365 days
  let maxDays: number;
  switch (unit) {
    case 'h':
      maxDays = amount / 24;
      break;
    case 'd':
      maxDays = amount;
      break;
    case 'w':
      maxDays = amount * 7;
      break;
    case 'm':
      maxDays = amount * 31; // Conservative estimate
      break;
    default:
      return null;
  }

  if (maxDays > 365) return null;

  // Compute the expiry date
  switch (unit) {
    case 'h':
      return addHours(now, amount);
    case 'd':
      return addDays(now, amount);
    case 'w':
      return addDays(now, amount * 7);
    case 'm': {
      // Add months using subtractMonths logic in reverse (add)
      const result = new Date(now);
      const targetMonth = result.getUTCMonth() + amount;
      result.setUTCDate(1);
      result.setUTCMonth(targetMonth);
      const originalDay = now.getUTCDate();
      const lastDay = new Date(
        Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
      ).getUTCDate();
      result.setUTCDate(Math.min(originalDay, lastDay));
      return result;
    }
    default:
      return null;
  }
}
