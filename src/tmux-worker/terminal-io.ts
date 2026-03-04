/**
 * Terminal I/O handlers for gRPC RPCs.
 *
 * Implements: AttachSession (bidirectional stream), SendCommand, SendKeys, CapturePane.
 *
 * Issues #1848, #1849 — Terminal I/O streaming and command execution RPCs.
 */

import { randomUUID } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import type { IPty } from 'node-pty';
import type pg from 'pg';
import type { TmuxManager } from './tmux/manager.ts';
import type { EntryRecorder } from './entry-recorder.ts';
import type {
  SendCommandRequest,
  SendCommandResponse,
  SendKeysRequest,
  CapturePaneRequest,
  CapturePaneResponse,
  TerminalInput,
  TerminalOutput,
} from './types.ts';

/** Prefix used for command markers in SendCommand. */
export const COMMAND_MARKER_PREFIX = '__OC_CMD_MARKER_';

/** Default command timeout in seconds. */
const DEFAULT_COMMAND_TIMEOUT_S = 30;

/** Maximum allowed command timeout in seconds. */
const MAX_COMMAND_TIMEOUT_S = 300;

/** Maximum command length in characters. */
const MAX_COMMAND_LENGTH = 65_536;

/** Maximum keys length in characters. */
const MAX_KEYS_LENGTH = 8_192;

/** Maximum lines to capture from a pane. */
const MAX_CAPTURE_LINES = 50_000;

/** Polling interval for command marker detection (ms). */
const MARKER_POLL_INTERVAL_MS = 250;

/** Active session status values that allow I/O. */
const ACTIVE_STATUSES = ['active', 'idle'];

/** Resolved target for a session + pane. */
export interface SessionPaneTarget {
  sessionId: string;
  namespace: string;
  tmuxSessionName: string;
  windowIndex: number;
  paneIndex: number;
  paneId: string;
}

/**
 * Resolve a session ID and optional pane ID to a tmux target.
 *
 * If pane_id is empty, uses the active pane of the session's active window.
 * Validates that the session is in an active status.
 */
export async function resolveSessionPaneTarget(
  pool: pg.Pool,
  sessionId: string,
  paneId: string,
): Promise<SessionPaneTarget> {
  // 1. Look up session
  const sessionResult = await pool.query(
    `SELECT id, namespace, tmux_session_name, status
     FROM terminal_session WHERE id = $1`,
    [sessionId],
  );

  if (sessionResult.rows.length === 0) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const session = sessionResult.rows[0] as {
    id: string;
    namespace: string;
    tmux_session_name: string;
    status: string;
  };

  if (!ACTIVE_STATUSES.includes(session.status)) {
    throw new Error(
      `Session ${sessionId} is not active (status: ${session.status})`,
    );
  }

  // 2. Resolve pane target
  let paneQuery: string;
  let paneParams: unknown[];

  if (paneId) {
    // Specific pane by ID
    paneQuery = `
      SELECT p.id AS pane_id, w.window_index, p.pane_index
      FROM terminal_session_pane p
      JOIN terminal_session_window w ON p.window_id = w.id
      WHERE p.id = $1 AND w.session_id = $2`;
    paneParams = [paneId, sessionId];
  } else {
    // Active pane of active window
    paneQuery = `
      SELECT p.id AS pane_id, w.window_index, p.pane_index
      FROM terminal_session_pane p
      JOIN terminal_session_window w ON p.window_id = w.id
      WHERE w.session_id = $1 AND w.is_active = true AND p.is_active = true
      LIMIT 1`;
    paneParams = [sessionId];
  }

  const paneResult = await pool.query(paneQuery, paneParams);

  if (paneResult.rows.length === 0) {
    throw new Error(
      paneId
        ? `Pane not found: ${paneId} in session ${sessionId}`
        : `Pane not found: no active pane in session ${sessionId}`,
    );
  }

  const pane = paneResult.rows[0] as {
    pane_id: string;
    window_index: number;
    pane_index: number;
  };

  return {
    sessionId: session.id,
    namespace: session.namespace,
    tmuxSessionName: session.tmux_session_name,
    windowIndex: pane.window_index,
    paneIndex: pane.pane_index,
    paneId: pane.pane_id,
  };
}

/**
 * Handle SendCommand RPC.
 *
 * Uses the marker technique: sends `cmd; echo "MARKER_UUID EXIT_CODE:$?"`,
 * then polls capturePane until the marker is seen or timeout elapses.
 */
export async function handleSendCommand(
  req: SendCommandRequest,
  pool: pg.Pool,
  tmuxManager: TmuxManager,
  entryRecorder: EntryRecorder,
): Promise<SendCommandResponse> {
  if (req.command.length > MAX_COMMAND_LENGTH) {
    throw new Error(`Command too long (max ${MAX_COMMAND_LENGTH} characters)`);
  }

  const target = await resolveSessionPaneTarget(pool, req.session_id, req.pane_id);
  const timeoutS = Math.min(
    req.timeout_s > 0 ? req.timeout_s : DEFAULT_COMMAND_TIMEOUT_S,
    MAX_COMMAND_TIMEOUT_S,
  );
  const markerId = `${COMMAND_MARKER_PREFIX}${randomUUID().slice(0, 8)}`;

  // Record command entry
  entryRecorder.record({
    session_id: target.sessionId,
    pane_id: target.paneId,
    namespace: target.namespace,
    kind: 'command',
    content: req.command,
    metadata: { timeout_s: timeoutS },
  });

  // Capture baseline (pre-command state)
  const baseline = await tmuxManager.capturePane(
    target.tmuxSessionName,
    target.windowIndex,
    target.paneIndex,
    1000,
  );

  // Send command with marker
  // Using ; to chain so the marker echoes even if the command fails
  const commandWithMarker = `${req.command}; echo "${markerId} EXIT_CODE:$?"`;
  await tmuxManager.sendKeys(
    target.tmuxSessionName,
    target.windowIndex,
    target.paneIndex,
    commandWithMarker + ' Enter',
  );

  // Poll for marker
  const startTime = Date.now();
  const timeoutMs = timeoutS * 1000;
  let output = '';
  let exitCode = 0;
  let timedOut = false;

  while (Date.now() - startTime < timeoutMs) {
    await sleep(MARKER_POLL_INTERVAL_MS);

    const captured = await tmuxManager.capturePane(
      target.tmuxSessionName,
      target.windowIndex,
      target.paneIndex,
      1000,
    );

    const markerIndex = captured.indexOf(markerId);
    if (markerIndex >= 0) {
      // Extract output between baseline and marker
      output = extractOutputBetween(baseline, captured, markerId);

      // Extract exit code from marker line
      const markerLine = captured.substring(markerIndex);
      const exitCodeMatch = markerLine.match(/EXIT_CODE:(\d+)/);
      if (exitCodeMatch) {
        exitCode = parseInt(exitCodeMatch[1], 10);
      }

      break;
    }

    // Check timeout
    if (Date.now() - startTime >= timeoutMs) {
      output = extractNewOutput(baseline, captured);
      timedOut = true;
      break;
    }
  }

  // If loop completed without finding marker (no break), mark as timed out
  if (!timedOut && output === '' && Date.now() - startTime >= timeoutMs) {
    timedOut = true;
  }

  // Record output entry
  if (output) {
    entryRecorder.record({
      session_id: target.sessionId,
      pane_id: target.paneId,
      namespace: target.namespace,
      kind: 'output',
      content: output,
      metadata: { exit_code: exitCode, timed_out: timedOut },
    });
  }

  // Update last_activity_at
  await pool.query(
    `UPDATE terminal_session SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [target.sessionId],
  ).catch(() => {
    // Best-effort activity update
  });

  return { output, timed_out: timedOut, exit_code: exitCode };
}

/**
 * Handle SendKeys RPC.
 *
 * Sends raw keystrokes to a tmux pane.
 */
export async function handleSendKeys(
  req: SendKeysRequest,
  pool: pg.Pool,
  tmuxManager: TmuxManager,
): Promise<void> {
  if (req.keys.length > MAX_KEYS_LENGTH) {
    throw new Error(`Keys too long (max ${MAX_KEYS_LENGTH} characters)`);
  }

  const target = await resolveSessionPaneTarget(pool, req.session_id, req.pane_id);

  await tmuxManager.sendKeys(
    target.tmuxSessionName,
    target.windowIndex,
    target.paneIndex,
    req.keys,
  );

  // Update last_activity_at
  await pool.query(
    `UPDATE terminal_session SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [target.sessionId],
  ).catch(() => {
    // Best-effort activity update
  });
}

/**
 * Handle CapturePane RPC.
 *
 * Captures the current scrollback buffer from a tmux pane.
 */
export async function handleCapturePane(
  req: CapturePaneRequest,
  pool: pg.Pool,
  tmuxManager: TmuxManager,
  entryRecorder: EntryRecorder,
): Promise<CapturePaneResponse> {
  const target = await resolveSessionPaneTarget(pool, req.session_id, req.pane_id);

  const lines = req.lines > 0 ? Math.min(req.lines, MAX_CAPTURE_LINES) : undefined;
  const content = await tmuxManager.capturePane(
    target.tmuxSessionName,
    target.windowIndex,
    target.paneIndex,
    lines,
  );

  const linesCaptured = content.split('\n').filter(Boolean).length;

  // Record scrollback entry
  entryRecorder.record({
    session_id: target.sessionId,
    pane_id: target.paneId,
    namespace: target.namespace,
    kind: 'scrollback',
    content,
    metadata: { lines_captured: linesCaptured },
  });

  return { content, lines_captured: linesCaptured };
}

/**
 * Handle AttachSession bidirectional gRPC stream.
 *
 * First message from client must carry session_id.
 * Client sends: keystrokes (data) and resize events.
 * Server sends: terminal output (data) and status events.
 *
 * Uses node-pty to spawn `tmux attach-session`, providing a real PTY so
 * tmux streams raw terminal output (with escape sequences) — exactly what
 * xterm.js expects. Replaces the previous capture-pane polling approach
 * which produced plain text diffs that garbled the display (#2094).
 */
export function handleAttachSession(
  call: grpc.ServerDuplexStream<TerminalInput, TerminalOutput>,
  pool: pg.Pool,
  _tmuxManager: TmuxManager,
  entryRecorder: EntryRecorder,
): void {
  let target: SessionPaneTarget | null = null;
  let ptyProcess: IPty | null = null;
  let initialized = false;
  let initializing = false;
  let ended = false;
  const pendingMessages: TerminalInput[] = [];
  const MAX_PENDING = 100;
  const MAX_COLS = 1000;
  const MAX_ROWS = 500;
  let dataDisposable: { dispose: () => void } | null = null;
  let exitDisposable: { dispose: () => void } | null = null;

  const cleanup = () => {
    if (ended) return;
    ended = true;
    if (dataDisposable) { dataDisposable.dispose(); dataDisposable = null; }
    if (exitDisposable) { exitDisposable.dispose(); exitDisposable = null; }
    if (ptyProcess) {
      try { ptyProcess.kill(); } catch { /* already exited */ }
      ptyProcess = null;
    }
  };

  /** Process an input message once the PTY is ready. */
  function handleInput(input: TerminalInput): void {
    if (ended || !ptyProcess) return;

    // Handle keystrokes — write directly to the PTY
    if (input.data && input.data.length > 0) {
      const keyData = typeof input.data === 'string'
        ? input.data
        : Buffer.from(input.data).toString();
      try {
        ptyProcess.write(keyData);
      } catch (err) {
        if (!ended && target) {
          call.write({
            event: {
              type: 'error',
              message: `Failed to send keys: ${err instanceof Error ? err.message : String(err)}`,
              session_id: target.sessionId,
              host_key: null,
            },
          });
        }
      }
    }

    // Handle resize — resize the PTY directly (ioctl TIOCSWINSZ)
    if (input.resize) {
      const { cols, rows } = input.resize;
      if (cols > 0 && rows > 0 && cols <= MAX_COLS && rows <= MAX_ROWS) {
        try {
          ptyProcess.resize(cols, rows);
        } catch { /* best-effort resize */ }

        // Update DB cols/rows (best-effort)
        if (target) {
          pool.query(
            `UPDATE terminal_session SET cols = $1, rows = $2, updated_at = NOW() WHERE id = $3`,
            [cols, rows, target.sessionId],
          ).catch(() => { /* best-effort */ });
        }
      }
    }
  }

  call.on('data', (input: TerminalInput) => {
    if (ended) return;

    // First message must carry session_id to identify the session
    if (!initialized) {
      if (initializing) {
        // Queue messages during initialization instead of dropping them
        if (pendingMessages.length < MAX_PENDING) {
          pendingMessages.push(input);
        }
        return;
      }

      if (!input.session_id) {
        call.emit('error', {
          code: grpc.status.INVALID_ARGUMENT,
          message: 'First message must include session_id',
        });
        return;
      }

      initializing = true;

      // Resolve session target, then spawn PTY
      resolveSessionPaneTarget(pool, input.session_id, '')
        .then(async (resolved) => {
          if (ended) return;
          target = resolved;

          // Read stored dimensions from DB for initial PTY size
          let cols = 120;
          let rows = 40;
          try {
            const dimResult = await pool.query(
              `SELECT cols, rows FROM terminal_session WHERE id = $1`,
              [target.sessionId],
            );
            if (dimResult.rows.length > 0) {
              const dim = dimResult.rows[0] as { cols: number; rows: number };
              if (dim.cols > 0) cols = dim.cols;
              if (dim.rows > 0) rows = dim.rows;
            }
          } catch { /* use defaults */ }

          // Apply any queued resize before spawning the PTY
          for (const msg of pendingMessages) {
            if (msg.resize && msg.resize.cols > 0 && msg.resize.rows > 0
                && msg.resize.cols <= MAX_COLS && msg.resize.rows <= MAX_ROWS) {
              cols = msg.resize.cols;
              rows = msg.resize.rows;
            }
          }

          if (ended) return;

          // Validate tmux session name to prevent target syntax abuse (defense-in-depth)
          if (!/^[a-zA-Z0-9_-]+$/.test(target.tmuxSessionName)) {
            call.emit('error', {
              code: grpc.status.INVALID_ARGUMENT,
              message: `Invalid tmux session name: ${target.tmuxSessionName}`,
            });
            return;
          }

          // Spawn tmux attach via node-pty for real PTY streaming
          // Dynamic import to avoid loading native module at module-level
          // (prevents failures in tests/CI that import terminal-io transitively)
          const { spawn: ptySpawn } = await import('node-pty');
          const pty = ptySpawn(
            'tmux',
            ['attach-session', '-t', target.tmuxSessionName],
            {
              cols,
              rows,
              name: 'xterm-256color',
              cwd: '/tmp',
            },
          );

          ptyProcess = pty;
          initialized = true;

          // Stream PTY output to gRPC client
          dataDisposable = pty.onData((data: string) => {
            if (ended) return;

            const ok = call.write({ data: Buffer.from(data) });
            if (!ok) {
              // Backpressure: resume on drain
              call.once('drain', () => { /* writing resumes automatically */ });
            }

            // Record output for session history
            if (target) {
              entryRecorder.record({
                session_id: target.sessionId,
                pane_id: target.paneId,
                namespace: target.namespace,
                kind: 'output',
                content: data,
                metadata: { source: 'pty_stream' },
              });
            }
          });

          // Handle PTY exit (tmux session terminated or detached)
          exitDisposable = pty.onExit(({ exitCode }) => {
            if (ended) return;
            if (target) {
              call.write({
                event: {
                  type: 'status_change',
                  message: exitCode === 0 ? 'terminated' : 'disconnected',
                  session_id: target.sessionId,
                  host_key: null,
                },
              });
            }
            cleanup();
            call.end();
          });

          // Send attached event
          call.write({
            event: {
              type: 'status_change',
              message: 'attached',
              session_id: target.sessionId,
              host_key: null,
            },
          });

          // Replay queued messages (keystrokes, remaining resizes)
          for (const msg of pendingMessages) {
            handleInput(msg);
          }
          pendingMessages.length = 0;
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          call.emit('error', {
            code: grpc.status.NOT_FOUND,
            message,
          });
        });
      return;
    }

    // PTY is ready — handle input directly
    handleInput(input);
  });

  call.on('end', () => {
    cleanup();
    // Don't call call.end() here — the stream already ended from the client side.
    // The PTY onExit handler calls call.end() when the PTY exits first.
  });

  call.on('error', () => {
    cleanup();
  });

  call.on('cancelled', () => {
    cleanup();
  });
}

// ── Utility functions ────────────────────────────────────────

/** Extract new output lines that appeared since the baseline capture. */
function extractNewOutput(baseline: string, current: string): string {
  const baselineLines = baseline.trimEnd().split('\n');
  const currentLines = current.trimEnd().split('\n');

  // Find where the current output diverges from baseline
  let commonPrefix = 0;
  for (
    let i = 0;
    i < Math.min(baselineLines.length, currentLines.length);
    i++
  ) {
    if (baselineLines[i] === currentLines[i]) {
      commonPrefix = i + 1;
    } else {
      break;
    }
  }

  return currentLines.slice(commonPrefix).join('\n');
}

/**
 * Extract output between baseline and marker.
 * Removes the command echo and marker line from the output.
 */
function extractOutputBetween(
  baseline: string,
  current: string,
  markerId: string,
): string {
  const newOutput = extractNewOutput(baseline, current);
  const lines = newOutput.split('\n');

  // Remove lines containing the marker
  const filtered = lines.filter((line) => !line.includes(markerId));

  // Remove the first line if it looks like the command echo
  // (starts with $ or contains the command we sent)
  if (filtered.length > 0 && (filtered[0].startsWith('$') || filtered[0].startsWith('#'))) {
    filtered.shift();
  }

  return filtered.join('\n').trim();
}

/** Promise-based sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
