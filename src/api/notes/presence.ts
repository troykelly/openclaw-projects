/**
 * Note presence tracking for real-time collaboration.
 * Part of Epic #338, Issue #634.
 *
 * Tracks which users are viewing/editing a note and broadcasts
 * presence updates via WebSocket.
 */

import type { Pool } from 'pg';
import type { NotePresenceUser } from '../realtime/types.ts';
import {
  emitNotePresenceJoined,
  emitNotePresenceLeft,
  emitNotePresenceList,
  emitNoteCursorUpdate,
} from '../realtime/emitter.ts';

/**
 * Presence timeout in minutes. Users who haven't updated
 * their presence within this time are considered inactive.
 */
const PRESENCE_TIMEOUT_MINUTES = 5;

/**
 * Join note presence - mark user as viewing a note.
 * Creates or updates the note_collaborator record and broadcasts to other viewers.
 */
export async function joinNotePresence(
  pool: Pool,
  noteId: string,
  userEmail: string,
  cursorPosition?: { line: number; column: number }
): Promise<NotePresenceUser[]> {
  // Verify user has access to the note
  const accessCheck = await pool.query(
    'SELECT user_can_access_note($1, $2) as has_access',
    [noteId, userEmail]
  );

  if (!accessCheck.rows[0]?.has_access) {
    throw new Error('FORBIDDEN');
  }

  // Upsert collaborator presence
  await pool.query(
    `INSERT INTO note_collaborator (note_id, user_email, last_seen_at, cursor_position)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (note_id, user_email)
     DO UPDATE SET last_seen_at = NOW(), cursor_position = COALESCE($3, note_collaborator.cursor_position)`,
    [noteId, userEmail, cursorPosition ? JSON.stringify(cursorPosition) : null]
  );

  // Get all active collaborators for this note
  const collaborators = await getActiveCollaborators(pool, noteId);

  // Find the user who just joined to build the event
  const joiningUser = collaborators.find((c) => c.email === userEmail);

  if (joiningUser) {
    // Broadcast join event to other viewers
    await emitNotePresenceJoined({
      noteId,
      user: joiningUser,
    });
  }

  return collaborators;
}

/**
 * Leave note presence - mark user as no longer viewing a note.
 * Removes the note_collaborator record and broadcasts to other viewers.
 */
export async function leaveNotePresence(
  pool: Pool,
  noteId: string,
  userEmail: string
): Promise<void> {
  // Get user info before deleting
  const userResult = await pool.query(
    `SELECT nc.user_email, nc.last_seen_at, nc.cursor_position
     FROM note_collaborator nc
     WHERE nc.note_id = $1 AND nc.user_email = $2`,
    [noteId, userEmail]
  );

  if (userResult.rows.length === 0) {
    // User wasn't tracking presence, nothing to do
    return;
  }

  // Delete the presence record
  await pool.query(
    'DELETE FROM note_collaborator WHERE note_id = $1 AND user_email = $2',
    [noteId, userEmail]
  );

  // Broadcast leave event
  const user: NotePresenceUser = {
    email: userEmail,
    lastSeenAt: userResult.rows[0].last_seen_at.toISOString(),
    cursorPosition: userResult.rows[0].cursor_position,
  };

  await emitNotePresenceLeft({
    noteId,
    user,
  });
}

/**
 * Update cursor position for a user viewing a note.
 * Updates the note_collaborator record and broadcasts to other viewers.
 */
export async function updateCursorPosition(
  pool: Pool,
  noteId: string,
  userEmail: string,
  cursorPosition: { line: number; column: number }
): Promise<void> {
  // Update cursor position and refresh last_seen_at
  const result = await pool.query(
    `UPDATE note_collaborator
     SET cursor_position = $3, last_seen_at = NOW()
     WHERE note_id = $1 AND user_email = $2
     RETURNING id`,
    [noteId, userEmail, JSON.stringify(cursorPosition)]
  );

  if (result.rowCount === 0) {
    // User not in presence tracking, add them
    await joinNotePresence(pool, noteId, userEmail, cursorPosition);
    return;
  }

  // Broadcast cursor update
  await emitNoteCursorUpdate({
    noteId,
    userEmail,
    cursorPosition,
  });
}

/**
 * Get list of active collaborators for a note.
 * Returns users who have been active within the timeout period.
 */
export async function getActiveCollaborators(
  pool: Pool,
  noteId: string
): Promise<NotePresenceUser[]> {
  const result = await pool.query(
    `SELECT
       nc.user_email as email,
       nc.last_seen_at,
       nc.cursor_position
     FROM note_collaborator nc
     WHERE nc.note_id = $1
       AND nc.last_seen_at > NOW() - INTERVAL '${PRESENCE_TIMEOUT_MINUTES} minutes'
     ORDER BY nc.last_seen_at DESC`,
    [noteId]
  );

  return result.rows.map((row) => ({
    email: row.email,
    lastSeenAt: row.last_seen_at.toISOString(),
    cursorPosition: row.cursor_position,
  }));
}

/**
 * Get presence list and send to requesting user.
 * Used when a user first opens a note to see who else is viewing.
 */
export async function getNotePresence(
  pool: Pool,
  noteId: string,
  userEmail: string
): Promise<NotePresenceUser[]> {
  // Verify user has access to the note
  const accessCheck = await pool.query(
    'SELECT user_can_access_note($1, $2) as has_access',
    [noteId, userEmail]
  );

  if (!accessCheck.rows[0]?.has_access) {
    throw new Error('FORBIDDEN');
  }

  const collaborators = await getActiveCollaborators(pool, noteId);

  // Send presence list to the requesting user
  await emitNotePresenceList(
    { noteId, users: collaborators },
    userEmail
  );

  return collaborators;
}

/**
 * Cleanup stale presence records.
 * Called periodically to remove users who haven't updated presence.
 */
export async function cleanupStalePresence(pool: Pool): Promise<number> {
  const result = await pool.query(
    `DELETE FROM note_collaborator
     WHERE last_seen_at < NOW() - INTERVAL '${PRESENCE_TIMEOUT_MINUTES} minutes'
     RETURNING note_id, user_email`
  );

  // Broadcast leave events for each removed user
  for (const row of result.rows) {
    await emitNotePresenceLeft({
      noteId: row.note_id,
      user: {
        email: row.user_email,
        lastSeenAt: new Date().toISOString(),
      },
    });
  }

  return result.rowCount || 0;
}
