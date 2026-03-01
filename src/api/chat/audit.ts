/**
 * Chat audit logging (#1962).
 *
 * Fire-and-forget recording of chat operations into the chat_activity table.
 * Follows the same pattern as terminal/activity.ts.
 *
 * Actions logged:
 * - session_created, session_ended, session_expired
 * - message_sent (user), message_sent_agent (agent)
 * - notification_sent (attract_attention)
 * - ws_connected, ws_disconnected
 * - stream_started, stream_completed, stream_failed
 * - push_subscribed, push_unsubscribed
 *
 * Epic #1940 — Agent Chat.
 */

import type { Pool } from 'pg';

/** A chat activity event to record. */
export interface ChatActivityEvent {
  namespace: string;
  session_id?: string;
  user_email?: string;
  agent_id?: string;
  action: string;
  detail?: Record<string, unknown>;
}

/**
 * Record a chat activity event (fire-and-forget).
 *
 * Does NOT await the insert and will not throw on failure.
 * Errors are logged to stderr.
 */
export function recordChatActivity(pool: Pool, event: ChatActivityEvent): void {
  const { namespace, session_id, user_email, agent_id, action, detail } = event;

  pool
    .query(
      `INSERT INTO chat_activity (namespace, session_id, user_email, agent_id, action, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        namespace,
        session_id ?? null,
        user_email ?? null,
        agent_id ?? null,
        action,
        detail ? JSON.stringify(detail) : null,
      ],
    )
    .catch((err: unknown) => {
      console.error(
        `[Chat Audit] Failed to record activity (action=${action}):`,
        err instanceof Error ? err.message : String(err),
      );
    });
}

/**
 * Record a chat activity event and await the result.
 * Useful in tests or when confirmation of the write is needed.
 */
export async function recordChatActivitySync(pool: Pool, event: ChatActivityEvent): Promise<void> {
  const { namespace, session_id, user_email, agent_id, action, detail } = event;

  await pool.query(
    `INSERT INTO chat_activity (namespace, session_id, user_email, agent_id, action, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      namespace,
      session_id ?? null,
      user_email ?? null,
      agent_id ?? null,
      action,
      detail ? JSON.stringify(detail) : null,
    ],
  );
}
