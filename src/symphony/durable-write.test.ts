/**
 * Tests for Durable Writes & Dead-Letter Queue
 * Issue #2212 — Structured Logging & Trace Correlation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  durableWrite,
  DEFAULT_MAX_RETRIES,
  symphonyDurableWriteRetries,
  symphonyDeadLetterCount,
  type DurableWriteResult,
} from './durable-write.ts';

/** Create a mock pool that captures query calls. */
function createMockPool(queryFn?: (...args: unknown[]) => unknown) {
  return {
    query: vi.fn(queryFn ?? (async () => ({ rows: [{ id: 'dlq-1' }], rowCount: 1 }))),
  } as unknown as import('pg').Pool;
}

describe('durable-write', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('durableWrite', () => {
    it('succeeds on first attempt', async () => {
      const pool = createMockPool();
      const writeFn = vi.fn(async () => {});

      const result = await durableWrite(pool, writeFn, { data: 'test' }, {
        source: 'test',
        namespace: 'ns-1',
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.deadLettered).toBe(false);
      expect(writeFn).toHaveBeenCalledOnce();
    });

    it('retries on failure and succeeds', async () => {
      const pool = createMockPool();
      let callCount = 0;
      const writeFn = vi.fn(async () => {
        callCount++;
        if (callCount < 3) throw new Error('transient error');
      });

      const result = await durableWrite(pool, writeFn, { data: 'test' }, {
        source: 'test',
        namespace: 'ns-1',
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
      expect(writeFn).toHaveBeenCalledTimes(3);
    });

    it('dead-letters after max retries exhausted', async () => {
      const pool = createMockPool();
      const writeFn = vi.fn(async () => {
        throw new Error('permanent error');
      });

      const result = await durableWrite(pool, writeFn, { data: 'test' }, {
        source: 'run_event',
        namespace: 'ns-1',
        maxRetries: 2,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(2);
      expect(result.deadLettered).toBe(true);
      expect(result.error).toBe('permanent error');
      // Should have called pool.query to insert into DLQ
      expect(pool.query).toHaveBeenCalled();
    });

    it('reports error when both write and DLQ fail', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const pool = createMockPool(async () => {
        throw new Error('DLQ write failed');
      });
      const writeFn = vi.fn(async () => {
        throw new Error('original write error');
      });

      const result = await durableWrite(pool, writeFn, { data: 'test' }, {
        source: 'activity',
        namespace: 'ns-1',
        maxRetries: 1,
      });

      expect(result.success).toBe(false);
      expect(result.deadLettered).toBe(false);
      expect(result.error).toContain('Write and DLQ both failed');
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('[Symphony:DLQ] CRITICAL');

      errorSpy.mockRestore();
    });

    it('uses default max retries when not specified', async () => {
      const pool = createMockPool();
      const writeFn = vi.fn(async () => {
        throw new Error('fail');
      });

      const result = await durableWrite(pool, writeFn, { data: 'test' }, {
        source: 'test',
        namespace: 'ns-1',
      });

      expect(result.attempts).toBe(DEFAULT_MAX_RETRIES);
      expect(writeFn).toHaveBeenCalledTimes(DEFAULT_MAX_RETRIES);
    });
  });
});
