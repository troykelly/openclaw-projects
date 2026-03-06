/**
 * max_sessions enforcement for terminal connections.
 *
 * Issue #2191, Sub-item 7 — Enforce max_sessions at create-session time.
 *
 * Uses `SELECT ... FOR UPDATE` to acquire a row-level lock on the connection,
 * preventing race conditions where concurrent session creation could exceed
 * the limit.
 */

/** Queryable interface (works with both Pool and PoolClient). */
interface Queryable {
  query<T extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** Result of max_sessions check. */
export interface MaxSessionsCheckResult {
  allowed: boolean;
  current: number;
  max: number | null;
  error?: string;
}

/**
 * Check whether a new session can be created for the given connection.
 *
 * MUST be called within a transaction for the FOR UPDATE lock to be effective.
 * If max_sessions is NULL, sessions are unlimited.
 *
 * @param client - Database client (within a transaction)
 * @param connectionId - Connection UUID to check
 * @returns Whether the session is allowed, with current/max counts
 */
export async function checkMaxSessions(
  client: Queryable,
  connectionId: string,
): Promise<MaxSessionsCheckResult> {
  // Lock the connection row to prevent concurrent session creation races
  const connResult = await client.query<{ max_sessions: number | null }>(
    `SELECT max_sessions FROM terminal_connection WHERE id = $1 FOR UPDATE`,
    [connectionId],
  );

  if (connResult.rows.length === 0) {
    return { allowed: false, current: 0, max: 0, error: 'Connection not found' };
  }

  const maxSessions = connResult.rows[0].max_sessions;

  // Count active sessions for this connection
  const countResult = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM terminal_session
     WHERE connection_id = $1 AND status IN ('starting', 'active', 'idle', 'pending_host_verification')`,
    [connectionId],
  );

  const current = parseInt(countResult.rows[0].count, 10);

  // NULL means unlimited
  if (maxSessions === null) {
    return { allowed: true, current, max: null };
  }

  return {
    allowed: current < maxSessions,
    current,
    max: maxSessions,
  };
}
