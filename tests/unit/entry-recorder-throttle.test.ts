/**
 * Tests for entry recorder throttling behaviour.
 * Issue #2111 — Entry recorder silently drops output during throttling.
 *
 * Verifies that:
 * - Throttled output is buffered rather than dropped
 * - Throttle summary is recorded when throttling kicks in
 * - Metrics (throttled bytes) are tracked per session
 * - No output is silently lost
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EntryRecorder } from '../../src/tmux-worker/entry-recorder.ts';
import type { PendingEntry } from '../../src/tmux-worker/entry-recorder.ts';

/** Create a mock pg.Pool that records queries. */
function createMockPool() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    pool: {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as import('pg').Pool,
    queries,
  };
}

function makeOutputEntry(sessionId: string, contentBytes: number): PendingEntry {
  return {
    session_id: sessionId,
    pane_id: null,
    namespace: 'test-ns',
    kind: 'output',
    content: 'X'.repeat(contentBytes),
    metadata: null,
  };
}

describe('EntryRecorder throttling (#2111)', () => {
  let recorder: EntryRecorder;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    recorder?.stop();
  });

  it('accepts output below throttle threshold', () => {
    recorder = new EntryRecorder(mockPool.pool, {
      maxBufferSize: 1000,
      flushIntervalMs: 60_000,
      throttleBytesPerSec: 1024,
      throttleSustainedMs: 1_000,
    });

    // 500 bytes << 1024 bytes/sec * 1 sec = 1024 byte threshold
    const result = recorder.record(makeOutputEntry('sess-1', 500));
    expect(result).toBe(true);
    expect(recorder.bufferSize).toBe(1);
  });

  it('buffers throttled output instead of dropping it', () => {
    recorder = new EntryRecorder(mockPool.pool, {
      maxBufferSize: 10_000,
      flushIntervalMs: 60_000,
      throttleBytesPerSec: 100,
      throttleSustainedMs: 1_000,
      // Threshold = 100 bytes/sec * 1 sec = 100 bytes
    });

    // First entry: 60 bytes — within budget
    const r1 = recorder.record(makeOutputEntry('sess-1', 60));
    expect(r1).toBe(true);

    // Second entry: 60 bytes — total 120 > 100 threshold → throttled
    // But should still be accepted (buffered), not dropped
    const r2 = recorder.record(makeOutputEntry('sess-1', 60));
    expect(r2).toBe(true);

    // The entry should still be in the buffer (buffered, not dropped)
    expect(recorder.bufferSize).toBeGreaterThanOrEqual(2);
  });

  it('records throttle metrics when throttling starts', () => {
    recorder = new EntryRecorder(mockPool.pool, {
      maxBufferSize: 10_000,
      flushIntervalMs: 60_000,
      throttleBytesPerSec: 100,
      throttleSustainedMs: 1_000,
    });

    // Exceed threshold
    recorder.record(makeOutputEntry('sess-1', 60));
    recorder.record(makeOutputEntry('sess-1', 60));

    // Check that throttle metrics are available
    const metrics = recorder.getThrottleMetrics('sess-1');
    expect(metrics).toBeDefined();
    expect(metrics!.totalThrottledBytes).toBeGreaterThan(0);
  });

  it('does not lose output entries when flushing under throttle', async () => {
    recorder = new EntryRecorder(mockPool.pool, {
      maxBufferSize: 10_000,
      flushIntervalMs: 60_000,
      throttleBytesPerSec: 100,
      throttleSustainedMs: 1_000,
    });

    // Record multiple entries that exceed threshold
    for (let i = 0; i < 10; i++) {
      recorder.record(makeOutputEntry('sess-1', 50));
    }

    // All entries should be in the buffer (none dropped)
    const bufferBefore = recorder.bufferSize;
    expect(bufferBefore).toBe(10);

    // Flush and verify all were written
    const flushed = await recorder.flush();
    expect(flushed).toBe(10);
  });

  it('notifies client when throttling is active via throttle summary', () => {
    recorder = new EntryRecorder(mockPool.pool, {
      maxBufferSize: 10_000,
      flushIntervalMs: 60_000,
      throttleBytesPerSec: 100,
      throttleSustainedMs: 1_000,
    });

    // Exceed threshold to trigger throttling
    recorder.record(makeOutputEntry('sess-1', 200));

    // recordThrottleSummary should work and add a summary entry
    recorder.recordThrottleSummary('sess-1', 'test-ns', 200, 1.0, 'first...', 'last...');
    const size = recorder.bufferSize;
    // Buffer should contain both the original entry and the summary
    expect(size).toBeGreaterThanOrEqual(2);
  });

  it('command entries are never throttled', () => {
    recorder = new EntryRecorder(mockPool.pool, {
      maxBufferSize: 10_000,
      flushIntervalMs: 60_000,
      throttleBytesPerSec: 10,
      throttleSustainedMs: 1_000,
    });

    // Exceed output threshold
    recorder.record(makeOutputEntry('sess-1', 100));

    // Command entry should always be accepted regardless of throttle state
    const result = recorder.record({
      session_id: 'sess-1',
      pane_id: null,
      namespace: 'test-ns',
      kind: 'command',
      content: 'ls -la',
      metadata: null,
    });
    expect(result).toBe(true);
  });

  it('tracks throttled bytes per session independently', () => {
    recorder = new EntryRecorder(mockPool.pool, {
      maxBufferSize: 10_000,
      flushIntervalMs: 60_000,
      throttleBytesPerSec: 100,
      throttleSustainedMs: 1_000,
    });

    // Exceed threshold on sess-1
    recorder.record(makeOutputEntry('sess-1', 200));

    // sess-2 should not be affected by sess-1 throttle
    const r = recorder.record(makeOutputEntry('sess-2', 50));
    expect(r).toBe(true);
    const metrics2 = recorder.getThrottleMetrics('sess-2');
    expect(metrics2?.totalThrottledBytes).toBe(0);
  });
});
