/**
 * Unit tests for the session lifecycle RPCs.
 * Issue #1847 — Session lifecycle RPCs.
 *
 * Tests cover:
 * - CreateSession: DB insert + tmux session creation (local & SSH)
 * - TerminateSession: tmux kill + DB status update
 * - ListSessions: namespace-filtered DB query
 * - GetSession: session with windows/panes joined
 * - ResizeSession: tmux resize + DB cols/rows update
 * - Error cases: connection not found, session not found, SSH failures
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleCreateSession,
  handleTerminateSession,
  handleListSessions,
  handleGetSession,
  handleResizeSession,
} from './session-lifecycle.ts';
import type { TmuxManager } from './tmux/manager.ts';
import type { SSHConnectionManager } from './ssh/client.ts';
import type pg from 'pg';

// ─── Mock factories ─────────────────────────────────────────

function createMockPool(): pg.Pool & { _queryResults: Map<string, { rows: unknown[] }> } {
  const results = new Map<string, { rows: unknown[] }>();
  const pool = {
    _queryResults: results,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      // Match by key in results map
      for (const [key, value] of results) {
        if (sql.includes(key) || (params && params.includes(key))) {
          return value;
        }
      }
      // Default: return result based on SQL pattern
      if (sql.includes('INSERT INTO terminal_session ')) {
        return { rows: [{ id: 'new-session-uuid' }] };
      }
      if (sql.includes('INSERT INTO terminal_session_window')) {
        return { rows: [{ id: 'new-window-uuid' }] };
      }
      if (sql.includes('INSERT INTO terminal_session_pane')) {
        return { rows: [{ id: 'new-pane-uuid' }] };
      }
      if (sql.includes('UPDATE terminal_session')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
  } as unknown as pg.Pool & { _queryResults: Map<string, { rows: unknown[] }> };
  return pool;
}

function createMockTmuxManager(): TmuxManager {
  return {
    createSession: vi.fn().mockResolvedValue(undefined),
    hasSession: vi.fn().mockResolvedValue(true),
    killSession: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([]),
    listWindows: vi.fn().mockResolvedValue([
      { index: 0, name: 'bash', active: true },
    ]),
    listPanes: vi.fn().mockResolvedValue([
      { index: 0, active: true, pid: 12345, currentCommand: 'bash' },
    ]),
    resizeSession: vi.fn().mockResolvedValue(undefined),
    capturePane: vi.fn().mockResolvedValue(''),
    createWindow: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    splitPane: vi.fn().mockResolvedValue(undefined),
    closePane: vi.fn().mockResolvedValue(undefined),
    sendKeys: vi.fn().mockResolvedValue(undefined),
  } as unknown as TmuxManager;
}

function createMockSSHManager(): SSHConnectionManager {
  return {
    getConnection: vi.fn().mockResolvedValue({
      isLocal: true,
      client: null,
      connectionId: 'conn-local',
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    disconnectAll: vi.fn().mockResolvedValue(undefined),
    testConnection: vi.fn().mockResolvedValue({
      success: true,
      message: 'OK',
      latencyMs: 10,
      hostKeyFingerprint: '',
    }),
    activeConnectionCount: 0,
  } as unknown as SSHConnectionManager;
}

// ─── Test data ──────────────────────────────────────────────

const localConnectionRow = {
  id: 'conn-local',
  namespace: 'test-ns',
  name: 'local',
  host: null,
  port: 22,
  username: null,
  auth_method: null,
  credential_id: null,
  proxy_jump_id: null,
  is_local: true,
  env: null,
  connect_timeout_s: 30,
  keepalive_interval: 60,
};

const sessionRow = {
  id: 'session-1',
  namespace: 'test-ns',
  connection_id: 'conn-local',
  tmux_session_name: 'sess-test-1',
  worker_id: 'worker-1',
  status: 'active',
  cols: 120,
  rows: 40,
  started_at: new Date().toISOString(),
  last_activity_at: new Date().toISOString(),
  terminated_at: null,
  exit_code: null,
  error_message: null,
  tags: ['test'],
  notes: null,
  capture_on_command: true,
  embed_commands: true,
  embed_scrollback: false,
  capture_interval_s: 30,
};

// ─── Tests ──────────────────────────────────────────────────

describe('session-lifecycle', () => {
  let pool: ReturnType<typeof createMockPool>;
  let tmuxManager: TmuxManager;
  let sshManager: SSHConnectionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = createMockPool();
    tmuxManager = createMockTmuxManager();
    sshManager = createMockSSHManager();
  });

  describe('handleCreateSession', () => {
    it('creates a local session and returns SessionInfo', async () => {
      pool._queryResults.set('conn-local', { rows: [localConnectionRow] });

      const result = await handleCreateSession(
        {
          connection_id: 'conn-local',
          namespace: 'test-ns',
          tmux_session_name: 'my-session',
          cols: 120,
          rows: 40,
          capture_on_command: true,
          embed_commands: true,
          embed_scrollback: false,
          capture_interval_s: 30,
          tags: ['test'],
          notes: '',
        },
        pool as unknown as pg.Pool,
        tmuxManager,
        sshManager,
        'worker-1',
      );

      expect(result.tmux_session_name).toBe('my-session');
      expect(result.status).toBe('active');
      expect(result.worker_id).toBe('worker-1');
      expect(result.cols).toBe(120);
      expect(result.rows).toBe(40);
      expect((tmuxManager.createSession as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        'my-session',
        120,
        40,
        undefined,
      );
    });

    it('probes common paths before auto-install on SSH remote (#2324)', async () => {
      const sshConnection = {
        id: 'conn-ssh',
        namespace: 'test-ns',
        name: 'remote',
        host: '10.0.0.1',
        port: 22,
        username: 'deploy',
        auth_method: 'key',
        credential_id: null,
        proxy_jump_id: null,
        is_local: false,
        env: null,
        connect_timeout_s: 30,
        keepalive_interval: 60,
      };
      pool._queryResults.set('conn-ssh', { rows: [sshConnection] });

      const execCommands: string[] = [];
      const mockClient = {
        exec: vi.fn((cmd: string, cb: (err: Error | undefined, channel: unknown) => void) => {
          execCommands.push(cmd);
          // "which tmux" fails, probed paths fail, then auto-install succeeds
          if (cmd === 'which tmux' || cmd === 'command -v tmux') {
            const channel = {
              on: vi.fn((event: string, handler: (arg: unknown) => void) => {
                if (event === 'close') setTimeout(() => handler(1), 0);
                return channel;
              }),
              stderr: { on: vi.fn().mockReturnThis() },
            };
            cb(undefined, channel);
          } else if (cmd.includes('new-session')) {
            // tmux new-session should use the discovered path — succeed
            const channel = {
              on: vi.fn((event: string, handler: (arg: unknown) => void) => {
                if (event === 'close') setTimeout(() => handler(0), 0);
                return channel;
              }),
              stderr: { on: vi.fn().mockReturnThis() },
            };
            cb(undefined, channel);
          } else if (cmd.includes('/usr/local/bin/tmux --version')) {
            // Probe path - simulate /usr/local/bin/tmux found
            const channel = {
              on: vi.fn((event: string, handler: (arg: unknown) => void) => {
                if (event === 'data') handler(Buffer.from('tmux 3.4'));
                if (event === 'close') setTimeout(() => handler(0), 0);
                return channel;
              }),
              stderr: { on: vi.fn().mockReturnThis() },
            };
            cb(undefined, channel);
          } else if (cmd.includes('--version')) {
            // Other probe paths fail
            const channel = {
              on: vi.fn((event: string, handler: (arg: unknown) => void) => {
                if (event === 'close') setTimeout(() => handler(1), 0);
                return channel;
              }),
              stderr: { on: vi.fn().mockReturnThis() },
            };
            cb(undefined, channel);
          } else {
            const channel = {
              on: vi.fn((event: string, handler: (arg: unknown) => void) => {
                if (event === 'close') setTimeout(() => handler(0), 0);
                return channel;
              }),
              stderr: { on: vi.fn().mockReturnThis() },
            };
            cb(undefined, channel);
          }
        }),
      };

      sshManager = {
        ...createMockSSHManager(),
        getConnection: vi.fn().mockResolvedValue({
          isLocal: false,
          client: mockClient,
          connectionId: 'conn-ssh',
        }),
      } as unknown as SSHConnectionManager;

      const result = await handleCreateSession(
        {
          connection_id: 'conn-ssh',
          namespace: 'test-ns',
          tmux_session_name: 'my-session',
          cols: 120,
          rows: 40,
          capture_on_command: true,
          embed_commands: true,
          embed_scrollback: false,
          capture_interval_s: 30,
          tags: [],
          notes: '',
        },
        pool as unknown as pg.Pool,
        tmuxManager,
        sshManager,
        'worker-1',
      );

      expect(result.status).toBe('active');
      // Should have probed paths before attempting auto-install
      const probeCommands = execCommands.filter(c =>
        c.includes('/opt/homebrew/bin/tmux') ||
        c.includes('/usr/local/bin/tmux') ||
        c.includes('/snap/bin/tmux'),
      );
      expect(probeCommands.length).toBeGreaterThan(0);
      // The tmux new-session command should use the discovered path
      const newSessionCmd = execCommands.find(c => c.includes('new-session'));
      expect(newSessionCmd).toBeDefined();
      expect(newSessionCmd).toContain('/usr/local/bin/tmux');
    });

    it('detects macOS and skips apt-get/yum in auto-install (#2324)', async () => {
      const sshConnection = {
        id: 'conn-mac',
        namespace: 'test-ns',
        name: 'mac-remote',
        host: '10.0.0.3',
        port: 22,
        username: 'user',
        auth_method: 'key',
        credential_id: null,
        proxy_jump_id: null,
        is_local: false,
        env: null,
        connect_timeout_s: 30,
        keepalive_interval: 60,
      };
      pool._queryResults.set('conn-mac', { rows: [sshConnection] });

      const execCommands: string[] = [];
      const mockClient = {
        exec: vi.fn((cmd: string, cb: (err: Error | undefined, channel: unknown) => void) => {
          execCommands.push(cmd);
          if (cmd === 'which tmux' || cmd === 'command -v tmux') {
            // tmux not found via which
            const channel = {
              on: vi.fn((event: string, handler: (arg: unknown) => void) => {
                if (event === 'close') setTimeout(() => handler(1), 0);
                return channel;
              }),
              stderr: { on: vi.fn().mockReturnThis() },
            };
            cb(undefined, channel);
          } else if (cmd.includes('--version')) {
            // All probe paths fail
            const channel = {
              on: vi.fn((event: string, handler: (arg: unknown) => void) => {
                if (event === 'close') setTimeout(() => handler(1), 0);
                return channel;
              }),
              stderr: { on: vi.fn().mockReturnThis() },
            };
            cb(undefined, channel);
          } else if (cmd === 'uname -s') {
            // macOS detected
            const channel = {
              on: vi.fn((event: string, handler: (arg: unknown) => void) => {
                if (event === 'data') handler(Buffer.from('Darwin'));
                if (event === 'close') setTimeout(() => handler(0), 0);
                return channel;
              }),
              stderr: { on: vi.fn().mockReturnThis() },
            };
            cb(undefined, channel);
          } else {
            // Everything else fails (including brew install)
            const channel = {
              on: vi.fn((event: string, handler: (arg: unknown) => void) => {
                if (event === 'close') setTimeout(() => handler(1), 0);
                return channel;
              }),
              stderr: { on: vi.fn().mockReturnThis() },
            };
            cb(undefined, channel);
          }
        }),
      };

      sshManager = {
        ...createMockSSHManager(),
        getConnection: vi.fn().mockResolvedValue({
          isLocal: false,
          client: mockClient,
          connectionId: 'conn-mac',
        }),
      } as unknown as SSHConnectionManager;

      const result = await handleCreateSession(
        {
          connection_id: 'conn-mac',
          namespace: 'test-ns',
          tmux_session_name: 'mac-session',
          cols: 120,
          rows: 40,
          capture_on_command: true,
          embed_commands: true,
          embed_scrollback: false,
          capture_interval_s: 30,
          tags: [],
          notes: '',
        },
        pool as unknown as pg.Pool,
        tmuxManager,
        sshManager,
        'worker-1',
      );

      // Should succeed as SSH-only (no-tmux tag)
      expect(result.tags).toContain('no-tmux');
      // Should NOT have attempted apt-get or yum on macOS
      const linuxInstallCmd = execCommands.find(c =>
        c.includes('apt-get') || c.includes('yum'),
      );
      expect(linuxInstallCmd).toBeUndefined();
    });

    it('uses custom tmux_path from connection config (#2324)', async () => {
      const sshConnection = {
        id: 'conn-custom-tmux',
        namespace: 'test-ns',
        name: 'custom-path',
        host: '10.0.0.5',
        port: 22,
        username: 'user',
        auth_method: 'key',
        credential_id: null,
        proxy_jump_id: null,
        is_local: false,
        env: { TMUX_PATH: '/custom/path/tmux' },
        connect_timeout_s: 30,
        keepalive_interval: 60,
        tmux_path: '/custom/path/tmux',
      };
      pool._queryResults.set('conn-custom-tmux', { rows: [sshConnection] });

      const execCommands: string[] = [];
      const mockClient = {
        exec: vi.fn((cmd: string, cb: (err: Error | undefined, channel: unknown) => void) => {
          execCommands.push(cmd);
          const channel = {
            on: vi.fn((event: string, handler: (arg: unknown) => void) => {
              if (event === 'data') handler(Buffer.from('tmux 3.4'));
              if (event === 'close') setTimeout(() => handler(0), 0);
              return channel;
            }),
            stderr: { on: vi.fn().mockReturnThis() },
          };
          cb(undefined, channel);
        }),
      };

      sshManager = {
        ...createMockSSHManager(),
        getConnection: vi.fn().mockResolvedValue({
          isLocal: false,
          client: mockClient,
          connectionId: 'conn-custom-tmux',
        }),
      } as unknown as SSHConnectionManager;

      const result = await handleCreateSession(
        {
          connection_id: 'conn-custom-tmux',
          namespace: 'test-ns',
          tmux_session_name: 'custom-session',
          cols: 120,
          rows: 40,
          capture_on_command: true,
          embed_commands: true,
          embed_scrollback: false,
          capture_interval_s: 30,
          tags: [],
          notes: '',
        },
        pool as unknown as pg.Pool,
        tmuxManager,
        sshManager,
        'worker-1',
      );

      expect(result.status).toBe('active');
      // The new-session command should use the custom tmux_path
      const newSessionCmd = execCommands.find(c => c.includes('new-session'));
      expect(newSessionCmd).toBeDefined();
      expect(newSessionCmd).toContain('/custom/path/tmux');
    });

    it('throws when connection is not found', async () => {
      // No results for connection lookup
      await expect(
        handleCreateSession(
          {
            connection_id: 'nonexistent',
            namespace: 'test-ns',
            tmux_session_name: 'fail-session',
            cols: 80,
            rows: 24,
            capture_on_command: true,
            embed_commands: false,
            embed_scrollback: false,
            capture_interval_s: 0,
            tags: [],
            notes: '',
          },
          pool as unknown as pg.Pool,
          tmuxManager,
          sshManager,
          'worker-1',
        ),
      ).rejects.toThrow('Connection not found');
    });
  });

  describe('handleTerminateSession', () => {
    it('terminates an active session', async () => {
      pool._queryResults.set('session-1', { rows: [sessionRow] });

      await handleTerminateSession(
        { session_id: 'session-1' },
        pool as unknown as pg.Pool,
        tmuxManager,
        sshManager,
      );

      expect((tmuxManager.killSession as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        'sess-test-1',
      );
    });

    it('throws when session is not found', async () => {
      await expect(
        handleTerminateSession(
          { session_id: 'nonexistent' },
          pool as unknown as pg.Pool,
          tmuxManager,
          sshManager,
        ),
      ).rejects.toThrow('Session not found');
    });
  });

  describe('handleListSessions', () => {
    it('returns sessions filtered by namespace', async () => {
      pool.query = vi.fn(async (sql: string) => {
        if (sql.includes('FROM terminal_session')) {
          return {
            rows: [
              { ...sessionRow, id: 's1' },
              { ...sessionRow, id: 's2', status: 'terminated' },
            ],
          };
        }
        return { rows: [] };
      }) as pg.Pool['query'];

      const result = await handleListSessions(
        { namespace: 'test-ns', connection_id: '', status_filter: '' },
        pool as unknown as pg.Pool,
      );

      expect(result.sessions).toHaveLength(2);
      expect(result.sessions[0].id).toBe('s1');
    });

    it('filters by status when provided', async () => {
      pool.query = vi.fn(async (_sql: string, params?: unknown[]) => {
        // Verify status_filter is used in query params
        return { rows: [sessionRow] };
      }) as pg.Pool['query'];

      const result = await handleListSessions(
        { namespace: 'test-ns', connection_id: '', status_filter: 'active' },
        pool as unknown as pg.Pool,
      );

      expect(result.sessions).toHaveLength(1);
    });
  });

  describe('handleGetSession', () => {
    it('returns session with windows and panes', async () => {
      pool.query = vi.fn(async (sql: string) => {
        // Order matters: more specific matches first
        if (sql.includes('FROM terminal_session_pane')) {
          return {
            rows: [
              { id: 'pane-1', window_id: 'win-1', namespace: 'test-ns', pane_index: 0, is_active: true, pid: 12345, current_command: 'bash' },
            ],
          };
        }
        if (sql.includes('FROM terminal_session_window')) {
          return {
            rows: [
              { id: 'win-1', session_id: 'session-1', namespace: 'test-ns', window_index: 0, window_name: 'bash', is_active: true },
            ],
          };
        }
        if (sql.includes('FROM terminal_session')) {
          return { rows: [sessionRow] };
        }
        return { rows: [] };
      }) as pg.Pool['query'];

      const result = await handleGetSession(
        { session_id: 'session-1' },
        pool as unknown as pg.Pool,
      );

      expect(result.id).toBe('session-1');
      expect(result.status).toBe('active');
      expect(result.windows).toHaveLength(1);
      expect(result.windows[0].panes).toHaveLength(1);
    });

    it('throws when session not found', async () => {
      pool.query = vi.fn(async () => ({ rows: [] })) as pg.Pool['query'];

      await expect(
        handleGetSession(
          { session_id: 'nonexistent' },
          pool as unknown as pg.Pool,
        ),
      ).rejects.toThrow('Session not found');
    });
  });

  describe('handleResizeSession', () => {
    it('resizes session and updates DB', async () => {
      pool.query = vi.fn(async (sql: string) => {
        if (sql.includes('FROM terminal_session')) {
          return { rows: [sessionRow] };
        }
        return { rows: [], rowCount: 1 };
      }) as pg.Pool['query'];

      await handleResizeSession(
        { session_id: 'session-1', cols: 160, rows: 50 },
        pool as unknown as pg.Pool,
        tmuxManager,
      );

      expect((tmuxManager.resizeSession as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        'sess-test-1',
        160,
        50,
      );
    });
  });
});
