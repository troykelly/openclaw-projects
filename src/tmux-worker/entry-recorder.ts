/**
 * Entry recording service for the tmux worker.
 *
 * Batches terminal session entry inserts for efficiency.
 * Supports output throttling and flush-on-shutdown.
 *
 * Issue #1680 — Entry recording and embedding pipeline.
 * Epic #1667 — TMux Session Management.
 */

import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/** Supported entry kinds. */
export type EntryKind = 'command' | 'output' | 'scrollback' | 'annotation' | 'error';

/** An entry waiting to be written to the database. */
export interface PendingEntry {
  session_id: string;
  pane_id: string | null;
  namespace: string;
  kind: EntryKind;
  content: string;
  metadata: Record<string, unknown> | null;
}

/** Configuration for the entry recorder. */
export interface EntryRecorderConfig {
  /** Maximum entries to buffer before flushing. Default: 100. */
  maxBufferSize: number;
  /** Maximum time (ms) to hold entries before flushing. Default: 5000. */
  flushIntervalMs: number;
  /** Output throttle threshold in bytes per second. Default: 1_048_576 (1MB/s). */
  throttleBytesPerSec: number;
  /** Duration (ms) of sustained high output before throttling. Default: 10_000. */
  throttleSustainedMs: number;
}

const DEFAULT_CONFIG: EntryRecorderConfig = {
  maxBufferSize: 100,
  flushIntervalMs: 5_000,
  throttleBytesPerSec: 1_048_576,
  throttleSustainedMs: 10_000,
};

/**
 * Tracks output rate for a single session to detect high-volume output.
 */
interface SessionThrottleState {
  /** Total bytes recorded in the current measurement window. */
  windowBytes: number;
  /** Start of the current measurement window. */
  windowStart: number;
  /** Whether we are currently in throttled mode. */
  throttled: boolean;
}

/**
 * Entry recorder that batches inserts and supports output throttling.
 *
 * Usage:
 * ```ts
 * const recorder = new EntryRecorder(pool, config);
 * recorder.start();
 * recorder.record({ ... });
 * await recorder.flush(); // on shutdown
 * recorder.stop();
 * ```
 */
export class EntryRecorder {
  private readonly pool: pg.Pool;
  private readonly config: EntryRecorderConfig;
  private buffer: PendingEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly throttleState = new Map<string, SessionThrottleState>();

  constructor(pool: pg.Pool, config?: Partial<EntryRecorderConfig>) {
    this.pool = pool;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start the periodic flush timer. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.config.flushIntervalMs);
  }

  /** Stop the periodic flush timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Record an entry. Applies throttling for output entries.
   * Returns true if the entry was accepted, false if throttled.
   */
  record(entry: PendingEntry): boolean {
    // Check throttling for output/scrollback entries
    if (entry.kind === 'output' || entry.kind === 'scrollback') {
      if (this.isThrottled(entry.session_id, entry.content.length)) {
        return false;
      }
    }

    this.buffer.push(entry);

    if (this.buffer.length >= this.config.maxBufferSize) {
      void this.flush();
    }

    return true;
  }

  /**
   * Record a throttle summary when output rate is too high.
   */
  recordThrottleSummary(
    sessionId: string,
    namespace: string,
    totalBytes: number,
    durationSec: number,
    firstChunk: string,
    lastChunk: string,
  ): void {
    const content = [
      `[High-volume output throttled: ${totalBytes} bytes in ${durationSec.toFixed(1)}s]`,
      `First 1KB:\n${firstChunk}`,
      `Last 1KB:\n${lastChunk}`,
    ].join('\n\n');

    this.buffer.push({
      session_id: sessionId,
      pane_id: null,
      namespace,
      kind: 'scrollback',
      content,
      metadata: { throttled: true, total_bytes: totalBytes, duration_s: durationSec },
    });
  }

  /** Flush all buffered entries to the database. */
  async flush(): Promise<number> {
    if (this.buffer.length === 0) return 0;

    const entries = this.buffer.splice(0);
    const count = entries.length;

    // Build batch INSERT
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const entry of entries) {
      const id = randomUUID();
      placeholders.push(
        `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6})`,
      );
      values.push(
        id,
        entry.session_id,
        entry.pane_id,
        entry.namespace,
        entry.kind,
        entry.content,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      );
      idx += 7;
    }

    await this.pool.query(
      `INSERT INTO terminal_session_entry (id, session_id, pane_id, namespace, kind, content, metadata)
       VALUES ${placeholders.join(', ')}`,
      values,
    );

    return count;
  }

  /** Get current buffer size. */
  get bufferSize(): number {
    return this.buffer.length;
  }

  /** Reset throttle state for a session (e.g., when session terminates). */
  resetThrottle(sessionId: string): void {
    this.throttleState.delete(sessionId);
  }

  /**
   * Check if output for a session should be throttled.
   * Uses a cumulative bytes threshold: if total bytes in the sustained window
   * exceeds (throttleBytesPerSec * sustainedDurationSec), throttle kicks in.
   */
  private isThrottled(sessionId: string, contentBytes: number): boolean {
    const now = Date.now();
    let state = this.throttleState.get(sessionId);

    if (!state) {
      state = { windowBytes: 0, windowStart: now, throttled: false };
      this.throttleState.set(sessionId, state);
    }

    // Reset window if older than sustained duration
    if (now - state.windowStart > this.config.throttleSustainedMs) {
      state.windowBytes = 0;
      state.windowStart = now;
      state.throttled = false;
    }

    state.windowBytes += contentBytes;

    // Threshold: allowed bytes = rate * window duration (in seconds)
    const windowDurationSec = this.config.throttleSustainedMs / 1000;
    const byteThreshold = this.config.throttleBytesPerSec * windowDurationSec;

    if (state.windowBytes > byteThreshold) {
      state.throttled = true;
      return true;
    }

    return false;
  }
}
