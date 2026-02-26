/**
 * Tests for worker wiring: EntryRecorder instantiation, session recovery, graceful shutdown.
 * Issue #1850 — Wire EntryRecorder, session recovery, and graceful shutdown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntryRecorder } from './entry-recorder.ts';
import { recoverSessions, gracefulShutdown } from './session-recovery.ts';
import type pg from 'pg';

// ── EntryRecorder unit tests ──────────────────────────────────

describe('EntryRecorder', () => {
  function mockPool(): pg.Pool {
    return {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    } as unknown as pg.Pool;
  }

  it('records entries and reports buffer size', () => {
    const recorder = new EntryRecorder(mockPool());
    const accepted = recorder.record({
      session_id: 'sess-1',
      pane_id: null,
      namespace: 'ns',
      kind: 'command',
      content: 'ls -la',
      metadata: null,
    });

    expect(accepted).toBe(true);
    expect(recorder.bufferSize).toBe(1);
  });

  it('flushes buffered entries to the database', async () => {
    const pool = mockPool();
    const recorder = new EntryRecorder(pool);
    recorder.record({
      session_id: 'sess-1',
      pane_id: null,
      namespace: 'ns',
      kind: 'command',
      content: 'ls',
      metadata: null,
    });
    recorder.record({
      session_id: 'sess-1',
      pane_id: null,
      namespace: 'ns',
      kind: 'output',
      content: 'file.txt',
      metadata: null,
    });

    const count = await recorder.flush();
    expect(count).toBe(2);
    expect(pool.query).toHaveBeenCalledOnce();
    expect(recorder.bufferSize).toBe(0);
  });

  it('returns 0 when flushing empty buffer', async () => {
    const recorder = new EntryRecorder(mockPool());
    const count = await recorder.flush();
    expect(count).toBe(0);
  });

  it('start() and stop() manage the timer', () => {
    const recorder = new EntryRecorder(mockPool(), { flushIntervalMs: 60_000 });
    recorder.start();
    // Calling start again should be a no-op
    recorder.start();
    recorder.stop();
    // Calling stop again should be safe
    recorder.stop();
  });

  it('throttles high-volume output entries', () => {
    const recorder = new EntryRecorder(mockPool(), {
      throttleBytesPerSec: 100,
      throttleSustainedMs: 1000,
    });

    // Within threshold (100 bytes/sec * 1 sec window = 100 bytes)
    const entry1 = recorder.record({
      session_id: 'sess-1',
      pane_id: null,
      namespace: 'ns',
      kind: 'output',
      content: 'x'.repeat(50),
      metadata: null,
    });
    expect(entry1).toBe(true);

    // Exceed threshold
    const entry2 = recorder.record({
      session_id: 'sess-1',
      pane_id: null,
      namespace: 'ns',
      kind: 'output',
      content: 'x'.repeat(200),
      metadata: null,
    });
    expect(entry2).toBe(false);
  });

  it('does not throttle command entries', () => {
    const recorder = new EntryRecorder(mockPool(), {
      throttleBytesPerSec: 10,
      throttleSustainedMs: 1000,
    });

    // Command entries should not be throttled regardless of size
    const accepted = recorder.record({
      session_id: 'sess-1',
      pane_id: null,
      namespace: 'ns',
      kind: 'command',
      content: 'x'.repeat(10000),
      metadata: null,
    });
    expect(accepted).toBe(true);
  });

  it('resets throttle state for a session', () => {
    const recorder = new EntryRecorder(mockPool(), {
      throttleBytesPerSec: 10,
      throttleSustainedMs: 1000,
    });

    // Exceed threshold
    recorder.record({
      session_id: 'sess-1',
      pane_id: null,
      namespace: 'ns',
      kind: 'output',
      content: 'x'.repeat(200),
      metadata: null,
    });

    // Reset and try again
    recorder.resetThrottle('sess-1');

    const accepted = recorder.record({
      session_id: 'sess-1',
      pane_id: null,
      namespace: 'ns',
      kind: 'output',
      content: 'small',
      metadata: null,
    });
    expect(accepted).toBe(true);
  });

  it('records throttle summary', () => {
    const recorder = new EntryRecorder(mockPool());
    recorder.recordThrottleSummary('sess-1', 'ns', 1_000_000, 2.5, 'first...', 'last...');

    expect(recorder.bufferSize).toBe(1);
  });
});

// ── gracefulShutdown ──────────────────────────────────────────

describe('gracefulShutdown', () => {
  function mockPool(): pg.Pool {
    return {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    } as unknown as pg.Pool;
  }

  it('flushes entry recorder and marks sessions disconnected', async () => {
    const pool = mockPool();
    const recorder = new EntryRecorder(pool);
    recorder.start();
    recorder.record({
      session_id: 'sess-1',
      pane_id: null,
      namespace: 'ns',
      kind: 'command',
      content: 'ls',
      metadata: null,
    });

    await gracefulShutdown(pool, 'worker-1', recorder);

    // Should have flushed entries (INSERT) and marked sessions (UPDATE)
    const queryCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(queryCalls.length).toBeGreaterThanOrEqual(2);

    // Last query should be the UPDATE for marking sessions disconnected
    const lastQuery = queryCalls[queryCalls.length - 1][0] as string;
    expect(lastQuery).toContain('disconnected');
    expect(lastQuery).toContain('UPDATE terminal_session');
  });

  it('works without entry recorder', async () => {
    const pool = mockPool();
    await gracefulShutdown(pool, 'worker-1');

    const queryCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(queryCalls.length).toBe(1);
    expect((queryCalls[0][0] as string)).toContain('UPDATE terminal_session');
  });
});

// ── recoverSessions ──────────────────────────────────────────

describe('recoverSessions', () => {
  it('returns empty array when no sessions need recovery', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }),
    } as unknown as pg.Pool;

    const results = await recoverSessions(pool, { workerId: 'worker-1' });
    expect(results).toEqual([]);
  });
});
