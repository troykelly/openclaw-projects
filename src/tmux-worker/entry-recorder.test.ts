/**
 * Unit tests for the EntryRecorder.
 *
 * Issue #1680 — Entry recording and embedding pipeline.
 * Epic #1667 — TMux Session Management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EntryRecorder } from './entry-recorder.ts';
import type { PendingEntry } from './entry-recorder.ts';

/** Create a mock pool that captures query calls. */
function createMockPool() {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  return {
    queries,
    query: vi.fn(async (text: string, values?: unknown[]) => {
      queries.push({ text, values: values ?? [] });
      return { rows: [], rowCount: 0 };
    }),
  };
}

function makeEntry(overrides?: Partial<PendingEntry>): PendingEntry {
  return {
    session_id: 'sess-1',
    pane_id: null,
    namespace: 'default',
    kind: 'command',
    content: 'ls -la',
    metadata: null,
    ...overrides,
  };
}

describe('EntryRecorder', () => {
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('record()', () => {
    it('buffers entries', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
      const recorder = new EntryRecorder(mockPool as any);
      const accepted = recorder.record(makeEntry());
      expect(accepted).toBe(true);
      expect(recorder.bufferSize).toBe(1);
    });

    it('auto-flushes when buffer reaches maxBufferSize', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
      const recorder = new EntryRecorder(mockPool as any, { maxBufferSize: 3, flushIntervalMs: 60000, throttleBytesPerSec: 1_048_576, throttleSustainedMs: 10000 });

      recorder.record(makeEntry({ content: 'cmd 1' }));
      recorder.record(makeEntry({ content: 'cmd 2' }));
      recorder.record(makeEntry({ content: 'cmd 3' }));

      // Allow the auto-flush to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(mockPool.query).toHaveBeenCalled();
      // Buffer should be empty after flush
      expect(recorder.bufferSize).toBe(0);
    });
  });

  describe('flush()', () => {
    it('inserts all buffered entries in a single batch', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
      const recorder = new EntryRecorder(mockPool as any);
      recorder.record(makeEntry({ content: 'cmd 1' }));
      recorder.record(makeEntry({ content: 'cmd 2' }));

      const count = await recorder.flush();

      expect(count).toBe(2);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const query = mockPool.queries[0];
      expect(query.text).toContain('INSERT INTO terminal_session_entry');
      // 7 params per entry, 2 entries = 14 values
      expect(query.values).toHaveLength(14);
    });

    it('returns 0 when buffer is empty', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
      const recorder = new EntryRecorder(mockPool as any);
      const count = await recorder.flush();
      expect(count).toBe(0);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('includes metadata as JSON', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
      const recorder = new EntryRecorder(mockPool as any);
      recorder.record(makeEntry({
        content: 'whoami',
        metadata: { exit_code: 0, duration_ms: 42 },
      }));

      await recorder.flush();

      const values = mockPool.queries[0].values;
      // metadata is the 7th value
      expect(values[6]).toBe('{"exit_code":0,"duration_ms":42}');
    });
  });

  describe('throttling', () => {
    it('throttles high-volume output entries', () => {
      // Threshold: 100 bytes/sec * 1sec window = 100 bytes total before throttle
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
      const recorder = new EntryRecorder(mockPool as any, {
        maxBufferSize: 1000,
        flushIntervalMs: 60000,
        throttleBytesPerSec: 100,
        throttleSustainedMs: 1000, // 1 second window, so threshold is 100 bytes
      });

      // First small entry accepted (50 bytes < 100 threshold)
      const first = recorder.record(makeEntry({
        kind: 'output',
        content: 'a'.repeat(50),
      }));
      expect(first).toBe(true);

      // Second entry pushes over threshold (50 + 200 = 250 > 100)
      const second = recorder.record(makeEntry({
        kind: 'output',
        content: 'b'.repeat(200),
      }));
      expect(second).toBe(false);
    });

    it('does not throttle command entries', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
      const recorder = new EntryRecorder(mockPool as any, {
        maxBufferSize: 1000,
        flushIntervalMs: 60000,
        throttleBytesPerSec: 1, // extremely low threshold
        throttleSustainedMs: 100,
      });

      // Command entries should never be throttled
      for (let i = 0; i < 10; i++) {
        const accepted = recorder.record(makeEntry({
          kind: 'command',
          content: `command-${i}`,
        }));
        expect(accepted).toBe(true);
      }
    });

    it('resets throttle for a session', () => {
      // Threshold: 100 bytes/sec * 1sec = 100 bytes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
      const recorder = new EntryRecorder(mockPool as any, {
        maxBufferSize: 1000,
        flushIntervalMs: 60000,
        throttleBytesPerSec: 100,
        throttleSustainedMs: 1000,
      });

      // First entry: 50 bytes accepted
      recorder.record(makeEntry({ kind: 'output', content: 'a'.repeat(50) }));
      // Second entry: 50 + 200 = 250 > 100 threshold, throttled
      expect(recorder.record(makeEntry({ kind: 'output', content: 'b'.repeat(200) }))).toBe(false);

      // Reset throttle
      recorder.resetThrottle('sess-1');

      // Should be accepted again (fresh window)
      expect(recorder.record(makeEntry({ kind: 'output', content: 'c'.repeat(50) }))).toBe(true);
    });
  });

  describe('start/stop', () => {
    it('starts and stops the periodic timer', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
      const recorder = new EntryRecorder(mockPool as any, {
        maxBufferSize: 100,
        flushIntervalMs: 100,
        throttleBytesPerSec: 1_048_576,
        throttleSustainedMs: 10000,
      });

      recorder.start();
      recorder.stop();
      // No error means success
    });

    it('start is idempotent', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
      const recorder = new EntryRecorder(mockPool as any);
      recorder.start();
      recorder.start(); // should not create second timer
      recorder.stop();
    });
  });

  describe('recordThrottleSummary()', () => {
    it('records a throttle summary entry', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
      const recorder = new EntryRecorder(mockPool as any);

      recorder.recordThrottleSummary(
        'sess-1',
        'default',
        5_000_000,
        10.5,
        'first chunk data...',
        'last chunk data...',
      );

      expect(recorder.bufferSize).toBe(1);
      await recorder.flush();

      const query = mockPool.queries[0];
      expect(query.values[4]).toBe('scrollback'); // kind
      expect(query.values[5]).toContain('High-volume output throttled');
      expect(query.values[5]).toContain('5000000 bytes');
    });
  });
});
