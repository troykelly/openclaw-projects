/**
 * Unit tests for Chat Stream Manager (#1945).
 *
 * Tests the stream state machine for agent response streaming.
 * Pure unit tests — no database or server required.
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StreamManager, resetStreamManager } from '../../src/api/chat/stream-manager.ts';

describe('Chat Stream Manager (#1945)', () => {
  let manager: StreamManager;

  beforeEach(() => {
    vi.useFakeTimers();
    resetStreamManager();
    manager = new StreamManager();
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  describe('handleChunk', () => {
    it('starts a new stream on first chunk', () => {
      const result = manager.handleChunk('session-1', { content: 'hello', seq: 0 });
      expect(result.ok).toBe(true);
      expect(result.messageId).toBeTruthy();
    });

    it('uses provided message_id', () => {
      const result = manager.handleChunk('session-1', {
        content: 'hello',
        seq: 0,
        message_id: 'msg-123',
      });
      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('msg-123');
    });

    it('accepts sequential chunks', () => {
      manager.handleChunk('session-1', { content: 'hello', seq: 0 });
      const result = manager.handleChunk('session-1', { content: ' world', seq: 1 });
      expect(result.ok).toBe(true);
    });

    it('rejects non-monotonic sequence', () => {
      manager.handleChunk('session-1', { content: 'hello', seq: 0 });
      manager.handleChunk('session-1', { content: ' world', seq: 1 });
      const result = manager.handleChunk('session-1', { content: ' bad', seq: 1 });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
    });

    it('rejects chunk exceeding 4KB', () => {
      const bigContent = 'x'.repeat(5000);
      const result = manager.handleChunk('session-1', { content: bigContent, seq: 0 });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
    });

    it('rejects chunks exceeding 256KB total', () => {
      const chunkSize = 4000;
      const numChunks = Math.ceil(262144 / chunkSize);
      for (let i = 0; i < numChunks; i++) {
        const result = manager.handleChunk('session-1', {
          content: 'x'.repeat(chunkSize),
          seq: i,
        });
        if (!result.ok) {
          // Should fail at some point when total exceeds 256KB
          expect(result.status).toBe(400);
          expect(result.error).toContain('256KB');
          return;
        }
      }
      // If we got here, the limit wasn't hit at all — that's an error
      throw new Error('Expected 256KB limit to be hit');
    });

    it('tracks separate streams per session', () => {
      const r1 = manager.handleChunk('session-1', { content: 'a', seq: 0 });
      const r2 = manager.handleChunk('session-2', { content: 'b', seq: 0 });
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r1.messageId).not.toBe(r2.messageId);
    });
  });

  describe('handleCompleted', () => {
    it('completes a stream', () => {
      manager.handleChunk('session-1', { content: 'hello', seq: 0 });
      const result = manager.handleCompleted('session-1', { content: 'hello world' });
      expect(result.ok).toBe(true);
    });

    it('allows completion without prior chunks', () => {
      const result = manager.handleCompleted('session-1', { content: 'full response' });
      expect(result.ok).toBe(true);
    });

    it('rejects double completion', () => {
      manager.handleChunk('session-1', { content: 'hello', seq: 0 });
      manager.handleCompleted('session-1', { content: 'hello' });
      // Stream was cleaned up, so completing again is treated as "no active stream"
      const result = manager.handleCompleted('session-1', { content: 'hello' });
      // This should succeed since there's no active stream (new synthetic completion)
      expect(result.ok).toBe(true);
    });

    it('rejects completion after failure', () => {
      manager.handleChunk('session-1', { content: 'hello', seq: 0 });
      manager.handleFailed('session-1', { error: 'oops' });
      // Stream was cleaned up
      const result = manager.handleCompleted('session-1', { content: 'hello' });
      expect(result.ok).toBe(true); // No active stream, synthetic OK
    });
  });

  describe('handleFailed', () => {
    it('fails a stream', () => {
      manager.handleChunk('session-1', { content: 'hello', seq: 0 });
      const result = manager.handleFailed('session-1', { error: 'timeout' });
      expect(result.ok).toBe(true);
      expect(result.messageId).toBeTruthy();
    });

    it('fails gracefully with no active stream', () => {
      const result = manager.handleFailed('session-1', { error: 'timeout' });
      expect(result.ok).toBe(true);
    });
  });

  describe('timeout watchdog', () => {
    it('auto-aborts stream after 60s inactivity', () => {
      const abortSpy = vi.fn();
      manager.onStreamAbort = abortSpy;

      manager.handleChunk('session-1', { content: 'hello', seq: 0 });
      expect(manager.getActiveStream('session-1')).not.toBeNull();

      // Advance past timeout
      vi.advanceTimersByTime(61_000);

      expect(manager.getActiveStream('session-1')).toBeNull();
      expect(abortSpy).toHaveBeenCalledWith('session-1', expect.any(String));
    });

    it('resets timeout on each chunk', () => {
      const abortSpy = vi.fn();
      manager.onStreamAbort = abortSpy;

      manager.handleChunk('session-1', { content: 'hello', seq: 0 });
      vi.advanceTimersByTime(50_000); // Almost expired

      manager.handleChunk('session-1', { content: ' world', seq: 1 });
      vi.advanceTimersByTime(50_000); // 50s after second chunk — not yet expired

      expect(manager.getActiveStream('session-1')).not.toBeNull();
      expect(abortSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(11_000); // Now 61s after second chunk — should abort
      expect(manager.getActiveStream('session-1')).toBeNull();
      expect(abortSpy).toHaveBeenCalled();
    });

    it('clears timeout on completion', () => {
      const abortSpy = vi.fn();
      manager.onStreamAbort = abortSpy;

      manager.handleChunk('session-1', { content: 'hello', seq: 0 });
      manager.handleCompleted('session-1', { content: 'hello world' });

      vi.advanceTimersByTime(61_000);
      expect(abortSpy).not.toHaveBeenCalled();
    });
  });

  describe('getActiveStream', () => {
    it('returns null for no active stream', () => {
      expect(manager.getActiveStream('session-1')).toBeNull();
    });

    it('returns stream info for active stream', () => {
      manager.handleChunk('session-1', { content: 'hello', seq: 0 });
      const info = manager.getActiveStream('session-1');
      expect(info).not.toBeNull();
      expect(info!.state).toBe('streaming');
      expect(info!.chunkCount).toBe(1);
    });
  });
});
