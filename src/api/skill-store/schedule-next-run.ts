/**
 * Compute next_run_at for skill_store_schedule entries.
 * Issue #1356: next_run_at was never computed, causing every enabled schedule
 * to fire every minute regardless of cron_expression.
 */

import { CronExpressionParser } from 'cron-parser';

/**
 * Compute the next run time for a cron expression in a given timezone.
 * @param cronExpression - Standard 5-field cron expression (min hour dom month dow)
 * @param timezone - IANA timezone name (e.g., 'America/New_York')
 * @param currentDate - Optional reference date (defaults to now)
 * @returns The next scheduled run time as a Date
 */
export function computeNextRunAt(cronExpression: string, timezone: string, currentDate?: Date): Date {
  const expr = CronExpressionParser.parse(cronExpression, {
    tz: timezone,
    currentDate: currentDate ?? new Date(),
  });

  return expr.next().toDate();
}
