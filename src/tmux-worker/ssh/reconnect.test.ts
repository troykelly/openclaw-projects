/**
 * Unit tests for SSH session reconnect logic.
 *
 * Issue #2187 — SSH Session Recovery for Remote Orchestration.
 * Epic #2186 — Symphony Orchestration.
 *
 * TDD: Tests written FIRST, before implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SSHReconnectManager,
  type SSHReconnectConfig,
  type SSHReconnectResult,
  DEFAULT_RECONNECT_CONFIG,
} from './reconnect.ts';

/** Create a mock SSHConnectionManager-like object. */
function createMockSSHManager() {
  return {
    getConnection: vi.fn(),
    disconnect: vi.fn(),
  };
}

/** Create a mock pool with configurable query responses. */
function createMockPool(responses: Array<{ rows: unknown[] }> = []) {
  let callIndex = 0;
  const queries: Array<{ text: string; values: unknown[] }> = [];
  return {
    queries,
    query: vi.fn(async (text: string, values?: unknown[]) => {
      queries.push({ text, values: values ?? [] });
      const response = responses[callIndex] ?? { rows: [] };
      callIndex++;
      return response;
    }),
  };
}

describe('SSHReconnectManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ================================================================
  // Backoff timing
  // ================================================================

  describe('exponential backoff', () => {
    it('starts at INITIAL_BACKOFF_MS (1s) for the first retry', () => {
      const manager = new SSHReconnectManager();
      const delay = manager.calculateBackoff(0);
      // First retry: 1000ms base +/- 500ms jitter
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(1500);
    });

    it('doubles backoff for each subsequent retry', () => {
      const manager = new SSHReconnectManager();
      const delay0 = manager.calculateBackoff(0);
      const delay1 = manager.calculateBackoff(1);
      const delay2 = manager.calculateBackoff(2);

      // Base delays: 1000, 2000, 4000 (before jitter)
      // With jitter, delay1 should be roughly 2x delay0
      expect(delay1).toBeGreaterThanOrEqual(1500);
      expect(delay2).toBeGreaterThanOrEqual(3000);
    });

    it('caps backoff at MAX_BACKOFF_MS (30s)', () => {
      const manager = new SSHReconnectManager();
      // Attempt 10: 2^10 * 1000 = 1024000 > 30000, should cap
      const delay = manager.calculateBackoff(10);
      expect(delay).toBeLessThanOrEqual(30000 + 500); // max + jitter
    });
  });

  // ================================================================
  // Retry counting and state transitions
  // ================================================================

  describe('retry counting', () => {
    it('limits retries to maxRetries (default 3)', async () => {
      const mockSSH = createMockSSHManager();
      mockSSH.getConnection.mockRejectedValue(new Error('Connection refused'));

      const mockPool = createMockPool([
        // Connection row for reconnect
        { rows: [{ id: 'conn-1', host: 'remote.example.com', port: 22, is_local: false }] },
      ]);

      const manager = new SSHReconnectManager({
        maxRetries: 3,
        initialBackoffMs: 10, // fast for tests
        maxBackoffMs: 100,
      });

      const result = await manager.attemptReconnect({
        sessionId: 'sess-1',
        connectionId: 'conn-1',
        tmuxSessionName: 'remote-sess',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pool: mockPool as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sshManager: mockSSH as any,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.finalStatus).toBe('terminated');
      expect(result.error).toContain('could not be re-established');
    });

    it('succeeds on first attempt when SSH connects', async () => {
      const mockSSH = createMockSSHManager();
      mockSSH.getConnection.mockResolvedValue({
        isLocal: false,
        client: { exec: vi.fn() },
        connectionId: 'conn-1',
      });

      const mockPool = createMockPool([
        // tmux has-session check result
        { rows: [] },
        // UPDATE session status
        { rows: [] },
        // INSERT terminal_activity log
        { rows: [] },
      ]);

      const manager = new SSHReconnectManager({
        maxRetries: 3,
        initialBackoffMs: 10,
        maxBackoffMs: 100,
        checkTmuxSession: async () => true, // tmux session exists
      });

      const result = await manager.attemptReconnect({
        sessionId: 'sess-1',
        connectionId: 'conn-1',
        tmuxSessionName: 'remote-sess',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pool: mockPool as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sshManager: mockSSH as any,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.finalStatus).toBe('active');
    });

    it('succeeds on second attempt after first failure', async () => {
      const mockSSH = createMockSSHManager();
      let callCount = 0;
      mockSSH.getConnection.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Connection refused');
        }
        return {
          isLocal: false,
          client: { exec: vi.fn() },
          connectionId: 'conn-1',
        };
      });

      const mockPool = createMockPool([
        // tmux check
        { rows: [] },
        // UPDATE session
        { rows: [] },
        // INSERT activity log for attempt 1
        { rows: [] },
        // INSERT activity log for attempt 2
        { rows: [] },
      ]);

      const manager = new SSHReconnectManager({
        maxRetries: 3,
        initialBackoffMs: 10,
        maxBackoffMs: 100,
        checkTmuxSession: async () => true,
      });

      const result = await manager.attemptReconnect({
        sessionId: 'sess-1',
        connectionId: 'conn-1',
        tmuxSessionName: 'remote-sess',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pool: mockPool as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sshManager: mockSSH as any,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });
  });

  // ================================================================
  // Host reboot detection
  // ================================================================

  describe('host reboot detection', () => {
    it('marks session terminated when tmux session is gone after SSH reconnect', async () => {
      const mockSSH = createMockSSHManager();
      mockSSH.getConnection.mockResolvedValue({
        isLocal: false,
        client: { exec: vi.fn() },
        connectionId: 'conn-1',
      });

      const mockPool = createMockPool([
        // UPDATE session status
        { rows: [] },
        // INSERT terminal_activity
        { rows: [] },
      ]);

      const manager = new SSHReconnectManager({
        maxRetries: 3,
        initialBackoffMs: 10,
        maxBackoffMs: 100,
        checkTmuxSession: async () => false, // tmux session gone = host rebooted
      });

      const result = await manager.attemptReconnect({
        sessionId: 'sess-1',
        connectionId: 'conn-1',
        tmuxSessionName: 'remote-sess',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pool: mockPool as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sshManager: mockSSH as any,
      });

      expect(result.success).toBe(false);
      expect(result.finalStatus).toBe('terminated');
      expect(result.error).toContain('tmux session no longer exists');
    });

    it('does not retry when host reboot is detected (tmux gone)', async () => {
      const mockSSH = createMockSSHManager();
      mockSSH.getConnection.mockResolvedValue({
        isLocal: false,
        client: { exec: vi.fn() },
        connectionId: 'conn-1',
      });

      const mockPool = createMockPool([
        { rows: [] },
        { rows: [] },
      ]);

      const manager = new SSHReconnectManager({
        maxRetries: 3,
        initialBackoffMs: 10,
        maxBackoffMs: 100,
        checkTmuxSession: async () => false,
      });

      const result = await manager.attemptReconnect({
        sessionId: 'sess-1',
        connectionId: 'conn-1',
        tmuxSessionName: 'remote-sess',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pool: mockPool as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sshManager: mockSSH as any,
      });

      // Should stop after 1 attempt (SSH connected, tmux gone = no retry)
      expect(result.attempts).toBe(1);
      expect(result.success).toBe(false);
    });
  });

  // ================================================================
  // Activity logging
  // ================================================================

  describe('activity logging', () => {
    it('logs each reconnect attempt in terminal_activity', async () => {
      const mockSSH = createMockSSHManager();
      mockSSH.getConnection.mockRejectedValue(new Error('Connection refused'));

      const mockPool = createMockPool([
        // Activity log for attempt 1
        { rows: [] },
        // Activity log for attempt 2
        { rows: [] },
        // Activity log for attempt 3
        { rows: [] },
        // Final status update
        { rows: [] },
      ]);

      const manager = new SSHReconnectManager({
        maxRetries: 3,
        initialBackoffMs: 10,
        maxBackoffMs: 100,
      });

      await manager.attemptReconnect({
        sessionId: 'sess-1',
        connectionId: 'conn-1',
        tmuxSessionName: 'remote-sess',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pool: mockPool as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sshManager: mockSSH as any,
      });

      // Check that activity log entries were inserted
      const activityInserts = mockPool.queries.filter(
        (q) => q.text.includes('terminal_activity'),
      );
      expect(activityInserts.length).toBeGreaterThanOrEqual(1);
    });

    it('logs success in terminal_activity when reconnect succeeds', async () => {
      const mockSSH = createMockSSHManager();
      mockSSH.getConnection.mockResolvedValue({
        isLocal: false,
        client: { exec: vi.fn() },
        connectionId: 'conn-1',
      });

      const mockPool = createMockPool([
        // Activity log
        { rows: [] },
        // UPDATE session
        { rows: [] },
      ]);

      const manager = new SSHReconnectManager({
        maxRetries: 3,
        initialBackoffMs: 10,
        maxBackoffMs: 100,
        checkTmuxSession: async () => true,
      });

      await manager.attemptReconnect({
        sessionId: 'sess-1',
        connectionId: 'conn-1',
        tmuxSessionName: 'remote-sess',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pool: mockPool as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sshManager: mockSSH as any,
      });

      // Check for a success log entry
      const activityInserts = mockPool.queries.filter(
        (q) => q.text.includes('terminal_activity'),
      );
      expect(activityInserts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ================================================================
  // Credential re-resolution (security)
  // ================================================================

  describe('credential re-resolution', () => {
    it('forces credential re-resolution by disconnecting before reconnect', async () => {
      const mockSSH = createMockSSHManager();
      mockSSH.disconnect.mockResolvedValue(undefined);
      mockSSH.getConnection.mockResolvedValue({
        isLocal: false,
        client: { exec: vi.fn() },
        connectionId: 'conn-1',
      });

      const mockPool = createMockPool([
        { rows: [] },
        { rows: [] },
      ]);

      const manager = new SSHReconnectManager({
        maxRetries: 3,
        initialBackoffMs: 10,
        maxBackoffMs: 100,
        checkTmuxSession: async () => true,
      });

      await manager.attemptReconnect({
        sessionId: 'sess-1',
        connectionId: 'conn-1',
        tmuxSessionName: 'remote-sess',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pool: mockPool as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sshManager: mockSSH as any,
      });

      // disconnect should be called first to force credential re-resolution
      expect(mockSSH.disconnect).toHaveBeenCalledWith('conn-1');
    });
  });

  // ================================================================
  // Default config
  // ================================================================

  describe('default config', () => {
    it('has correct default values', () => {
      expect(DEFAULT_RECONNECT_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_RECONNECT_CONFIG.initialBackoffMs).toBe(1000);
      expect(DEFAULT_RECONNECT_CONFIG.maxBackoffMs).toBe(30000);
    });
  });
});
