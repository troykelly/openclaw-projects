/**
 * Unit tests for window and pane management handlers.
 * Issue #1851 — Window and pane RPCs.
 *
 * Tests handler logic in isolation using a mock pool and tmux manager.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleCreateWindow,
  handleCloseWindow,
  handleSplitPane,
  handleClosePane,
} from './window-pane-handlers.ts';

// Mock pool with query tracking
function createMockPool() {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const mockResults = new Map<string, { rows: unknown[]; rowCount: number }>();

  const pool = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      queries.push({ text, params });
      // Check for matching mock result
      for (const [pattern, result] of mockResults) {
        if (text.includes(pattern)) {
          return result;
        }
      }
      return { rows: [], rowCount: 0 };
    }),
    __queries: queries,
    __setResult: (pattern: string, result: { rows: unknown[]; rowCount: number }) => {
      mockResults.set(pattern, result);
    },
  };

  return pool;
}

// Mock tmux manager
function createMockTmuxManager() {
  return {
    createWindow: vi.fn(),
    closeWindow: vi.fn(),
    splitPane: vi.fn(),
    closePane: vi.fn(),
    listWindows: vi.fn().mockResolvedValue([
      { index: 0, name: 'default', active: false },
      { index: 1, name: 'new', active: true },
    ]),
    listPanes: vi.fn().mockResolvedValue([
      { index: 0, active: true, pid: 12345, currentCommand: 'bash' },
    ]),
  };
}

describe('window-pane-handlers', () => {
  let pool: ReturnType<typeof createMockPool>;
  let tmux: ReturnType<typeof createMockTmuxManager>;

  beforeEach(() => {
    pool = createMockPool();
    tmux = createMockTmuxManager();
  });

  describe('handleCreateWindow', () => {
    it('creates a window and returns WindowInfo', async () => {
      pool.__setResult('SELECT id, namespace, tmux_session_name, status', {
        rows: [{ id: 'sess-1', namespace: 'default', tmux_session_name: 'my-session', status: 'active' }],
        rowCount: 1,
      });

      const result = await handleCreateWindow(
        { session_id: 'sess-1', window_name: 'my-window' },
        pool as never,
        tmux as never,
      );

      expect(result.session_id).toBe('sess-1');
      expect(result.window_index).toBe(1);
      expect(result.window_name).toBe('my-window');
      expect(result.is_active).toBe(true);
      expect(result.panes).toHaveLength(1);
      expect(result.panes[0].is_active).toBe(true);

      expect(tmux.createWindow).toHaveBeenCalledWith('my-session', 'my-window');
      expect(tmux.listWindows).toHaveBeenCalledWith('my-session');
    });

    it('throws if session not found', async () => {
      await expect(
        handleCreateWindow(
          { session_id: 'nonexistent', window_name: 'test' },
          pool as never,
          tmux as never,
        ),
      ).rejects.toThrow('Session not found');
    });

    it('throws if session is terminated', async () => {
      pool.__setResult('SELECT id, namespace, tmux_session_name, status', {
        rows: [{ id: 'sess-1', namespace: 'default', tmux_session_name: 'my-session', status: 'terminated' }],
        rowCount: 1,
      });

      await expect(
        handleCreateWindow(
          { session_id: 'sess-1', window_name: 'test' },
          pool as never,
          tmux as never,
        ),
      ).rejects.toThrow('not active');
    });
  });

  describe('handleCloseWindow', () => {
    it('closes a window and deletes DB records', async () => {
      pool.__setResult('SELECT id, namespace, tmux_session_name, status', {
        rows: [{ id: 'sess-1', namespace: 'default', tmux_session_name: 'my-session', status: 'active' }],
        rowCount: 1,
      });
      pool.__setResult('SELECT id FROM terminal_session_window', {
        rows: [{ id: 'win-1' }],
        rowCount: 1,
      });

      await handleCloseWindow(
        { session_id: 'sess-1', window_index: 1 },
        pool as never,
        tmux as never,
      );

      expect(tmux.closeWindow).toHaveBeenCalledWith('my-session', 1);
    });

    it('throws if session not found', async () => {
      await expect(
        handleCloseWindow(
          { session_id: 'nonexistent', window_index: 0 },
          pool as never,
          tmux as never,
        ),
      ).rejects.toThrow('Session not found');
    });
  });

  describe('handleSplitPane', () => {
    it('splits a pane and returns PaneInfo', async () => {
      pool.__setResult('SELECT id, namespace, tmux_session_name, status', {
        rows: [{ id: 'sess-1', namespace: 'default', tmux_session_name: 'my-session', status: 'active' }],
        rowCount: 1,
      });
      pool.__setResult('SELECT id, namespace FROM terminal_session_window', {
        rows: [{ id: 'win-1', namespace: 'default' }],
        rowCount: 1,
      });

      tmux.listPanes.mockResolvedValue([
        { index: 0, active: false, pid: 100, currentCommand: 'bash' },
        { index: 1, active: true, pid: 200, currentCommand: 'bash' },
      ]);

      const result = await handleSplitPane(
        { session_id: 'sess-1', window_index: 0, horizontal: true },
        pool as never,
        tmux as never,
      );

      expect(result.pane_index).toBe(1);
      expect(result.is_active).toBe(true);
      expect(result.pid).toBe(200);
      expect(result.window_id).toBe('win-1');

      expect(tmux.splitPane).toHaveBeenCalledWith('my-session', 0, true);
    });

    it('throws if window not found', async () => {
      pool.__setResult('SELECT id, namespace, tmux_session_name, status', {
        rows: [{ id: 'sess-1', namespace: 'default', tmux_session_name: 'my-session', status: 'active' }],
        rowCount: 1,
      });

      await expect(
        handleSplitPane(
          { session_id: 'sess-1', window_index: 99, horizontal: false },
          pool as never,
          tmux as never,
        ),
      ).rejects.toThrow('Window not found');
    });
  });

  describe('handleClosePane', () => {
    it('closes a pane and deletes DB record', async () => {
      pool.__setResult('SELECT id, namespace, tmux_session_name, status', {
        rows: [{ id: 'sess-1', namespace: 'default', tmux_session_name: 'my-session', status: 'active' }],
        rowCount: 1,
      });
      pool.__setResult('SELECT id FROM terminal_session_window', {
        rows: [{ id: 'win-1' }],
        rowCount: 1,
      });

      await handleClosePane(
        { session_id: 'sess-1', window_index: 0, pane_index: 1 },
        pool as never,
        tmux as never,
      );

      expect(tmux.closePane).toHaveBeenCalledWith('my-session', 0, 1);
    });
  });
});
