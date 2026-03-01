/**
 * Stream buffering hook for chat (Epic #1940, Issue #1951).
 *
 * Manages per-message stream state: buffers chunks in refs (not state)
 * and batches UI updates via requestAnimationFrame to avoid per-token
 * re-renders.
 *
 * Key performance decisions:
 * - Chunks are appended to a ref-based buffer (no state per chunk)
 * - A single rAF coalesces multiple rapid chunks into one React state update
 * - On stream:completed, the buffer is replaced with the authoritative full content
 * - Sequence numbers are validated (gaps logged but not blocking)
 */
import { useCallback, useRef, useState } from 'react';
import type { ChatWsEvent } from './use-chat-websocket.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StreamState = 'started' | 'streaming' | 'completed' | 'failed';

export interface StreamEntry {
  content: string;
  state: StreamState;
  error?: string;
  lastSeq: number;
}

interface UseChatStreamReturn {
  /** Current stream entries keyed by message_id. */
  streams: Record<string, StreamEntry>;
  /** Get the current buffered content for a message. */
  getStreamContent: (messageId: string) => string;
  /** Get the current stream state for a message. */
  getStreamState: (messageId: string) => StreamState | undefined;
  /** Get the error message for a failed stream. */
  getStreamError: (messageId: string) => string | undefined;
  /** Process a WebSocket event (connect to useChatWebSocket.onEvent). */
  handleEvent: (event: ChatWsEvent) => void;
  /** Clear a single stream entry (after message is finalized). */
  clearStream: (messageId: string) => void;
  /** Clear all stream entries. */
  clearAllStreams: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that buffers streaming chat chunks and batches state updates
 * via requestAnimationFrame for optimal rendering performance.
 */
export function useChatStream(): UseChatStreamReturn {
  const [streams, setStreams] = useState<Record<string, StreamEntry>>({});

  // Ref-based buffer for chunk accumulation (avoids per-chunk re-renders)
  const bufferRef = useRef<Record<string, { chunks: string[]; lastSeq: number }>>({});
  const rafRef = useRef<number | null>(null);
  const dirtyRef = useRef<Set<string>>(new Set());

  /**
   * Schedule a rAF-batched state update. Multiple chunks between frames
   * are coalesced into a single React state update.
   */
  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return; // Already scheduled

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;

      const dirty = new Set(dirtyRef.current);
      dirtyRef.current.clear();

      if (dirty.size === 0) return;

      setStreams((prev) => {
        const next = { ...prev };
        for (const messageId of dirty) {
          const buf = bufferRef.current[messageId];
          if (!buf) continue;
          const content = buf.chunks.join('');
          next[messageId] = {
            ...next[messageId],
            content,
            state: 'streaming',
            lastSeq: buf.lastSeq,
          };
        }
        return next;
      });
    });
  }, []);

  const handleEvent = useCallback((event: ChatWsEvent) => {
    const messageId = event.message_id;
    if (!messageId) return;

    switch (event.type) {
      case 'stream:started': {
        // Initialize buffer
        bufferRef.current[messageId] = { chunks: [], lastSeq: -1 };
        setStreams((prev) => ({
          ...prev,
          [messageId]: { content: '', state: 'started', lastSeq: -1 },
        }));
        break;
      }

      case 'stream:chunk': {
        const chunk = event.chunk;
        const seq = event.seq;
        if (typeof chunk !== 'string' || typeof seq !== 'number') break;

        // Initialize buffer if stream:started was missed
        if (!bufferRef.current[messageId]) {
          bufferRef.current[messageId] = { chunks: [], lastSeq: -1 };
        }

        const buf = bufferRef.current[messageId];

        // Sequence validation (warn on gaps but don't reject)
        if (seq !== buf.lastSeq + 1 && buf.lastSeq >= 0) {
          console.warn(
            `[useChatStream] Sequence gap for ${messageId}: expected ${buf.lastSeq + 1}, got ${seq}`,
          );
        }

        buf.chunks.push(chunk);
        buf.lastSeq = seq;

        // Mark dirty and schedule batched update
        dirtyRef.current.add(messageId);
        scheduleFlush();
        break;
      }

      case 'stream:completed': {
        const fullContent = event.full_content;
        if (typeof fullContent !== 'string') break;

        // Replace buffer with authoritative content
        delete bufferRef.current[messageId];

        // Cancel any pending rAF for this message
        dirtyRef.current.delete(messageId);

        setStreams((prev) => ({
          ...prev,
          [messageId]: {
            content: fullContent,
            state: 'completed',
            lastSeq: prev[messageId]?.lastSeq ?? -1,
          },
        }));
        break;
      }

      case 'stream:failed': {
        const error = event.error;

        // Preserve whatever content was buffered
        const buf = bufferRef.current[messageId];
        const content = buf ? buf.chunks.join('') : '';
        delete bufferRef.current[messageId];
        dirtyRef.current.delete(messageId);

        setStreams((prev) => ({
          ...prev,
          [messageId]: {
            content: prev[messageId]?.content || content,
            state: 'failed',
            error: typeof error === 'string' ? error : 'Unknown error',
            lastSeq: prev[messageId]?.lastSeq ?? -1,
          },
        }));
        break;
      }

      // Ignore other event types (pong, connection:established, etc.)
      default:
        break;
    }
  }, [scheduleFlush]);

  const getStreamContent = useCallback(
    (messageId: string) => streams[messageId]?.content ?? '',
    [streams],
  );

  const getStreamState = useCallback(
    (messageId: string) => streams[messageId]?.state,
    [streams],
  );

  const getStreamError = useCallback(
    (messageId: string) => streams[messageId]?.error,
    [streams],
  );

  const clearStream = useCallback((messageId: string) => {
    delete bufferRef.current[messageId];
    dirtyRef.current.delete(messageId);
    setStreams((prev) => {
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
  }, []);

  const clearAllStreams = useCallback(() => {
    bufferRef.current = {};
    dirtyRef.current.clear();
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setStreams({});
  }, []);

  return {
    streams,
    getStreamContent,
    getStreamState,
    getStreamError,
    handleEvent,
    clearStream,
    clearAllStreams,
  };
}
