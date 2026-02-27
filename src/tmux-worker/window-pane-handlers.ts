/**
 * Window and pane management handlers for gRPC RPCs.
 * Issue #1851 — Window and pane RPCs.
 *
 * Implements: CreateWindow, CloseWindow, SplitPane, ClosePane.
 *
 * Each handler is a pure async function that takes the request message,
 * pool, and tmux manager. The gRPC server layer calls these and converts
 * results to gRPC responses.
 */

import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { TmuxManager } from './tmux/manager.ts';
import type {
  CreateWindowRequest,
  CloseWindowRequest,
  SplitPaneRequest,
  ClosePaneRequest,
  WindowInfo,
  PaneInfo,
} from './types.ts';

/** Database row shape for terminal_session (minimal fields for window/pane ops). */
interface SessionRow {
  id: string;
  namespace: string;
  tmux_session_name: string;
  status: string;
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

/**
 * Create a new window in a tmux session.
 *
 * Flow:
 * 1. Fetch session from DB, verify it's active
 * 2. Run `tmux new-window`
 * 3. Query tmux for the new window list to get the actual index
 * 4. Insert terminal_session_window + terminal_session_pane rows
 * 5. Return WindowInfo
 */
export async function handleCreateWindow(
  req: CreateWindowRequest,
  pool: pg.Pool,
  tmuxManager: TmuxManager,
): Promise<WindowInfo> {
  const session = await getActiveSession(pool, req.session_id);

  // Create window in tmux
  await tmuxManager.createWindow(session.tmux_session_name, req.window_name || undefined);

  // Get window list to find the newly created window
  const tmuxWindows = await tmuxManager.listWindows(session.tmux_session_name);
  const lastWindow = tmuxWindows[tmuxWindows.length - 1];

  if (!lastWindow) {
    throw new Error('Failed to retrieve window info after creation');
  }

  const windowId = randomUUID();
  const paneId = randomUUID();
  const now = new Date().toISOString();

  // Deactivate other windows in DB
  await pool.query(
    `UPDATE terminal_session_window SET is_active = false, updated_at = $1
     WHERE session_id = $2`,
    [now, req.session_id],
  );

  // Insert new window row
  await pool.query(
    `INSERT INTO terminal_session_window
       (id, session_id, namespace, window_index, window_name, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, true, $6, $6)`,
    [windowId, req.session_id, session.namespace, lastWindow.index, req.window_name || lastWindow.name, now],
  );

  // Get pane info for the new window
  const tmuxPanes = await tmuxManager.listPanes(session.tmux_session_name, lastWindow.index);
  const firstPane = tmuxPanes[0];

  // Insert default pane
  await pool.query(
    `INSERT INTO terminal_session_pane
       (id, window_id, namespace, pane_index, is_active, pid, current_command, created_at, updated_at)
     VALUES ($1, $2, $3, $4, true, $5, $6, $7, $7)`,
    [
      paneId,
      windowId,
      session.namespace,
      firstPane?.index ?? 0,
      firstPane?.pid ?? 0,
      firstPane?.currentCommand ?? '',
      now,
    ],
  );

  // Update session last_activity_at
  await pool.query(
    `UPDATE terminal_session SET last_activity_at = $1, updated_at = $1 WHERE id = $2`,
    [now, req.session_id],
  );

  return {
    id: windowId,
    session_id: req.session_id,
    window_index: lastWindow.index,
    window_name: req.window_name || lastWindow.name,
    is_active: true,
    panes: [
      {
        id: paneId,
        window_id: windowId,
        pane_index: firstPane?.index ?? 0,
        is_active: true,
        pid: firstPane?.pid ?? 0,
        current_command: firstPane?.currentCommand ?? '',
      },
    ],
  };
}

/**
 * Close a window in a tmux session.
 *
 * Flow:
 * 1. Fetch session from DB, verify it's active
 * 2. Run `tmux kill-window`
 * 3. Delete window and cascade-delete panes from DB
 */
export async function handleCloseWindow(
  req: CloseWindowRequest,
  pool: pg.Pool,
  tmuxManager: TmuxManager,
): Promise<void> {
  const session = await getActiveSession(pool, req.session_id);

  // Kill the tmux window
  await tmuxManager.closeWindow(session.tmux_session_name, req.window_index);

  // Find the window row
  const windowResult = await pool.query<WindowRow>(
    `SELECT id FROM terminal_session_window
     WHERE session_id = $1 AND window_index = $2`,
    [req.session_id, req.window_index],
  );

  if (windowResult.rows.length > 0) {
    const windowId = windowResult.rows[0].id;

    // Delete panes for this window
    await pool.query(
      `DELETE FROM terminal_session_pane WHERE window_id = $1`,
      [windowId],
    );

    // Delete the window
    await pool.query(
      `DELETE FROM terminal_session_window WHERE id = $1`,
      [windowId],
    );
  }

  // Update session last_activity_at
  await pool.query(
    `UPDATE terminal_session SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [req.session_id],
  );
}

/**
 * Split a pane in a tmux window.
 *
 * Flow:
 * 1. Fetch session from DB, verify it's active
 * 2. Run `tmux split-window`
 * 3. Query tmux for updated pane list
 * 4. Insert new pane row in DB
 * 5. Return PaneInfo for the new pane
 */
export async function handleSplitPane(
  req: SplitPaneRequest,
  pool: pg.Pool,
  tmuxManager: TmuxManager,
): Promise<PaneInfo> {
  const session = await getActiveSession(pool, req.session_id);

  // Find the window DB row
  const windowResult = await pool.query<WindowRow>(
    `SELECT id, namespace FROM terminal_session_window
     WHERE session_id = $1 AND window_index = $2`,
    [req.session_id, req.window_index],
  );

  if (windowResult.rows.length === 0) {
    throw new Error(`Window not found: session=${req.session_id}, index=${req.window_index}`);
  }

  const windowRow = windowResult.rows[0];

  // Split pane in tmux
  await tmuxManager.splitPane(session.tmux_session_name, req.window_index, req.horizontal);

  // Query tmux for updated pane list
  const tmuxPanes = await tmuxManager.listPanes(session.tmux_session_name, req.window_index);

  // The new pane is the last one (tmux adds panes at the end)
  const newTmuxPane = tmuxPanes[tmuxPanes.length - 1];
  if (!newTmuxPane) {
    throw new Error('Failed to retrieve pane info after split');
  }

  const paneId = randomUUID();
  const now = new Date().toISOString();

  // Deactivate other panes in this window
  await pool.query(
    `UPDATE terminal_session_pane SET is_active = false, updated_at = $1
     WHERE window_id = $2`,
    [now, windowRow.id],
  );

  // Insert new pane row
  await pool.query(
    `INSERT INTO terminal_session_pane
       (id, window_id, namespace, pane_index, is_active, pid, current_command, created_at, updated_at)
     VALUES ($1, $2, $3, $4, true, $5, $6, $7, $7)`,
    [
      paneId,
      windowRow.id,
      windowRow.namespace,
      newTmuxPane.index,
      newTmuxPane.pid,
      newTmuxPane.currentCommand,
      now,
    ],
  );

  // Update session last_activity_at
  await pool.query(
    `UPDATE terminal_session SET last_activity_at = $1, updated_at = $1 WHERE id = $2`,
    [now, req.session_id],
  );

  return {
    id: paneId,
    window_id: windowRow.id,
    pane_index: newTmuxPane.index,
    is_active: true,
    pid: newTmuxPane.pid,
    current_command: newTmuxPane.currentCommand,
  };
}

/**
 * Close a pane in a tmux window.
 *
 * Flow:
 * 1. Fetch session from DB, verify it's active
 * 2. Run `tmux kill-pane`
 * 3. Delete pane row from DB
 */
export async function handleClosePane(
  req: ClosePaneRequest,
  pool: pg.Pool,
  tmuxManager: TmuxManager,
): Promise<void> {
  const session = await getActiveSession(pool, req.session_id);

  // Kill the tmux pane
  await tmuxManager.closePane(session.tmux_session_name, req.window_index, req.pane_index);

  // Find the window row
  const windowResult = await pool.query<WindowRow>(
    `SELECT id FROM terminal_session_window
     WHERE session_id = $1 AND window_index = $2`,
    [req.session_id, req.window_index],
  );

  if (windowResult.rows.length > 0) {
    const windowId = windowResult.rows[0].id;

    // Delete the pane row
    await pool.query(
      `DELETE FROM terminal_session_pane
       WHERE window_id = $1 AND pane_index = $2`,
      [windowId, req.pane_index],
    );
  }

  // Update session last_activity_at
  await pool.query(
    `UPDATE terminal_session SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [req.session_id],
  );
}

/**
 * Fetch a session and verify it's in an active state.
 */
async function getActiveSession(pool: pg.Pool, sessionId: string): Promise<SessionRow> {
  const result = await pool.query<SessionRow>(
    `SELECT id, namespace, tmux_session_name, status
     FROM terminal_session WHERE id = $1`,
    [sessionId],
  );

  if (result.rows.length === 0) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const session = result.rows[0];

  if (session.status !== 'active' && session.status !== 'idle') {
    throw new Error(
      `Session ${sessionId} is not active (status: ${session.status})`,
    );
  }

  return session;
}
