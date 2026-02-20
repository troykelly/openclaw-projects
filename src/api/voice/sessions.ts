/**
 * Voice conversation session management.
 * Handles session lifecycle, idle timeout, and cleanup.
 *
 * Issue #1434 — Conversation history and session management.
 * Epic #1431.
 */

import type { Pool } from 'pg';
import type { VoiceConversationRow, VoiceAgentConfigRow } from './types.ts';

/** Default idle timeout in seconds (5 minutes). */
const DEFAULT_IDLE_TIMEOUT_S = 300;

/** Default retention period in days (30 days). */
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Check if a conversation session is expired (idle timeout exceeded).
 */
export function isSessionExpired(
  conversation: VoiceConversationRow,
  idleTimeoutS: number = DEFAULT_IDLE_TIMEOUT_S,
): boolean {
  const now = Date.now();
  const lastActive = new Date(conversation.last_active_at).getTime();
  return now - lastActive > idleTimeoutS * 1000;
}

/**
 * Find an active (non-expired) session for a given namespace/agent/user combination.
 * Returns null if no active session exists.
 */
export async function findActiveSession(
  pool: Pool,
  namespace: string,
  agentId: string | null,
  userEmail: string | null,
  idleTimeoutS: number = DEFAULT_IDLE_TIMEOUT_S,
): Promise<VoiceConversationRow | null> {
  const cutoff = new Date(Date.now() - idleTimeoutS * 1000);

  const result = await pool.query<VoiceConversationRow>(
    `SELECT * FROM voice_conversation
     WHERE namespace = $1
       AND ($2::text IS NULL OR agent_id = $2)
       AND ($3::text IS NULL OR user_email = $3)
       AND last_active_at > $4
     ORDER BY last_active_at DESC
     LIMIT 1`,
    [namespace, agentId, userEmail, cutoff],
  );

  return result.rows[0] ?? null;
}

/**
 * List active sessions for a namespace.
 */
export async function listActiveSessions(
  pool: Pool,
  namespace: string,
  idleTimeoutS: number = DEFAULT_IDLE_TIMEOUT_S,
): Promise<VoiceConversationRow[]> {
  const cutoff = new Date(Date.now() - idleTimeoutS * 1000);

  const result = await pool.query<VoiceConversationRow>(
    `SELECT * FROM voice_conversation
     WHERE namespace = $1 AND last_active_at > $2
     ORDER BY last_active_at DESC`,
    [namespace, cutoff],
  );

  return result.rows;
}

/**
 * Get the idle timeout for a namespace from config.
 * Falls back to DEFAULT_IDLE_TIMEOUT_S if no config exists.
 */
export async function getIdleTimeout(
  pool: Pool,
  namespace: string,
): Promise<number> {
  const result = await pool.query<Pick<VoiceAgentConfigRow, 'idle_timeout_s'>>(
    'SELECT idle_timeout_s FROM voice_agent_config WHERE namespace = $1',
    [namespace],
  );
  return result.rows[0]?.idle_timeout_s ?? DEFAULT_IDLE_TIMEOUT_S;
}

/**
 * Clean up expired conversation sessions.
 * Deletes conversations older than the retention period.
 *
 * Returns the number of deleted conversations.
 */
export async function cleanupExpiredSessions(
  pool: Pool,
  namespace?: string,
): Promise<number> {
  // If namespace is provided, use its retention config; otherwise use default
  let retentionDays = DEFAULT_RETENTION_DAYS;

  if (namespace) {
    const configResult = await pool.query<Pick<VoiceAgentConfigRow, 'retention_days'>>(
      'SELECT retention_days FROM voice_agent_config WHERE namespace = $1',
      [namespace],
    );
    if (configResult.rows[0]) {
      retentionDays = configResult.rows[0].retention_days;
    }
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  let result;
  if (namespace) {
    result = await pool.query(
      `DELETE FROM voice_conversation
       WHERE namespace = $1 AND last_active_at < $2
       RETURNING id`,
      [namespace, cutoff],
    );
  } else {
    // Global cleanup: each namespace uses its own retention or default
    result = await pool.query(
      `DELETE FROM voice_conversation vc
       WHERE vc.last_active_at < NOW() - (
         COALESCE(
           (SELECT vac.retention_days FROM voice_agent_config vac WHERE vac.namespace = vc.namespace),
           $1
         ) * INTERVAL '1 day'
       )
       RETURNING vc.id`,
      [DEFAULT_RETENTION_DAYS],
    );
  }

  const count = result.rows.length;
  if (count > 0) {
    console.log(`[VoiceCleanup] Deleted ${count} expired conversation(s)${namespace ? ` in namespace ${namespace}` : ''}`);
  }
  return count;
}
