/**
 * tmux process management module.
 * Issue #1846 — tmux process management.
 *
 * Manages local tmux processes via execFile (no shell injection risk).
 * Operations: create, list, kill, resize sessions; manage windows and panes.
 *
 * All tmux commands use execFile directly — arguments are passed as arrays,
 * never interpolated into a shell string.
 */

import { execFile } from 'node:child_process';

/** Default timeout for tmux commands (ms). */
const TMUX_COMMAND_TIMEOUT = 10_000;

/**
 * Regex for valid tmux session names.
 * Allows alphanumeric, underscore, hyphen, dot. Must not start with hyphen.
 */
const VALID_SESSION_NAME = /^[a-zA-Z0-9_][a-zA-Z0-9_.\-]*$/;

/** Parsed tmux session info from list-sessions output. */
export interface TmuxSessionInfo {
  name: string;
  width: number;
  height: number;
}

/** Parsed tmux window info from list-windows output. */
export interface TmuxWindowInfo {
  index: number;
  name: string;
  active: boolean;
}

/** Parsed tmux pane info from list-panes output. */
export interface TmuxPaneInfo {
  index: number;
  active: boolean;
  pid: number;
  currentCommand: string;
}

/**
 * Validate a tmux session name to prevent injection.
 *
 * Even though we use execFile (no shell), we still validate names
 * to catch issues early and prevent tmux from misinterpreting arguments.
 */
function validateSessionName(name: string): void {
  if (!VALID_SESSION_NAME.test(name)) {
    throw new Error(
      `Invalid session name: "${name}". Names must match ${VALID_SESSION_NAME.source}`,
    );
  }
  if (name.length > 256) {
    throw new Error('Session name too long (max 256 characters)');
  }
}

/**
 * Execute a tmux command via execFile (safe against shell injection).
 *
 * @param args - Arguments to pass to the tmux binary
 * @param env - Optional additional environment variables
 * @returns stdout from the tmux command
 * @throws Error on non-zero exit or timeout
 */
function runTmux(
  args: string[],
  env?: Record<string, string>,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const options: { timeout: number; env?: NodeJS.ProcessEnv } = {
      timeout: TMUX_COMMAND_TIMEOUT,
    };
    if (env) {
      options.env = { ...process.env, ...env };
    }
    execFile('tmux', args, options, (error, stdout, stderr) => {
      if (error) {
        const message = stderr?.trim() || error.message;
        reject(new Error(message));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Manages tmux processes on the local host.
 *
 * All commands are executed via execFile to prevent shell injection.
 * Session names are validated against a safe character set.
 */
export class TmuxManager {
  /**
   * Create a new detached tmux session.
   *
   * @param name - Session name (validated for safe characters)
   * @param cols - Terminal width
   * @param rows - Terminal height
   * @param env - Optional environment variables for the session
   */
  async createSession(
    name: string,
    cols: number,
    rows: number,
    env?: Record<string, string>,
  ): Promise<void> {
    validateSessionName(name);
    await runTmux(
      [
        'new-session',
        '-d',
        '-s', name,
        '-x', String(cols),
        '-y', String(rows),
      ],
      env,
    );
  }

  /**
   * Check if a tmux session exists.
   *
   * @param name - Session name to check
   * @returns true if the session exists, false otherwise
   */
  async hasSession(name: string): Promise<boolean> {
    try {
      await runTmux(['has-session', '-t', name]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill (terminate) a tmux session.
   *
   * @param name - Session name to kill
   * @throws if the session doesn't exist or tmux fails
   */
  async killSession(name: string): Promise<void> {
    await runTmux(['kill-session', '-t', name]);
  }

  /**
   * List all tmux sessions.
   *
   * @returns Array of session info objects (empty if no server running)
   */
  async listSessions(): Promise<TmuxSessionInfo[]> {
    try {
      const output = await runTmux([
        'list-sessions',
        '-F', '#{session_name}:#{session_width}:#{session_height}',
      ]);
      return output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, width, height] = line.split(':');
          return {
            name,
            width: parseInt(width, 10),
            height: parseInt(height, 10),
          };
        });
    } catch {
      // tmux returns error when no server is running (no sessions)
      return [];
    }
  }

  /**
   * List windows in a tmux session.
   *
   * @param session - Session name
   * @returns Array of window info objects
   */
  async listWindows(session: string): Promise<TmuxWindowInfo[]> {
    const output = await runTmux([
      'list-windows',
      '-t', session,
      '-F', '#{window_index}:#{window_name}:#{window_active}',
    ]);
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [index, name, active] = line.split(':');
        return {
          index: parseInt(index, 10),
          name,
          active: active === '1',
        };
      });
  }

  /**
   * List panes in a tmux window.
   *
   * @param session - Session name
   * @param windowIndex - Window index
   * @returns Array of pane info objects
   */
  async listPanes(session: string, windowIndex: number): Promise<TmuxPaneInfo[]> {
    const output = await runTmux([
      'list-panes',
      '-t', `${session}:${windowIndex}`,
      '-F', '#{pane_index}:#{pane_active}:#{pane_pid}:#{pane_current_command}',
    ]);
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [index, active, pid, command] = line.split(':');
        return {
          index: parseInt(index, 10),
          active: active === '1',
          pid: parseInt(pid, 10),
          currentCommand: command || '',
        };
      });
  }

  /**
   * Resize a tmux session's active window.
   *
   * @param session - Session name
   * @param cols - New terminal width
   * @param rows - New terminal height
   */
  async resizeSession(session: string, cols: number, rows: number): Promise<void> {
    await runTmux([
      'resize-window',
      '-t', session,
      '-x', String(cols),
      '-y', String(rows),
    ]);
  }

  /**
   * Capture the content of a tmux pane.
   *
   * @param session - Session name
   * @param windowIndex - Window index
   * @param paneIndex - Pane index
   * @param lines - Number of history lines to capture (0 = visible area only)
   * @returns Captured pane content
   */
  async capturePane(
    session: string,
    windowIndex: number,
    paneIndex: number,
    lines?: number,
  ): Promise<string> {
    const target = `${session}:${windowIndex}.${paneIndex}`;
    const args = ['capture-pane', '-p', '-t', target];
    if (lines && lines > 0) {
      args.push('-S', String(-lines));
    }
    return runTmux(args);
  }

  /**
   * Create a new window in a tmux session.
   *
   * @param session - Session name
   * @param windowName - Name for the new window
   */
  async createWindow(session: string, windowName?: string): Promise<void> {
    const args = ['new-window', '-t', session];
    if (windowName) {
      args.push('-n', windowName);
    }
    await runTmux(args);
  }

  /**
   * Close a window by index.
   *
   * @param session - Session name
   * @param windowIndex - Index of the window to close
   */
  async closeWindow(session: string, windowIndex: number): Promise<void> {
    await runTmux(['kill-window', '-t', `${session}:${windowIndex}`]);
  }

  /**
   * Split a pane in a window.
   *
   * @param session - Session name
   * @param windowIndex - Window index
   * @param horizontal - true for horizontal split (-h), false for vertical (-v)
   */
  async splitPane(session: string, windowIndex: number, horizontal: boolean): Promise<void> {
    const flag = horizontal ? '-h' : '-v';
    await runTmux(['split-window', flag, '-t', `${session}:${windowIndex}`]);
  }

  /**
   * Close a specific pane.
   *
   * @param session - Session name
   * @param windowIndex - Window index
   * @param paneIndex - Pane index
   */
  async closePane(session: string, windowIndex: number, paneIndex: number): Promise<void> {
    await runTmux(['kill-pane', '-t', `${session}:${windowIndex}.${paneIndex}`]);
  }

  /**
   * Send keys to a tmux pane (for interactive programs).
   *
   * @param session - Session name
   * @param windowIndex - Window index
   * @param paneIndex - Pane index
   * @param keys - Keys to send
   */
  async sendKeys(
    session: string,
    windowIndex: number,
    paneIndex: number,
    keys: string,
  ): Promise<void> {
    await runTmux([
      'send-keys',
      '-t', `${session}:${windowIndex}.${paneIndex}`,
      keys,
    ]);
  }
}
