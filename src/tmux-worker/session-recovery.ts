/**
 * Session recovery service for the tmux worker.
 *
 * On worker startup, recovers existing sessions that were assigned to this worker.
 * Local sessions check tmux directly; SSH sessions attempt reconnection.
 * On shutdown, marks sessions as disconnected and flushes entry buffers.
 *
 * Issue #1682 — Session recovery after worker restart.
 * Epic #1667 — TMux Session Management.
 */

import { execFileSync } from 'node:child_process';
import type pg from 'pg';
import type { EntryRecorder } from './entry-recorder.ts';

/** Status of a recovery attempt for a single session. */
export interface RecoveryResult {
  sessionId: string;
  connectionId: string;
  previousStatus: string;
  newStatus: string;
  isLocal: boolean;
  error?: string;
}

/** Configuration for session recovery. */
export interface SessionRecoveryConfig {
  /** Worker ID to query sessions for. */
  workerId: string;
}

/**
 * Recover sessions after worker restart.
 *
 * 1. Query sessions with status active/idle/disconnected for this worker_id
 * 2. For local sessions: check `tmux has-session`, re-attach or mark terminated
 * 3. For SSH sessions: attempt reconnect (currently marks as disconnected)
 * 4. Returns recovery results for logging/monitoring
 */
export async function recoverSessions(
  pool: pg.Pool,
  config: SessionRecoveryConfig,
): Promise<RecoveryResult[]> {
  const results: RecoveryResult[] = [];

  // Find sessions assigned to this worker that need recovery
  const sessionsResult = await pool.query(
    `SELECT s.id, s.connection_id, s.tmux_session_name, s.status,
            c.is_local, c.host
     FROM terminal_session s
     JOIN terminal_connection c ON s.connection_id = c.id
     WHERE s.worker_id = $1
       AND s.status IN ('active', 'idle', 'disconnected')`,
    [config.workerId],
  );

  const sessions = sessionsResult.rows as Array<{
    id: string;
    connection_id: string;
    tmux_session_name: string;
    status: string;
    is_local: boolean;
    host: string | null;
  }>;

  for (const session of sessions) {
    const result: RecoveryResult = {
      sessionId: session.id,
      connectionId: session.connection_id,
      previousStatus: session.status,
      newStatus: session.status,
      isLocal: session.is_local,
    };

    if (session.is_local) {
      // Check if local tmux session still exists
      const exists = checkLocalTmuxSession(session.tmux_session_name);
      if (exists) {
        result.newStatus = 'active';
        await pool.query(
          `UPDATE terminal_session SET status = 'active', updated_at = NOW() WHERE id = $1`,
          [session.id],
        );
      } else {
        result.newStatus = 'terminated';
        await pool.query(
          `UPDATE terminal_session SET status = 'terminated', terminated_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [session.id],
        );
      }
    } else {
      // SSH session: attempt reconnect
      // For now, mark as disconnected — full SSH reconnection requires
      // re-establishing the SSH connection and checking remote tmux.
      // This is a valid intermediate state that allows later recovery.
      result.newStatus = 'disconnected';
      result.error = 'SSH reconnection not yet implemented; marked disconnected';
      await pool.query(
        `UPDATE terminal_session SET status = 'disconnected', updated_at = NOW() WHERE id = $1`,
        [session.id],
      );
    }

    results.push(result);
  }

  return results;
}

/**
 * Check if a local tmux session exists using execFileSync (no shell injection risk).
 */
function checkLocalTmuxSession(sessionName: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', sessionName], {
      timeout: 5000,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Perform graceful shutdown: flush entries, mark sessions disconnected.
 */
export async function gracefulShutdown(
  pool: pg.Pool,
  workerId: string,
  entryRecorder?: EntryRecorder,
): Promise<void> {
  // Flush any buffered entries
  if (entryRecorder) {
    entryRecorder.stop();
    await entryRecorder.flush();
  }

  // Mark all active/idle sessions as disconnected (not terminated)
  await pool.query(
    `UPDATE terminal_session
     SET status = 'disconnected', updated_at = NOW()
     WHERE worker_id = $1
       AND status IN ('active', 'idle')`,
    [workerId],
  );
}
