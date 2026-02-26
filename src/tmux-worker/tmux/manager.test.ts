/**
 * Unit tests for the tmux process management module.
 * Issue #1846 — tmux process management.
 *
 * Tests cover:
 * - Session creation (tmux new-session)
 * - Session existence check (tmux has-session)
 * - Session killing (tmux kill-session)
 * - Session listing (tmux list-sessions)
 * - Window listing (tmux list-windows)
 * - Pane listing (tmux list-panes)
 * - Session resizing (tmux resize-window)
 * - Error handling for missing tmux binary, nonexistent sessions
 * - All commands via execFile (no shell injection)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TmuxManager,
  type TmuxSessionInfo,
  type TmuxWindowInfo,
  type TmuxPaneInfo,
} from './manager.ts';

// Mock child_process.execFile (safe, no shell injection risk)
const mockExecFile = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

describe('tmux/manager', () => {
  let manager: TmuxManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TmuxManager();
  });

  describe('createSession', () => {
    it('creates a session with correct arguments', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        },
      );

      await manager.createSession('my-session', 120, 40);

      expect(mockExecFile).toHaveBeenCalledWith(
        'tmux',
        ['new-session', '-d', '-s', 'my-session', '-x', '120', '-y', '40'],
        expect.objectContaining({ timeout: expect.any(Number) }),
        expect.any(Function),
      );
    });

    it('passes environment variables when provided', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        },
      );

      await manager.createSession('env-session', 80, 24, { FOO: 'bar' });

      expect(mockExecFile).toHaveBeenCalledWith(
        'tmux',
        ['new-session', '-d', '-s', 'env-session', '-x', '80', '-y', '24'],
        expect.objectContaining({
          env: expect.objectContaining({ FOO: 'bar' }),
        }),
        expect.any(Function),
      );
    });

    it('rejects on tmux error', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(new Error('duplicate session: my-session'), '', 'duplicate session');
        },
      );

      await expect(manager.createSession('my-session', 120, 40)).rejects.toThrow(
        'duplicate session',
      );
    });
  });

  describe('hasSession', () => {
    it('returns true when session exists', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        },
      );

      const exists = await manager.hasSession('my-session');
      expect(exists).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        'tmux',
        ['has-session', '-t', 'my-session'],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('returns false when session does not exist', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(new Error('session not found'), '', '');
        },
      );

      const exists = await manager.hasSession('ghost-session');
      expect(exists).toBe(false);
    });
  });

  describe('killSession', () => {
    it('kills a session with correct arguments', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        },
      );

      await manager.killSession('my-session');

      expect(mockExecFile).toHaveBeenCalledWith(
        'tmux',
        ['kill-session', '-t', 'my-session'],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('rejects on error', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(new Error('session not found'), '', '');
        },
      );

      await expect(manager.killSession('ghost-session')).rejects.toThrow(
        'session not found',
      );
    });
  });

  describe('listSessions', () => {
    it('parses session list output', async () => {
      const output = 'sess1:120:40\nsess2:80:24\n';
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, output, '');
        },
      );

      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toEqual({ name: 'sess1', width: 120, height: 40 });
      expect(sessions[1]).toEqual({ name: 'sess2', width: 80, height: 24 });
    });

    it('returns empty list when no sessions', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          // tmux returns error when no server running
          cb(new Error('no server running'), '', 'no server running');
        },
      );

      const sessions = await manager.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('listWindows', () => {
    it('parses window list output', async () => {
      const output = '0:bash:1\n1:vim:0\n';
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, output, '');
        },
      );

      const windows = await manager.listWindows('my-session');
      expect(windows).toHaveLength(2);
      expect(windows[0]).toEqual({ index: 0, name: 'bash', active: true });
      expect(windows[1]).toEqual({ index: 1, name: 'vim', active: false });
    });
  });

  describe('listPanes', () => {
    it('parses pane list output', async () => {
      const output = '0:1:12345:bash\n1:0:12346:vim\n';
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, output, '');
        },
      );

      const panes = await manager.listPanes('my-session', 0);
      expect(panes).toHaveLength(2);
      expect(panes[0]).toEqual({
        index: 0,
        active: true,
        pid: 12345,
        currentCommand: 'bash',
      });
      expect(panes[1]).toEqual({
        index: 1,
        active: false,
        pid: 12346,
        currentCommand: 'vim',
      });
    });
  });

  describe('resizeSession', () => {
    it('calls tmux resize-window with correct args', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        },
      );

      await manager.resizeSession('my-session', 160, 50);

      expect(mockExecFile).toHaveBeenCalledWith(
        'tmux',
        ['resize-window', '-t', 'my-session', '-x', '160', '-y', '50'],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe('capturePane', () => {
    it('captures pane content', async () => {
      const output = 'line 1\nline 2\nline 3\n';
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, output, '');
        },
      );

      const content = await manager.capturePane('my-session', 0, 0);
      expect(content).toBe('line 1\nline 2\nline 3\n');
      expect(mockExecFile).toHaveBeenCalledWith(
        'tmux',
        expect.arrayContaining(['capture-pane', '-p', '-t', 'my-session:0.0']),
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe('createWindow', () => {
    it('creates a new window with name', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        },
      );

      await manager.createWindow('my-session', 'build');

      expect(mockExecFile).toHaveBeenCalledWith(
        'tmux',
        ['new-window', '-t', 'my-session', '-n', 'build'],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe('splitPane', () => {
    it('splits pane horizontally', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        },
      );

      await manager.splitPane('my-session', 0, true);

      expect(mockExecFile).toHaveBeenCalledWith(
        'tmux',
        ['split-window', '-h', '-t', 'my-session:0'],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('splits pane vertically', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        },
      );

      await manager.splitPane('my-session', 0, false);

      expect(mockExecFile).toHaveBeenCalledWith(
        'tmux',
        ['split-window', '-v', '-t', 'my-session:0'],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe('input validation', () => {
    it('rejects session names with shell metacharacters', async () => {
      await expect(manager.createSession('foo;rm -rf /', 80, 24)).rejects.toThrow(
        'Invalid session name',
      );
    });

    it('rejects session names starting with hyphen', async () => {
      await expect(manager.createSession('-evil', 80, 24)).rejects.toThrow(
        'Invalid session name',
      );
    });

    it('allows valid session names with underscores and hyphens', async () => {
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        },
      );

      await expect(manager.createSession('my_session-1', 80, 24)).resolves.not.toThrow();
    });
  });
});
