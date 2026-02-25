/**
 * Audit trail recording for terminal operations.
 *
 * Provides a fire-and-forget `recordActivity()` function that inserts into
 * the terminal_activity table without blocking the calling operation.
 *
 * Issue #1686 — Audit trail (terminal_activity)
 * Epic #1667 — TMux Session Management
 */

import type { Pool } from 'pg';

/** An activity event to record in the audit trail. */
export interface ActivityEvent {
  namespace: string;
  session_id?: string;
  connection_id?: string;
  actor: string;
  action: string;
  detail?: Record<string, unknown>;
}

/**
 * Record an activity event in the terminal_activity table.
 *
 * This is fire-and-forget: it does NOT await the insert and will not
 * throw on failure. Errors are logged to stderr.
 */
export function recordActivity(pool: Pool, event: ActivityEvent): void {
  const { namespace, session_id, connection_id, actor, action, detail } = event;

  pool
    .query(
      `INSERT INTO terminal_activity (namespace, session_id, connection_id, actor, action, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        namespace,
        session_id ?? null,
        connection_id ?? null,
        actor,
        action,
        detail ? JSON.stringify(detail) : null,
      ],
    )
    .catch((err: unknown) => {
      console.error(
        `Failed to record terminal activity (action=${action}):`,
        err instanceof Error ? err.message : String(err),
      );
    });
}

/**
 * Record an activity event and await the result.
 * Useful in tests or when you need confirmation the record was written.
 */
export async function recordActivitySync(pool: Pool, event: ActivityEvent): Promise<void> {
  const { namespace, session_id, connection_id, actor, action, detail } = event;

  await pool.query(
    `INSERT INTO terminal_activity (namespace, session_id, connection_id, actor, action, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      namespace,
      session_id ?? null,
      connection_id ?? null,
      actor,
      action,
      detail ? JSON.stringify(detail) : null,
    ],
  );
}
