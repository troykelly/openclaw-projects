/**
 * Chat data retention and GDPR deletion (#1964).
 *
 * Provides functions for:
 * - Purging all chat data for a specific user (GDPR right-to-erasure)
 * - Purging a specific session and all related data
 *
 * The bulk retention cleanup is handled by pg_cron (migration 129).
 *
 * Epic #1940 — Agent Chat.
 */

import type { Pool } from 'pg';

/** Result of a GDPR deletion operation. */
export interface DeletionResult {
  sessions_deleted: number;
  messages_deleted: number;
  activity_deleted: number;
}

/**
 * Delete ALL chat data for a user (GDPR right-to-erasure).
 *
 * Cascade order:
 * 1. chat_read_cursor (FK to chat_session)
 * 2. chat_activity (FK SET NULL to chat_session)
 * 3. external_message (FK to external_thread)
 * 4. chat_session (FK CASCADE to external_thread)
 * 5. chat_activity by user_email (no FK)
 * 6. notification_dedup by user_email
 * 7. notification_rate by user_email
 *
 * Uses a transaction for atomicity.
 */
export async function deleteAllChatDataForUser(
  pool: Pool,
  userEmail: string,
): Promise<DeletionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Count sessions before deletion for the result
    const sessionCountResult = await client.query(
      `SELECT count(*)::int AS cnt FROM chat_session WHERE user_email = $1`,
      [userEmail],
    );
    const sessionsDeleted = (sessionCountResult.rows[0] as { cnt: number }).cnt;

    // Get thread IDs for message counting
    const threadResult = await client.query(
      `SELECT thread_id FROM chat_session WHERE user_email = $1`,
      [userEmail],
    );
    const threadIds = (threadResult.rows as { thread_id: string }[]).map(r => r.thread_id);

    // Count messages before deletion
    let messagesDeleted = 0;
    if (threadIds.length > 0) {
      const msgCountResult = await client.query(
        `SELECT count(*)::int AS cnt FROM external_message WHERE thread_id = ANY($1::uuid[])`,
        [threadIds],
      );
      messagesDeleted = (msgCountResult.rows[0] as { cnt: number }).cnt;
    }

    // Delete read cursors (CASCADE handles this too, but explicit is clearer)
    await client.query(
      `DELETE FROM chat_read_cursor WHERE user_email = $1`,
      [userEmail],
    );

    // Delete chat sessions (CASCADE deletes external_thread -> external_message)
    await client.query(
      `DELETE FROM chat_session WHERE user_email = $1`,
      [userEmail],
    );

    // Delete activity logs for this user
    const activityResult = await client.query(
      `DELETE FROM chat_activity WHERE user_email = $1`,
      [userEmail],
    );
    const activityDeleted = activityResult.rowCount ?? 0;

    // Delete notification tracking
    await client.query(
      `DELETE FROM notification_dedup WHERE user_email = $1`,
      [userEmail],
    );
    await client.query(
      `DELETE FROM notification_rate WHERE user_email = $1`,
      [userEmail],
    );

    await client.query('COMMIT');

    return {
      sessions_deleted: sessionsDeleted,
      messages_deleted: messagesDeleted,
      activity_deleted: activityDeleted,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Delete a specific chat session and all related data.
 *
 * Returns true if the session existed and was deleted.
 */
export async function deleteChatSession(
  pool: Pool,
  sessionId: string,
  userEmail: string,
): Promise<boolean> {
  // Delete the session (CASCADE handles thread -> messages, read_cursor)
  const result = await pool.query(
    `DELETE FROM chat_session WHERE id = $1 AND user_email = $2`,
    [sessionId, userEmail],
  );

  if ((result.rowCount ?? 0) > 0) {
    // Clean up activity logs for this session
    await pool.query(
      `DELETE FROM chat_activity WHERE session_id = $1`,
      [sessionId],
    ).catch((err: unknown) => {
      console.error('[Chat Retention] Failed to clean activity:', err instanceof Error ? err.message : String(err));
    });
    return true;
  }

  return false;
}
