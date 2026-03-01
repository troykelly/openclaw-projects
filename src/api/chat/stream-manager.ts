/**
 * Stream state machine for agent chat streaming (#1945).
 *
 * Manages per-session stream state: started → chunk* → completed/failed/aborted.
 * Enforces:
 * - Single active stream per session
 * - Monotonic sequence validation
 * - Size limits (4KB/chunk, 256KB total, 100 chunks/sec)
 * - Timeout watchdog (auto-abort if no chunk for 60s)
 *
 * Epic #1940 — Agent Chat.
 */

import { randomUUID } from 'node:crypto';

/** Maximum chunk size in bytes. */
const MAX_CHUNK_BYTES = 4096;
/** Maximum total stream size in bytes. */
const MAX_TOTAL_BYTES = 262144; // 256KB
/** Maximum chunks per second. */
const MAX_CHUNKS_PER_SEC = 100;
/** Stream timeout in milliseconds (no chunk received). */
const STREAM_TIMEOUT_MS = 60_000;

/** Stream states. */
type StreamState = 'started' | 'streaming' | 'completed' | 'failed' | 'aborted';

/** Per-session stream tracking. */
interface StreamSession {
  state: StreamState;
  messageId: string;
  agentRunId: string | undefined;
  lastSeq: number;
  totalBytes: number;
  chunkCount: number;
  lastChunkAt: number;
  /** Chunks received in the last second window. */
  chunkTimestamps: number[];
  /** Timeout watchdog timer. */
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  /** Callback when stream is aborted by timeout. */
  onAbort?: (sessionId: string, messageId: string) => void;
}

/** Result from a stream operation. */
interface StreamResult {
  ok: boolean;
  status: number;
  error?: string;
  messageId?: string;
}

export interface StreamChunkPayload {
  content: string;
  seq: number;
  message_id?: string;
  agent_run_id?: string;
}

export interface StreamCompletedPayload {
  content: string;
  message_id?: string;
  agent_run_id?: string;
  content_type?: string;
}

export interface StreamFailedPayload {
  error: string;
  message_id?: string;
}

/**
 * Manages stream state for all active chat sessions.
 */
export class StreamManager {
  private streams = new Map<string, StreamSession>();
  /**
   * Recently-terminated sessions (failed/aborted). Prevents resurrection
   * via a late "completed" after the stream was cleaned up.
   * Entries auto-expire after 5 minutes.
   */
  private terminated = new Map<string, { state: StreamState; at: number }>();

  /** Callback for when a stream is aborted by timeout. */
  onStreamAbort?: (sessionId: string, messageId: string) => void;

  /**
   * Handle a chunk from the agent.
   */
  handleChunk(sessionId: string, payload: StreamChunkPayload): StreamResult {
    let stream = this.streams.get(sessionId);

    if (!stream) {
      // Start a new stream
      const messageId = payload.message_id ?? randomUUID();
      stream = {
        state: 'started',
        messageId,
        agentRunId: payload.agent_run_id,
        lastSeq: -1,
        totalBytes: 0,
        chunkCount: 0,
        lastChunkAt: Date.now(),
        chunkTimestamps: [],
        timeoutTimer: null,
      };
      stream.onAbort = this.onStreamAbort;
      this.streams.set(sessionId, stream);
    }

    // Validate state
    if (stream.state !== 'started' && stream.state !== 'streaming') {
      return { ok: false, status: 409, error: `Stream is ${stream.state}` };
    }

    // Validate sequence monotonicity
    if (payload.seq <= stream.lastSeq) {
      return { ok: false, status: 400, error: `Sequence ${payload.seq} is not greater than ${stream.lastSeq}` };
    }

    // Validate chunk size
    const chunkBytes = Buffer.byteLength(payload.content, 'utf8');
    if (chunkBytes > MAX_CHUNK_BYTES) {
      return { ok: false, status: 400, error: 'Chunk exceeds 4KB limit' };
    }

    // Validate total size
    if (stream.totalBytes + chunkBytes > MAX_TOTAL_BYTES) {
      return { ok: false, status: 400, error: 'Total stream size exceeds 256KB limit' };
    }

    // Rate limit: 100 chunks/sec
    const now = Date.now();
    stream.chunkTimestamps = stream.chunkTimestamps.filter(t => now - t < 1000);
    if (stream.chunkTimestamps.length >= MAX_CHUNKS_PER_SEC) {
      return { ok: false, status: 429, error: 'Chunk rate limit exceeded (100/sec)' };
    }

    // Accept chunk
    stream.state = 'streaming';
    stream.lastSeq = payload.seq;
    stream.totalBytes += chunkBytes;
    stream.chunkCount++;
    stream.lastChunkAt = now;
    stream.chunkTimestamps.push(now);

    // Reset timeout watchdog
    this.resetTimeout(sessionId, stream);

    return { ok: true, status: 200, messageId: stream.messageId };
  }

  /**
   * Handle stream completion.
   */
  handleCompleted(sessionId: string, payload: StreamCompletedPayload): StreamResult {
    const stream = this.streams.get(sessionId);

    if (!stream) {
      // Check if session was recently terminated (prevents resurrection)
      const term = this.terminated.get(sessionId);
      if (term && Date.now() - term.at < 300_000) {
        return { ok: false, status: 409, error: `Stream already ${term.state}` };
      }
      // No active or recently-terminated stream — allow single-message response
      return { ok: true, status: 200, messageId: payload.message_id ?? randomUUID() };
    }

    if (stream.state === 'completed' || stream.state === 'failed' || stream.state === 'aborted') {
      return { ok: false, status: 409, error: `Stream already ${stream.state}` };
    }

    // Clean up
    this.clearTimeout(stream);
    stream.state = 'completed';
    const messageId = stream.messageId;
    this.streams.delete(sessionId);
    // Don't mark completed in terminated — completed is a valid end state
    // and doesn't need protection from resurrection

    return { ok: true, status: 200, messageId };
  }

  /**
   * Handle stream failure.
   */
  handleFailed(sessionId: string, payload: StreamFailedPayload): StreamResult {
    const stream = this.streams.get(sessionId);

    if (!stream) {
      // Check if session was recently terminated
      const term = this.terminated.get(sessionId);
      if (term && Date.now() - term.at < 300_000) {
        return { ok: false, status: 409, error: `Stream already ${term.state}` };
      }
      return { ok: true, status: 200, messageId: payload.message_id };
    }

    if (stream.state === 'completed' || stream.state === 'failed' || stream.state === 'aborted') {
      return { ok: false, status: 409, error: `Stream already ${stream.state}` };
    }

    // Clean up
    this.clearTimeout(stream);
    stream.state = 'failed';
    const messageId = stream.messageId;
    this.streams.delete(sessionId);
    this.terminated.set(sessionId, { state: 'failed', at: Date.now() });

    return { ok: true, status: 200, messageId };
  }

  /**
   * Get active stream info for a session (or null if none).
   */
  getActiveStream(sessionId: string): { messageId: string; state: StreamState; chunkCount: number } | null {
    const stream = this.streams.get(sessionId);
    if (!stream) return null;
    return { messageId: stream.messageId, state: stream.state, chunkCount: stream.chunkCount };
  }

  /**
   * Shut down all active streams (cleanup on server shutdown).
   */
  shutdown(): void {
    for (const [, stream] of this.streams) {
      this.clearTimeout(stream);
    }
    this.streams.clear();
    this.terminated.clear();
  }

  /** Reset the timeout watchdog for a stream. */
  private resetTimeout(sessionId: string, stream: StreamSession): void {
    this.clearTimeout(stream);
    stream.timeoutTimer = setTimeout(() => {
      stream.state = 'aborted';
      const messageId = stream.messageId;
      this.streams.delete(sessionId);
      this.terminated.set(sessionId, { state: 'aborted', at: Date.now() });
      if (stream.onAbort) {
        stream.onAbort(sessionId, messageId);
      }
    }, STREAM_TIMEOUT_MS);
  }

  /** Clear the timeout watchdog. */
  private clearTimeout(stream: StreamSession): void {
    if (stream.timeoutTimer) {
      clearTimeout(stream.timeoutTimer);
      stream.timeoutTimer = null;
    }
  }
}

// Singleton instance
let managerInstance: StreamManager | null = null;

/** Get the global StreamManager instance. */
export function getStreamManager(): StreamManager {
  if (!managerInstance) {
    managerInstance = new StreamManager();
  }
  return managerInstance;
}

/** Reset the manager (for testing). */
export function resetStreamManager(): void {
  if (managerInstance) {
    managerInstance.shutdown();
    managerInstance = null;
  }
}
