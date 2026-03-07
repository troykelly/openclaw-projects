/**
 * Session lifecycle handlers for gRPC RPCs.
 * Issue #1847 — Session lifecycle RPCs.
 *
 * Implements: CreateSession, TerminateSession, ListSessions, GetSession, ResizeSession.
 *
 * Each handler is a pure async function that takes the request message,
 * pool, tmux manager, and SSH manager. The gRPC server layer calls these
 * and converts results to gRPC responses.
 */

import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ClientChannel } from 'ssh2';
import type { TmuxManager } from './tmux/manager.ts';
import type { SSHConnectionManager } from './ssh/client.ts';
import {
  toTimestamp,
  type CreateSessionRequest,
  type TerminateSessionRequest,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type GetSessionRequest,
  type ResizeSessionRequest,
  type SessionInfo,
  type WindowInfo,
  type PaneInfo,
} from './types.ts';

/** Database row shape for terminal_connection (minimal fields needed). */
interface ConnectionRow {
  id: string;
  is_local: boolean;
  env: Record<string, string> | null;
}

/** Database row shape for terminal_session. */
interface SessionRow {
  id: string;
  namespace: string;
  connection_id: string;
  tmux_session_name: string;
  worker_id: string;
  status: string;
  cols: number;
  rows: number;
  started_at: string | null;
  last_activity_at: string | null;
  terminated_at: string | null;
  exit_code: number | null;
  error_message: string | null;
  tags: string[];
  notes: string | null;
}

/** Database row shape for terminal_session_window. */
interface WindowRow {
  id: string;
  session_id: string;
  namespace: string;
  window_index: number;
  window_name: string | null;
  is_active: boolean;
}

/** Database row shape for terminal_session_pane. */
interface PaneRow {
  id: string;
  window_id: string;
  namespace: string;
  pane_index: number;
  is_active: boolean;
  pid: number | null;
  current_command: string | null;
}

/**
 * Convert a SessionRow + windows/panes into a SessionInfo gRPC message.
 */
function toSessionInfo(
  session: SessionRow,
  windows: WindowInfo[] = [],
): SessionInfo {
  return {
    id: session.id,
    namespace: session.namespace,
    connection_id: session.connection_id,
    tmux_session_name: session.tmux_session_name,
    worker_id: session.worker_id,
    status: session.status,
    cols: session.cols,
    rows: session.rows,
    windows,
    started_at: toTimestamp(session.started_at),
    last_activity_at: toTimestamp(session.last_activity_at),
    terminated_at: toTimestamp(session.terminated_at),
    exit_code: session.exit_code ?? 0,
    error_message: session.error_message ?? '',
    tags: session.tags || [],
    notes: session.notes ?? '',
  };
}

/**
 * Execute a command on an SSH connection and return stdout.
 * Rejects on non-zero exit or stream error.
 *
 * NOTE: This uses ssh2's Client.exec() (SSH protocol remote execution),
 * NOT child_process.exec(). No local shell is spawned.
 */
function execSSHCommand(
  client: { exec: (cmd: string, cb: (err: Error | undefined, channel: ClientChannel) => void) => void },
  command: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, channel) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      channel.on('data', (data: Buffer) => { stdout += data.toString(); });
      channel.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      channel.on('close', (code: number) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`SSH exec exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
      });
    });
  });
}

/**
 * Create a new terminal session.
 *
 * Flow:
 * 1. Fetch connection from DB
 * 2. Resolve SSH connection (or use local)
 * 3. Create tmux session
 * 4. Insert terminal_session, window, and pane rows
 * 5. Return SessionInfo
 */
export async function handleCreateSession(
  req: CreateSessionRequest,
  pool: pg.Pool,
  tmuxManager: TmuxManager,
  sshManager: SSHConnectionManager,
  workerId: string,
): Promise<SessionInfo> {
  // 1. Fetch connection
  const connResult = await pool.query<ConnectionRow>(
    `SELECT id, is_local, env FROM terminal_connection WHERE id = $1 AND deleted_at IS NULL`,
    [req.connection_id],
  );

  if (connResult.rows.length === 0) {
    throw new Error(`Connection not found: ${req.connection_id}`);
  }

  const conn = connResult.rows[0];

  // 2. Resolve SSH connection (for non-local)
  if (!conn.is_local) {
    const sshResult = await sshManager.getConnection(req.connection_id);
    if (!sshResult || !sshResult.client) {
      throw new Error(`Failed to establish SSH connection for ${req.connection_id}`);
    }
  }

  // 3. Create tmux session — local via TmuxManager, SSH via remote exec (#2101, #2252)
  const sessionName = req.tmux_session_name || `oc-${randomUUID().slice(0, 8)}`;
  const cols = req.cols || 120;
  const rows = req.rows || 40;
  let remoteTmuxAvailable = true;

  if (conn.is_local) {
    const env = conn.env ?? undefined;
    try {
      await tmuxManager.createSession(sessionName, cols, rows, env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create tmux session "${sessionName}": ${message}`);
    }
  } else {
    // Create tmux session on the remote host via SSH exec (#2252).
    const sshResult = await sshManager.getConnection(req.connection_id);
    if (!sshResult?.client) {
      throw new Error(`SSH connection lost for ${req.connection_id}`);
    }

    // Check if tmux is available on the remote host
    let hasTmux = false;
    try {
      await execSSHCommand(sshResult.client, 'which tmux');
      hasTmux = true;
    } catch {
      // tmux not found — attempt unattended install
      console.log(`tmux not found on ${req.connection_id}, attempting auto-install...`);
      try {
        await execSSHCommand(
          sshResult.client,
          'sudo apt-get install -y tmux 2>/dev/null || sudo yum install -y tmux 2>/dev/null || sudo apk add tmux 2>/dev/null',
        );
        // Verify install succeeded
        await execSSHCommand(sshResult.client, 'which tmux');
        hasTmux = true;
        console.log(`tmux auto-installed on ${req.connection_id}`);
      } catch {
        console.log(`tmux auto-install failed on ${req.connection_id}, session will be SSH-only`);
      }
    }

    if (hasTmux) {
      try {
        await execSSHCommand(
          sshResult.client,
          `tmux new-session -d -s ${sessionName} -x ${cols} -y ${rows}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to create remote tmux session "${sessionName}": ${message}`);
      }
    } else {
      remoteTmuxAvailable = false;
    }
  }

  // 4. Insert DB records. If any insert fails, clean up the tmux session
  // to avoid orphans.
  const sessionId = randomUUID();
  const windowId = randomUUID();
  const paneId = randomUUID();
  const now = new Date().toISOString();

  try {
    await pool.query(
      `INSERT INTO terminal_session
       (id, namespace, connection_id, tmux_session_name, worker_id, status,
        cols, rows, capture_on_command, embed_commands, embed_scrollback,
        capture_interval_s, tags, notes, started_at, last_activity_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $14, $14)`,
      [
        sessionId,
        req.namespace,
        req.connection_id,
        sessionName,
        workerId,
        cols,
        rows,
        req.capture_on_command ?? true,
        req.embed_commands ?? true,
        req.embed_scrollback ?? false,
        req.capture_interval_s ?? 30,
        remoteTmuxAvailable
          ? (req.tags || [])
          : [...(req.tags || []), 'no-tmux'],
        req.notes || null,
        now,
      ],
    );

    // 5. Insert initial window
    await pool.query(
      `INSERT INTO terminal_session_window
       (id, session_id, namespace, window_index, window_name, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, 0, 'default', true, $4, $4)`,
      [windowId, sessionId, req.namespace, now],
    );

    // 6. Insert initial pane
    await pool.query(
      `INSERT INTO terminal_session_pane
       (id, window_id, namespace, pane_index, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, 0, true, $4, $4)`,
      [paneId, windowId, req.namespace, now],
    );
  } catch (dbErr) {
    // Clean up the tmux session to avoid orphan (#2252: handle both local and SSH)
    // Skip cleanup for no-tmux sessions (no tmux session to kill)
    if (remoteTmuxAvailable) {
      if (conn.is_local) {
        try { await tmuxManager.killSession(sessionName); } catch { /* best-effort */ }
      } else {
        try {
          const sshResult = await sshManager.getConnection(req.connection_id);
          if (sshResult?.client) {
            await execSSHCommand(sshResult.client, `tmux kill-session -t ${sessionName}`);
          }
        } catch { /* best-effort */ }
      }
    }
    throw dbErr;
  }

  return {
    id: sessionId,
    namespace: req.namespace,
    connection_id: req.connection_id,
    tmux_session_name: sessionName,
    worker_id: workerId,
    status: 'active',
    cols,
    rows,
    windows: [
      {
        id: windowId,
        session_id: sessionId,
        window_index: 0,
        window_name: 'default',
        is_active: true,
        panes: [
          {
            id: paneId,
            window_id: windowId,
            pane_index: 0,
            is_active: true,
            pid: 0,
            current_command: '',
          },
        ],
      },
    ],
    started_at: toTimestamp(now),
    last_activity_at: toTimestamp(now),
    terminated_at: null,
    exit_code: 0,
    error_message: '',
    tags: remoteTmuxAvailable
      ? (req.tags || [])
      : [...(req.tags || []), 'no-tmux'],
    notes: req.notes || '',
  };
}

/**
 * Terminate a session.
 *
 * Flow:
 * 1. Fetch session from DB
 * 2. Kill tmux session
 * 3. Update DB status to terminated
 */
export async function handleTerminateSession(
  req: TerminateSessionRequest,
  pool: pg.Pool,
  tmuxManager: TmuxManager,
  sshManager: SSHConnectionManager,
): Promise<void> {
  // Fetch session
  const result = await pool.query<SessionRow>(
    `SELECT id, connection_id, tmux_session_name, status, tags
     FROM terminal_session WHERE id = $1`,
    [req.session_id],
  );

  if (result.rows.length === 0) {
    throw new Error(`Session not found: ${req.session_id}`);
  }

  const session = result.rows[0];
  const noTmux = (session.tags || []).includes('no-tmux');

  // Look up connection to determine local vs SSH (#2252)
  const connResult = await pool.query<{ is_local: boolean }>(
    `SELECT is_local FROM terminal_connection WHERE id = $1`,
    [session.connection_id],
  );
  const isLocal = connResult.rows.length === 0 || connResult.rows[0].is_local;

  // Kill tmux session — local via TmuxManager, SSH via remote exec (#2252)
  // Skip tmux kill for no-tmux sessions (plain SSH shell closes on its own)
  if (!noTmux) {
    if (isLocal) {
      try {
        await tmuxManager.killSession(session.tmux_session_name);
      } catch {
        // Session may already be gone — that's OK for termination
      }
    } else {
      try {
        const sshResult = await sshManager.getConnection(session.connection_id);
        if (sshResult?.client) {
          await execSSHCommand(sshResult.client, `tmux kill-session -t ${session.tmux_session_name}`);
        }
      } catch {
        // Session may already be gone on remote — that's OK
      }
    }
  }

  // Update DB
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE terminal_session
     SET status = 'terminated', terminated_at = $1, updated_at = $1
     WHERE id = $2`,
    [now, req.session_id],
  );
}

/**
 * List sessions, optionally filtered by namespace, connection, and status.
 */
export async function handleListSessions(
  req: ListSessionsRequest,
  pool: pg.Pool,
): Promise<ListSessionsResponse> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (req.namespace) {
    conditions.push(`namespace = $${paramIdx++}`);
    params.push(req.namespace);
  }

  if (req.connection_id) {
    conditions.push(`connection_id = $${paramIdx++}`);
    params.push(req.connection_id);
  }

  if (req.status_filter) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(req.status_filter);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT id, namespace, connection_id, tmux_session_name, worker_id,
                      status, cols, rows, started_at, last_activity_at,
                      terminated_at, exit_code, error_message, tags, notes
               FROM terminal_session ${where}
               ORDER BY created_at DESC
               LIMIT 100`;

  const result = await pool.query<SessionRow>(sql, params);

  const sessions: SessionInfo[] = result.rows.map((row) =>
    toSessionInfo(row, []),
  );

  return { sessions };
}

/**
 * Get a single session with its windows and panes.
 */
export async function handleGetSession(
  req: GetSessionRequest,
  pool: pg.Pool,
): Promise<SessionInfo> {
  // Fetch session
  const sessionResult = await pool.query<SessionRow>(
    `SELECT id, namespace, connection_id, tmux_session_name, worker_id,
            status, cols, rows, started_at, last_activity_at,
            terminated_at, exit_code, error_message, tags, notes
     FROM terminal_session WHERE id = $1`,
    [req.session_id],
  );

  if (sessionResult.rows.length === 0) {
    throw new Error(`Session not found: ${req.session_id}`);
  }

  const session = sessionResult.rows[0];

  // Fetch windows
  const windowResult = await pool.query<WindowRow>(
    `SELECT id, session_id, namespace, window_index, window_name, is_active
     FROM terminal_session_window
     WHERE session_id = $1
     ORDER BY window_index`,
    [req.session_id],
  );

  // Fetch panes for all windows
  const windowIds = windowResult.rows.map((w) => w.id);
  let paneRows: PaneRow[] = [];

  if (windowIds.length > 0) {
    const placeholders = windowIds.map((_, i) => `$${i + 1}`).join(', ');
    const paneResult = await pool.query<PaneRow>(
      `SELECT id, window_id, namespace, pane_index, is_active, pid, current_command
       FROM terminal_session_pane
       WHERE window_id IN (${placeholders})
       ORDER BY pane_index`,
      windowIds,
    );
    paneRows = paneResult.rows;
  }

  // Build windows with panes
  const windows: WindowInfo[] = windowResult.rows.map((w) => ({
    id: w.id,
    session_id: w.session_id,
    window_index: w.window_index,
    window_name: w.window_name ?? '',
    is_active: w.is_active,
    panes: paneRows
      .filter((p) => p.window_id === w.id)
      .map((p) => ({
        id: p.id,
        window_id: p.window_id,
        pane_index: p.pane_index,
        is_active: p.is_active,
        pid: p.pid ?? 0,
        current_command: p.current_command ?? '',
      })),
  }));

  return toSessionInfo(session, windows);
}

/**
 * Resize a session's tmux window and update DB.
 */
export async function handleResizeSession(
  req: ResizeSessionRequest,
  pool: pg.Pool,
  tmuxManager: TmuxManager,
): Promise<void> {
  // Fetch session
  const result = await pool.query<SessionRow>(
    `SELECT id, tmux_session_name, status
     FROM terminal_session WHERE id = $1`,
    [req.session_id],
  );

  if (result.rows.length === 0) {
    throw new Error(`Session not found: ${req.session_id}`);
  }

  const session = result.rows[0];

  // Resize tmux session
  await tmuxManager.resizeSession(session.tmux_session_name, req.cols, req.rows);

  // Update DB
  await pool.query(
    `UPDATE terminal_session
     SET cols = $1, rows = $2, updated_at = NOW()
     WHERE id = $3`,
    [req.cols, req.rows, req.session_id],
  );
}
