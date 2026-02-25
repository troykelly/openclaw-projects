/**
 * Unit tests for session recovery.
 *
 * Issue #1682 — Session recovery after worker restart.
 * Epic #1667 — TMux Session Management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recoverSessions, gracefulShutdown } from './session-recovery.ts';
import type { EntryRecorder } from './entry-recorder.ts';

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

// Mock execFileSync to simulate tmux has-session checks
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    // Simulate tmux has-session behavior based on session name
    if (cmd === 'tmux' && args[0] === 'has-session') {
      const sessionName = args[2]; // -t <name>
      if (sessionName === 'existing-session') {
        return; // success — session exists
      }
      throw new Error('session not found'); // session doesn't exist
    }
    throw new Error(`unexpected command: ${cmd}`);
  }),
}));

describe('recoverSessions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recovers local sessions that still exist', async () => {
    const mockPool = createMockPool([
      // Query for sessions
      {
        rows: [{
          id: 'sess-1',
          connection_id: 'conn-1',
          tmux_session_name: 'existing-session',
          status: 'active',
          is_local: true,
          host: null,
        }],
      },
      // UPDATE query result
      { rows: [] },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
    const results = await recoverSessions(mockPool as any, { workerId: 'worker-1' });

    expect(results).toHaveLength(1);
    expect(results[0].newStatus).toBe('active');
    expect(results[0].isLocal).toBe(true);

    // Verify the UPDATE query
    const updateQuery = mockPool.queries[1];
    expect(updateQuery.text).toContain("status = 'active'");
  });

  it('marks local sessions as terminated when tmux session is gone', async () => {
    const mockPool = createMockPool([
      // Query for sessions
      {
        rows: [{
          id: 'sess-2',
          connection_id: 'conn-1',
          tmux_session_name: 'gone-session',
          status: 'active',
          is_local: true,
          host: null,
        }],
      },
      // UPDATE query result
      { rows: [] },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
    const results = await recoverSessions(mockPool as any, { workerId: 'worker-1' });

    expect(results).toHaveLength(1);
    expect(results[0].newStatus).toBe('terminated');

    const updateQuery = mockPool.queries[1];
    expect(updateQuery.text).toContain("status = 'terminated'");
    expect(updateQuery.text).toContain('terminated_at');
  });

  it('marks SSH sessions as disconnected', async () => {
    const mockPool = createMockPool([
      // Query for sessions
      {
        rows: [{
          id: 'sess-3',
          connection_id: 'conn-2',
          tmux_session_name: 'remote-sess',
          status: 'active',
          is_local: false,
          host: 'remote.example.com',
        }],
      },
      // UPDATE query result
      { rows: [] },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
    const results = await recoverSessions(mockPool as any, { workerId: 'worker-1' });

    expect(results).toHaveLength(1);
    expect(results[0].newStatus).toBe('disconnected');
    expect(results[0].isLocal).toBe(false);
    expect(results[0].error).toContain('SSH reconnection not yet implemented');
  });

  it('handles multiple sessions', async () => {
    const mockPool = createMockPool([
      // Query for sessions
      {
        rows: [
          {
            id: 'sess-1',
            connection_id: 'conn-1',
            tmux_session_name: 'existing-session',
            status: 'active',
            is_local: true,
            host: null,
          },
          {
            id: 'sess-2',
            connection_id: 'conn-1',
            tmux_session_name: 'gone-session',
            status: 'idle',
            is_local: true,
            host: null,
          },
          {
            id: 'sess-3',
            connection_id: 'conn-2',
            tmux_session_name: 'remote',
            status: 'disconnected',
            is_local: false,
            host: 'remote.example.com',
          },
        ],
      },
      { rows: [] }, // UPDATE for sess-1
      { rows: [] }, // UPDATE for sess-2
      { rows: [] }, // UPDATE for sess-3
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
    const results = await recoverSessions(mockPool as any, { workerId: 'worker-1' });

    expect(results).toHaveLength(3);
    expect(results[0].newStatus).toBe('active');
    expect(results[1].newStatus).toBe('terminated');
    expect(results[2].newStatus).toBe('disconnected');
  });

  it('returns empty when no sessions need recovery', async () => {
    const mockPool = createMockPool([{ rows: [] }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
    const results = await recoverSessions(mockPool as any, { workerId: 'worker-1' });

    expect(results).toHaveLength(0);
  });
});

describe('gracefulShutdown', () => {
  it('flushes entry recorder and marks sessions disconnected', async () => {
    const mockPool = createMockPool([{ rows: [] }]);
    const mockRecorder = {
      stop: vi.fn(),
      flush: vi.fn(async () => 5),
    } as unknown as EntryRecorder;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
    await gracefulShutdown(mockPool as any, 'worker-1', mockRecorder);

    expect(mockRecorder.stop).toHaveBeenCalled();
    expect(mockRecorder.flush).toHaveBeenCalled();

    const updateQuery = mockPool.queries[0];
    expect(updateQuery.text).toContain("status = 'disconnected'");
    expect(updateQuery.values).toContain('worker-1');
  });

  it('works without entry recorder', async () => {
    const mockPool = createMockPool([{ rows: [] }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock pool
    await gracefulShutdown(mockPool as any, 'worker-1');

    // Should still update sessions
    expect(mockPool.queries).toHaveLength(1);
  });
});
