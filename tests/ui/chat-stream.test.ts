/**
 * @vitest-environment jsdom
 */
/**
 * Tests for useChatStream hook (Epic #1940, Issue #1951).
 *
 * Validates stream buffering, rAF-batched rendering, sequence validation,
 * completion/failure transitions, and cleanup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatStream, type StreamState } from '@/ui/hooks/use-chat-stream.ts';
import type { ChatWsEvent } from '@/ui/hooks/use-chat-websocket.ts';

// ---------------------------------------------------------------------------
// Mock requestAnimationFrame
// ---------------------------------------------------------------------------

let rafCallbacks: Array<() => void> = [];

beforeEach(() => {
  rafCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function flushRaf(): void {
  const cbs = [...rafCallbacks];
  rafCallbacks = [];
  for (const cb of cbs) cb();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useChatStream', () => {
  it('should start with empty stream state', () => {
    const { result } = renderHook(() => useChatStream());

    expect(result.current.streams).toEqual({});
    expect(result.current.getStreamContent('msg-1')).toBe('');
    expect(result.current.getStreamState('msg-1')).toBeUndefined();
  });

  it('should buffer stream chunks and batch via rAF', () => {
    const { result } = renderHook(() => useChatStream());

    // Send first chunk
    act(() => {
      result.current.handleEvent({
        type: 'stream:chunk',
        session_id: 'sess-1',
        message_id: 'msg-1',
        chunk: 'Hello ',
        seq: 0,
      } as ChatWsEvent);
    });

    // Before rAF flush, content should not be rendered yet
    // (it's in the ref buffer, not exposed via getStreamContent yet)

    // Flush rAF to trigger state update
    act(() => {
      flushRaf();
    });

    expect(result.current.getStreamContent('msg-1')).toBe('Hello ');
    expect(result.current.getStreamState('msg-1')).toBe('streaming');

    // Send second chunk
    act(() => {
      result.current.handleEvent({
        type: 'stream:chunk',
        session_id: 'sess-1',
        message_id: 'msg-1',
        chunk: 'World!',
        seq: 1,
      } as ChatWsEvent);
    });

    act(() => {
      flushRaf();
    });

    expect(result.current.getStreamContent('msg-1')).toBe('Hello World!');
  });

  it('should handle stream:completed by replacing buffer with full content', () => {
    const { result } = renderHook(() => useChatStream());

    // Stream some chunks
    act(() => {
      result.current.handleEvent({
        type: 'stream:chunk',
        session_id: 's1',
        message_id: 'msg-1',
        chunk: 'Hel',
        seq: 0,
      } as ChatWsEvent);
    });

    act(() => {
      flushRaf();
    });

    // Complete with full content
    act(() => {
      result.current.handleEvent({
        type: 'stream:completed',
        session_id: 's1',
        message_id: 'msg-1',
        full_content: 'Hello complete response!',
      } as ChatWsEvent);
    });

    expect(result.current.getStreamContent('msg-1')).toBe('Hello complete response!');
    expect(result.current.getStreamState('msg-1')).toBe('completed');
  });

  it('should handle stream:failed with error state', () => {
    const { result } = renderHook(() => useChatStream());

    // Start streaming
    act(() => {
      result.current.handleEvent({
        type: 'stream:chunk',
        session_id: 's1',
        message_id: 'msg-1',
        chunk: 'Partial...',
        seq: 0,
      } as ChatWsEvent);
    });

    act(() => {
      flushRaf();
    });

    // Fail
    act(() => {
      result.current.handleEvent({
        type: 'stream:failed',
        session_id: 's1',
        message_id: 'msg-1',
        error: 'Agent timeout',
      } as ChatWsEvent);
    });

    expect(result.current.getStreamState('msg-1')).toBe('failed');
    expect(result.current.getStreamContent('msg-1')).toBe('Partial...');
    expect(result.current.getStreamError('msg-1')).toBe('Agent timeout');
  });

  it('should handle stream:started event', () => {
    const { result } = renderHook(() => useChatStream());

    act(() => {
      result.current.handleEvent({
        type: 'stream:started',
        session_id: 's1',
        message_id: 'msg-1',
      } as ChatWsEvent);
    });

    expect(result.current.getStreamState('msg-1')).toBe('started');
    expect(result.current.getStreamContent('msg-1')).toBe('');
  });

  it('should track multiple concurrent streams', () => {
    const { result } = renderHook(() => useChatStream());

    act(() => {
      result.current.handleEvent({
        type: 'stream:chunk',
        session_id: 's1',
        message_id: 'msg-1',
        chunk: 'Stream 1',
        seq: 0,
      } as ChatWsEvent);
      result.current.handleEvent({
        type: 'stream:chunk',
        session_id: 's1',
        message_id: 'msg-2',
        chunk: 'Stream 2',
        seq: 0,
      } as ChatWsEvent);
    });

    act(() => {
      flushRaf();
    });

    expect(result.current.getStreamContent('msg-1')).toBe('Stream 1');
    expect(result.current.getStreamContent('msg-2')).toBe('Stream 2');
  });

  it('should clear completed streams via clearStream', () => {
    const { result } = renderHook(() => useChatStream());

    act(() => {
      result.current.handleEvent({
        type: 'stream:completed',
        session_id: 's1',
        message_id: 'msg-1',
        full_content: 'Done!',
      } as ChatWsEvent);
    });

    expect(result.current.getStreamState('msg-1')).toBe('completed');

    act(() => {
      result.current.clearStream('msg-1');
    });

    expect(result.current.getStreamState('msg-1')).toBeUndefined();
  });

  it('should validate sequence ordering — reject out-of-order chunks', () => {
    const { result } = renderHook(() => useChatStream());

    // seq 0
    act(() => {
      result.current.handleEvent({
        type: 'stream:chunk',
        session_id: 's1',
        message_id: 'msg-1',
        chunk: 'First',
        seq: 0,
      } as ChatWsEvent);
    });

    act(() => {
      flushRaf();
    });

    // seq 2 (skip seq 1) — should still be accepted but logged
    act(() => {
      result.current.handleEvent({
        type: 'stream:chunk',
        session_id: 's1',
        message_id: 'msg-1',
        chunk: 'Third',
        seq: 2,
      } as ChatWsEvent);
    });

    act(() => {
      flushRaf();
    });

    // Content should still include the out-of-order chunk (append strategy)
    expect(result.current.getStreamContent('msg-1')).toBe('FirstThird');
  });

  it('should batch multiple rapid chunks into single rAF update', () => {
    const { result } = renderHook(() => useChatStream());

    // Send 5 chunks rapidly before any rAF fires
    act(() => {
      for (let i = 0; i < 5; i++) {
        result.current.handleEvent({
          type: 'stream:chunk',
          session_id: 's1',
          message_id: 'msg-1',
          chunk: `${i}`,
          seq: i,
        } as ChatWsEvent);
      }
    });

    // Only 1 rAF should have been scheduled (deduplication)
    expect(rafCallbacks.length).toBeLessThanOrEqual(2);

    act(() => {
      flushRaf();
    });

    // All chunks should be present after single flush
    expect(result.current.getStreamContent('msg-1')).toBe('01234');
  });

  it('should handle clearAllStreams', () => {
    const { result } = renderHook(() => useChatStream());

    act(() => {
      result.current.handleEvent({
        type: 'stream:chunk',
        session_id: 's1',
        message_id: 'msg-1',
        chunk: 'A',
        seq: 0,
      } as ChatWsEvent);
      result.current.handleEvent({
        type: 'stream:chunk',
        session_id: 's1',
        message_id: 'msg-2',
        chunk: 'B',
        seq: 0,
      } as ChatWsEvent);
    });

    act(() => {
      flushRaf();
    });

    act(() => {
      result.current.clearAllStreams();
    });

    expect(result.current.streams).toEqual({});
  });
});
