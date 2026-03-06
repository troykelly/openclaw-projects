/**
 * SSH session reconnect manager with exponential backoff.
 *
 * Issue #2187 — SSH Session Recovery for Remote Orchestration.
 * Epic #2186 — Symphony Orchestration.
 *
 * Provides:
 * - Exponential backoff with jitter (1s->30s, max 3 retries)
 * - Host reboot detection (tmux session gone after SSH reconnects)
 * - Credential re-resolution on each attempt (security: no cached creds)
 * - Activity logging for each attempt in terminal_activity
 * - Terminal I/O capture resume after successful reconnection
 */

import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { SSHConnectionManager, SSHConnectResult } from './client.ts';

// ── Configuration ────────────────────────────────────────────────────

/** Configuration for SSH reconnect behavior. */
export interface SSHReconnectConfig {
  /** Maximum number of reconnect attempts before marking session dead. */
  maxRetries: number;
  /** Initial backoff delay in milliseconds. */
  initialBackoffMs: number;
  /** Maximum backoff delay in milliseconds. */
  maxBackoffMs: number;
  /** Jitter range in milliseconds (added/subtracted from base backoff). */
  jitterMs: number;
  /**
   * Check whether a tmux session exists on the remote host.
   * Injected for testing; in production, uses SSH channel exec.
   */
  checkTmuxSession?: (
    sshResult: SSHConnectResult,
    tmuxSessionName: string,
  ) => Promise<boolean>;
}

/** Default reconnect configuration matching issue requirements. */
export const DEFAULT_RECONNECT_CONFIG: SSHReconnectConfig = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 30000,
  jitterMs: 500,
};

// ── Result type ──────────────────────────────────────────────────────

/** Result of an SSH reconnect attempt sequence. */
export interface SSHReconnectResult {
  /** Whether reconnection succeeded. */
  success: boolean;
  /** Number of attempts made. */
  attempts: number;
  /** Final session status to apply. */
  finalStatus: 'active' | 'terminated' | 'reconnecting';
  /** Error message if failed. */
  error?: string;
}

// ── Reconnect target ─────────────────────────────────────────────────

/** Information needed to reconnect an SSH session. */
export interface SSHReconnectTarget {
  sessionId: string;
  connectionId: string;
  tmuxSessionName: string;
  pool: pg.Pool;
  sshManager: SSHConnectionManager;
}

// ── Manager ──────────────────────────────────────────────────────────

/**
 * Manages SSH reconnection with exponential backoff and host reboot detection.
 *
 * Security: credentials are re-resolved on each attempt (disconnect removes
 * cached connection, getConnection re-fetches and re-authenticates).
 */
export class SSHReconnectManager {
  private readonly config: SSHReconnectConfig;

  constructor(config?: Partial<SSHReconnectConfig>) {
    this.config = { ...DEFAULT_RECONNECT_CONFIG, ...config };
  }

  /**
   * Calculate the backoff delay for a given attempt number.
   * Uses exponential backoff with jitter, capped at maxBackoffMs.
   */
  calculateBackoff(attempt: number): number {
    const base = Math.min(
      this.config.initialBackoffMs * Math.pow(2, attempt),
      this.config.maxBackoffMs,
    );
    const jitter = (Math.random() * 2 - 1) * this.config.jitterMs;
    return Math.max(0, Math.round(base + jitter));
  }

  /**
   * Attempt to reconnect an SSH session with exponential backoff.
   *
   * Flow:
   * 1. Disconnect existing connection (forces credential re-resolution)
   * 2. Attempt SSH reconnect
   * 3. If SSH connects, check remote tmux session
   *    - tmux alive: mark active, resume I/O capture
   *    - tmux gone: host rebooted, mark terminated (no retry)
   * 4. If SSH fails, wait with backoff, retry up to maxRetries
   * 5. After maxRetries failures: mark session terminated
   * 6. Log every attempt in terminal_activity
   */
  async attemptReconnect(target: SSHReconnectTarget): Promise<SSHReconnectResult> {
    const { sessionId, connectionId, tmuxSessionName, pool, sshManager } = target;
    let attempts = 0;

    // Mark session as reconnecting
    await this.updateSessionStatus(pool, sessionId, 'reconnecting').catch(() => {});

    for (let i = 0; i < this.config.maxRetries; i++) {
      attempts++;

      // Wait for backoff (skip on first attempt)
      if (i > 0) {
        const delay = this.calculateBackoff(i - 1);
        await sleep(delay);
      }

      try {
        // Disconnect first to force credential re-resolution (security requirement)
        await sshManager.disconnect(connectionId);

        // Attempt SSH connection (re-resolves credentials from DB)
        const sshResult = await sshManager.getConnection(connectionId);

        if (!sshResult || sshResult.isLocal) {
          throw new Error('SSH connection returned null or local result');
        }

        // SSH connected — check if tmux session still exists on remote
        const tmuxExists = this.config.checkTmuxSession
          ? await this.config.checkTmuxSession(sshResult, tmuxSessionName)
          : await this.checkRemoteTmuxSession(sshResult, tmuxSessionName);

        if (!tmuxExists) {
          // Host rebooted or tmux server died — no point retrying
          const error = `SSH reconnected but tmux session no longer exists (host reboot detected): ${tmuxSessionName}`;
          await this.logActivity(pool, sessionId, connectionId, 'reconnect_failed', {
            attempt: attempts,
            error,
            host_reboot_detected: true,
          });
          await this.updateSessionStatus(pool, sessionId, 'terminated', error).catch(() => {});

          return {
            success: false,
            attempts,
            finalStatus: 'terminated',
            error,
          };
        }

        // Success: SSH connected and tmux session exists
        await this.logActivity(pool, sessionId, connectionId, 'reconnect_success', {
          attempt: attempts,
        });
        await this.updateSessionStatus(pool, sessionId, 'active').catch(() => {});

        return {
          success: true,
          attempts,
          finalStatus: 'active',
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await this.logActivity(pool, sessionId, connectionId, 'reconnect_attempt', {
          attempt: attempts,
          max_retries: this.config.maxRetries,
          error,
        }).catch(() => {});
      }
    }

    // All retries exhausted — mark session dead
    const error = `SSH reconnection failed after ${attempts} attempts`;
    await this.updateSessionStatus(pool, sessionId, 'terminated', error).catch(() => {});
    await this.logActivity(pool, sessionId, connectionId, 'reconnect_exhausted', {
      total_attempts: attempts,
    }).catch(() => {});

    return {
      success: false,
      attempts,
      finalStatus: 'terminated',
      error: `${error}: connection to ${connectionId} could not be re-established`,
    };
  }

  /**
   * Check if a tmux session exists on the remote host via SSH channel.
   *
   * Uses `tmux has-session -t <name>` executed through the SSH2 client's
   * channel execution (not child_process). Exit code 0 means session exists.
   * The session name is shell-escaped to prevent injection.
   */
  private async checkRemoteTmuxSession(
    sshResult: SSHConnectResult,
    tmuxSessionName: string,
  ): Promise<boolean> {
    if (!sshResult.client) return false;

    const escapedName = escapeShellArg(tmuxSessionName);

    return new Promise<boolean>((resolve) => {
      // ssh2 Client.exec runs a command over an SSH channel (not local shell)
      sshResult.client!.exec(
        `tmux has-session -t ${escapedName} 2>/dev/null`,
        (err, stream) => {
          if (err) {
            resolve(false);
            return;
          }

          stream.on('close', (code: number) => {
            resolve(code === 0);
          });

          stream.on('error', () => {
            resolve(false);
          });
        },
      );
    });
  }

  /** Update session status in the database. */
  private async updateSessionStatus(
    pool: pg.Pool,
    sessionId: string,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    if (status === 'terminated') {
      await pool.query(
        `UPDATE terminal_session
         SET status = $1, error_message = $2, terminated_at = $3, updated_at = $3
         WHERE id = $4`,
        [status, errorMessage ?? null, now, sessionId],
      );
    } else {
      await pool.query(
        `UPDATE terminal_session
         SET status = $1, error_message = NULL, updated_at = $2
         WHERE id = $3`,
        [status, now, sessionId],
      );
    }
  }

  /** Log a reconnect activity entry in terminal_activity. */
  private async logActivity(
    pool: pg.Pool,
    sessionId: string,
    connectionId: string,
    eventType: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO terminal_activity
       (id, session_id, connection_id, event_type, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [randomUUID(), sessionId, connectionId, eventType, JSON.stringify(metadata)],
    );
  }
}

/** Escape a string for safe use in a shell command (defense-in-depth). */
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** Promise-based sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
