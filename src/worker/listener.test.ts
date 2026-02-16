/**
 * Tests for NotifyListener reconnect behavior.
 * Part of Issue #1373.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted so the mock factory can reference these
const mockState = vi.hoisted(() => ({
  shouldFail: true,
  attempts: 0,
}));

vi.mock('pg', async () => {
  const { EventEmitter } = await import('events');

  class MockClient extends EventEmitter {
    async connect() {
      mockState.attempts++;
      if (mockState.shouldFail) {
        throw new Error('Connection refused');
      }
    }

    async query(_sql: string) {}
    async end() {}
  }

  return { Client: MockClient };
});

const { NotifyListener } = await import('./listener.ts');

describe('NotifyListener', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockState.attempts = 0;
    mockState.shouldFail = true;
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it('retries reconnect indefinitely after failed attempts', async () => {
    const listener = new NotifyListener({
      connectionConfig: {},
      channels: ['test_channel'],
      onNotification: vi.fn(),
    });

    // Initial start will fail (connect throws, caught internally)
    await listener.start();
    expect(listener.isConnected()).toBe(false);
    expect(mockState.attempts).toBe(1);

    // Advance enough time for multiple reconnect cycles (jitter is 1-5s each)
    await vi.advanceTimersByTimeAsync(30_000);

    // Should have made many attempts, proving reconnect keeps retrying
    expect(mockState.attempts).toBeGreaterThanOrEqual(5);
    expect(listener.isConnected()).toBe(false);

    await listener.stop();
  });

  it('stops retrying after stop() is called', async () => {
    const listener = new NotifyListener({
      connectionConfig: {},
      channels: ['test_channel'],
      onNotification: vi.fn(),
    });

    await listener.start();
    expect(mockState.attempts).toBe(1);

    // Stop before the reconnect timer fires
    await listener.stop();

    const attemptsAtStop = mockState.attempts;
    await vi.advanceTimersByTimeAsync(30_000);
    // Should not have attempted more connects after stop
    expect(mockState.attempts).toBe(attemptsAtStop);
  });

  it('calls onReconnect when reconnect succeeds after failures', async () => {
    const onReconnect = vi.fn();
    const listener = new NotifyListener({
      connectionConfig: {},
      channels: ['test_channel'],
      onNotification: vi.fn(),
      onReconnect,
    });

    await listener.start();
    expect(listener.isConnected()).toBe(false);
    expect(mockState.attempts).toBe(1);

    // Make next connect succeed
    mockState.shouldFail = false;

    // Advance to trigger reconnect — should succeed this time
    await vi.advanceTimersByTimeAsync(6000);
    expect(listener.isConnected()).toBe(true);
    expect(onReconnect).toHaveBeenCalled();

    await listener.stop();
  });

  it('increments reconnect count on each attempt', async () => {
    const listener = new NotifyListener({
      connectionConfig: {},
      channels: ['test_channel'],
      onNotification: vi.fn(),
    });

    await listener.start();
    expect(listener.getReconnectCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(30_000);

    // Should have incremented reconnect count multiple times
    expect(listener.getReconnectCount()).toBeGreaterThanOrEqual(3);

    await listener.stop();
  });
});
