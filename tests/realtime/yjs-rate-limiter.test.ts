/**
 * Tests for YjsRateLimiter.
 * Part of Issue #2256
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YjsRateLimiter } from '../../src/api/realtime/yjs-rate-limiter.ts';

describe('YjsRateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows messages under the limit', () => {
    const limiter = new YjsRateLimiter(5);
    for (let i = 0; i < 5; i++) {
      expect(limiter.allow('client-1', 'note-1')).toBe(true);
    }
  });

  it('rejects messages over the limit', () => {
    const limiter = new YjsRateLimiter(3);
    for (let i = 0; i < 3; i++) limiter.allow('client-1', 'note-1');
    expect(limiter.allow('client-1', 'note-1')).toBe(false);
  });

  it('resets after 1 second', () => {
    const limiter = new YjsRateLimiter(2);
    limiter.allow('client-1', 'note-1');
    limiter.allow('client-1', 'note-1');
    expect(limiter.allow('client-1', 'note-1')).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(limiter.allow('client-1', 'note-1')).toBe(true);
  });

  it('tracks different clients independently', () => {
    const limiter = new YjsRateLimiter(1);
    expect(limiter.allow('client-1', 'note-1')).toBe(true);
    expect(limiter.allow('client-2', 'note-1')).toBe(true);
    expect(limiter.allow('client-1', 'note-1')).toBe(false);
  });

  it('tracks different notes independently', () => {
    const limiter = new YjsRateLimiter(1);
    expect(limiter.allow('client-1', 'note-1')).toBe(true);
    expect(limiter.allow('client-1', 'note-2')).toBe(true);
    expect(limiter.allow('client-1', 'note-1')).toBe(false);
    expect(limiter.allow('client-1', 'note-2')).toBe(false);
  });

  it('cleans up stale entries', () => {
    const limiter = new YjsRateLimiter(10);
    limiter.allow('client-1', 'note-1');
    vi.advanceTimersByTime(5001);
    limiter.cleanupStale();
    expect(limiter.size()).toBe(0);
  });

  it('does not clean up recent entries', () => {
    const limiter = new YjsRateLimiter(10);
    limiter.allow('client-1', 'note-1');
    vi.advanceTimersByTime(500);
    limiter.cleanupStale();
    expect(limiter.size()).toBe(1);
  });

  it('allowGlobal tracks per-connection limit', () => {
    const limiter = new YjsRateLimiter(100, 3);
    expect(limiter.allowGlobal('client-1')).toBe(true);
    expect(limiter.allowGlobal('client-1')).toBe(true);
    expect(limiter.allowGlobal('client-1')).toBe(true);
    expect(limiter.allowGlobal('client-1')).toBe(false);
  });

  it('allowGlobal resets after 1 second', () => {
    const limiter = new YjsRateLimiter(100, 2);
    limiter.allowGlobal('client-1');
    limiter.allowGlobal('client-1');
    expect(limiter.allowGlobal('client-1')).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(limiter.allowGlobal('client-1')).toBe(true);
  });

  it('cleanup(clientId) removes per-client entries', () => {
    const limiter = new YjsRateLimiter(10);
    limiter.allow('client-1', 'note-1');
    limiter.allow('client-1', 'note-2');
    limiter.allow('client-2', 'note-1');
    limiter.allowGlobal('client-1');
    limiter.allowGlobal('client-2');

    expect(limiter.size()).toBe(3);

    limiter.cleanup('client-1');

    // Only client-2's per-room bucket should remain
    expect(limiter.size()).toBe(1);
  });
});
