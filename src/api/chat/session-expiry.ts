/**
 * Chat session expiry utilities (#1961).
 *
 * Provides application-level session expiry checks to supplement
 * the pg_cron job (migration 127). Sessions idle beyond the
 * configured threshold are eagerly expired on access.
 *
 * Epic #1940 — Agent Chat.
 */

/** Default idle timeout in hours (matches pg_cron default). */
const DEFAULT_EXPIRY_HOURS = 24;

/** Session expiry threshold in milliseconds. */
function getExpiryMs(): number {
  const hours = parseInt(process.env.CHAT_SESSION_EXPIRY_HOURS ?? '', 10);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_EXPIRY_HOURS) * 3_600_000;
}

/**
 * Check whether a session should be considered expired based on
 * its last_activity_at timestamp.
 *
 * This is a pure function — it does NOT mutate the database.
 * Call `expireSessionInDb` to persist the status change.
 */
export function isSessionExpired(lastActivityAt: Date | string): boolean {
  const lastActivity = typeof lastActivityAt === 'string'
    ? new Date(lastActivityAt).getTime()
    : lastActivityAt.getTime();
  return Date.now() - lastActivity >= getExpiryMs();
}

/**
 * Eagerly expire a session in the database if it is idle beyond
 * the configured threshold. Returns true if the session was expired.
 *
 * Uses UPDATE ... WHERE status = 'active' for idempotency.
 * The status transition trigger will auto-set ended_at.
 */
export async function expireSessionIfIdle(
  pool: { query: (sql: string, params: unknown[]) => Promise<{ rowCount: number | null }> },
  sessionId: string,
  lastActivityAt: Date | string,
): Promise<boolean> {
  if (!isSessionExpired(lastActivityAt)) return false;

  const result = await pool.query(
    `UPDATE chat_session
     SET status = 'expired', version = version + 1
     WHERE id = $1 AND status = 'active'`,
    [sessionId],
  );

  return (result.rowCount ?? 0) > 0;
}

/** Exported for testing. */
export const SESSION_EXPIRY = {
  getExpiryMs,
  defaultHours: DEFAULT_EXPIRY_HOURS,
} as const;
