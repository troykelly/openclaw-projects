/**
 * Tests for 8 critical terminal paths that lacked coverage.
 *
 * Issue #2125 — Missing test coverage for critical terminal paths.
 * Epic #2130 — Terminal System Hardening.
 *
 * Critical paths covered:
 * 1. HandleAttachSession with multiple rapid resize events (race condition)
 * 2. PTY initialization timeout / failure scenario
 * 3. Window switching and pane selection logic
 * 4. Entry throttling and data loss verification
 * 5. Fatal close code handling and UI behavior
 * 6. Backpressure overflow under high-volume output
 * 7. Host key approval flow end-to-end
 * 8. Enrollment token concurrent usage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import {
  handleAttachSession,
  handleSendKeys,
  resolveSessionPaneTarget,
} from './terminal-io.ts';
import {
  handleCreateWindow,
  handleCloseWindow,
  handleSplitPane,
  handleClosePane,
} from './window-pane-handlers.ts';
import {
  handleApproveHostKey,
  handleRejectHostKey,
} from './host-key-handlers.ts';
import { EntryRecorder } from './entry-recorder.ts';
import type { PendingEntry } from './entry-recorder.ts';
import type { TmuxManager } from './tmux/manager.ts';
import type pg from 'pg';
import type { TerminalInput, TerminalOutput } from './types.ts';

// ── Mock node-pty ────────────────────────────────────────────
type DataHandler = (data: string) => void;
type ExitHandler = (e: { exitCode: number; signal?: number }) => void;

interface MockPty {
  onData: (cb: DataHandler) => { dispose: () => void };
  onExit: (cb: ExitHandler) => { dispose: () => void };
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  _dataHandlers: DataHandler[];
  _exitHandlers: ExitHandler[];
  _emitData: (data: string) => void;
  _emitExit: (code: number) => void;
}

function createMockPty(): MockPty {
  const dataHandlers: DataHandler[] = [];
  const exitHandlers: ExitHandler[] = [];
  return {
    onData: (cb: DataHandler) => {
      dataHandlers.push(cb);
      return { dispose: () => {} };
    },
    onExit: (cb: ExitHandler) => {
      exitHandlers.push(cb);
      return { dispose: () => {} };
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _dataHandlers: dataHandlers,
    _exitHandlers: exitHandlers,
    _emitData: (data: string) => dataHandlers.forEach((h) => h(data)),
    _emitExit: (code: number) =>
      exitHandlers.forEach((h) => h({ exitCode: code })),
  };
}

let mockPtyInstance: MockPty | null = null;

vi.mock('node-pty', () => ({
  spawn: vi.fn((..._args: unknown[]) => {
    mockPtyInstance = createMockPty();
    return mockPtyInstance;
  }),
}));

// ── Shared helpers ────────────────────────────────────────────

const SESSION_ID = randomUUID();
const NAMESPACE = 'test-ns';

function mockPool(): pg.Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  } as unknown as pg.Pool;
}

function mockEntryRecorder(): ReturnType<typeof vi.fn> & {
  record: ReturnType<typeof vi.fn>;
} {
  return {
    record: vi.fn().mockReturnValue(true),
  } as unknown as ReturnType<typeof vi.fn> & {
    record: ReturnType<typeof vi.fn>;
  };
}

function mockTmuxManager(): TmuxManager {
  return {
    sendKeys: vi.fn().mockResolvedValue(undefined),
    capturePane: vi.fn().mockResolvedValue('captured content\n'),
    resizeSession: vi.fn().mockResolvedValue(undefined),
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
    createWindow: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    splitPane: vi.fn().mockResolvedValue(undefined),
    closePane: vi.fn().mockResolvedValue(undefined),
  } as unknown as TmuxManager;
}

/** Set up pool mocks for session + pane resolution + dimension lookup. */
function setupPoolForAttach(pool: pg.Pool): void {
  const queryFn = pool.query as ReturnType<typeof vi.fn>;
  queryFn.mockResolvedValueOnce({
    rows: [
      {
        id: SESSION_ID,
        namespace: NAMESPACE,
        tmux_session_name: 'oc-test',
        status: 'active',
      },
    ],
  });
  queryFn.mockResolvedValueOnce({
    rows: [{ pane_id: 'pane-uuid', window_index: 0, pane_index: 0 }],
  });
  queryFn.mockResolvedValueOnce({
    rows: [{ cols: 80, rows: 24 }],
  });
}

/** Helper to create a mock gRPC duplex stream. */
function mockDuplexStream(): grpc.ServerDuplexStream<
  TerminalInput,
  TerminalOutput
> & {
  _dataHandlers: Array<(input: TerminalInput) => void>;
  _emit: (event: string, ...args: unknown[]) => void;
  written: TerminalOutput[];
} {
  const dataHandlers: Array<(input: TerminalInput) => void> = [];
  const otherHandlers: Map<string, Array<(...args: unknown[]) => void>> =
    new Map();
  const written: TerminalOutput[] = [];

  const stream = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'data') {
        dataHandlers.push(handler as (input: TerminalInput) => void);
      } else {
        const handlers = otherHandlers.get(event) ?? [];
        handlers.push(handler);
        otherHandlers.set(event, handlers);
      }
      return stream;
    }),
    once: vi.fn(
      (_event: string, _handler: (...args: unknown[]) => void) => stream,
    ),
    write: vi.fn((data: TerminalOutput) => {
      written.push(data);
      return true;
    }),
    end: vi.fn(),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      const handlers = otherHandlers.get(event) ?? [];
      handlers.forEach((h) => h(...args));
      return true;
    }),
    _dataHandlers: dataHandlers,
    _emit: (event: string, ...args: unknown[]) => {
      const handlers = otherHandlers.get(event) ?? [];
      handlers.forEach((h) => h(...args));
    },
    written,
  } as unknown as grpc.ServerDuplexStream<TerminalInput, TerminalOutput> & {
    _dataHandlers: Array<(input: TerminalInput) => void>;
    _emit: (event: string, ...args: unknown[]) => void;
    written: TerminalOutput[];
  };

  return stream;
}

// ── Mock pool with query tracking (for host-key/window-pane tests) ──
function createTrackingPool() {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const mockResults = new Map<
    string,
    { rows: unknown[]; rowCount: number }
  >();

  const pool = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      queries.push({ text, params });
      for (const [pattern, result] of mockResults) {
        if (text.includes(pattern)) {
          return result;
        }
      }
      return { rows: [], rowCount: 0 };
    }),
    __queries: queries,
    __setResult: (
      pattern: string,
      result: { rows: unknown[]; rowCount: number },
    ) => {
      mockResults.set(pattern, result);
    },
  };

  return pool;
}

// ═══════════════════════════════════════════════════════════════
// 1. HandleAttachSession with multiple rapid resize events
// ═══════════════════════════════════════════════════════════════

describe('Critical Path 1: Rapid resize events during attach', () => {
  let pool: pg.Pool;
  let tmux: TmuxManager;
  let recorder: ReturnType<typeof mockEntryRecorder>;
  let stream: ReturnType<typeof mockDuplexStream>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPtyInstance = null;
    pool = mockPool();
    tmux = mockTmuxManager();
    recorder = mockEntryRecorder();
    stream = mockDuplexStream();
  });

  it('handles multiple rapid resize events without error', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // Fire 20 rapid resize events in quick succession
    for (let i = 0; i < 20; i++) {
      const cols = 80 + i * 5;
      const rows = 24 + i;
      stream._dataHandlers[0]({
        session_id: '',
        resize: { cols, rows },
      });
    }

    // All resize calls should have been forwarded to PTY without error
    expect(mockPtyInstance!.resize).toHaveBeenCalledTimes(20);

    // The last resize should have the final dimensions
    const lastCall =
      mockPtyInstance!.resize.mock.calls[
        mockPtyInstance!.resize.mock.calls.length - 1
      ];
    expect(lastCall).toEqual([80 + 19 * 5, 24 + 19]);
  });

  it('ignores resize events with invalid dimensions', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // Zero dimensions should be ignored
    stream._dataHandlers[0]({
      session_id: '',
      resize: { cols: 0, rows: 0 },
    });

    // Negative dimensions (coerced)
    stream._dataHandlers[0]({
      session_id: '',
      resize: { cols: -1, rows: -1 },
    });

    // Excessively large dimensions (> MAX_COLS=1000, MAX_ROWS=500) should be ignored
    stream._dataHandlers[0]({
      session_id: '',
      resize: { cols: 1001, rows: 501 },
    });

    expect(mockPtyInstance!.resize).not.toHaveBeenCalled();
  });

  it('applies queued resizes before PTY spawn, keeping last one', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );

    // Send first message (triggers async init)
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    // Queue several resizes during initialization
    stream._dataHandlers[0]({
      session_id: '',
      resize: { cols: 100, rows: 30 },
    });
    stream._dataHandlers[0]({
      session_id: '',
      resize: { cols: 200, rows: 50 },
    });
    stream._dataHandlers[0]({
      session_id: '',
      resize: { cols: 150, rows: 40 },
    });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // PTY should have been spawned with the last queued resize dimensions
    const { spawn } = await import('node-pty');
    expect(spawn).toHaveBeenCalledWith(
      'tmux',
      expect.any(Array),
      expect.objectContaining({ cols: 150, rows: 40 }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. PTY initialization timeout / failure scenario
// ═══════════════════════════════════════════════════════════════

describe('Critical Path 2: PTY initialization failure', () => {
  let pool: pg.Pool;
  let tmux: TmuxManager;
  let recorder: ReturnType<typeof mockEntryRecorder>;
  let stream: ReturnType<typeof mockDuplexStream>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPtyInstance = null;
    pool = mockPool();
    tmux = mockTmuxManager();
    recorder = mockEntryRecorder();
    stream = mockDuplexStream();
  });

  it('emits error when session resolution fails', async () => {
    // Session not found
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [],
    });

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: 'nonexistent-session' });

    await vi.waitFor(() =>
      expect(stream.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: grpc.status.NOT_FOUND }),
      ),
    );
  });

  it('emits error when session is terminated', async () => {
    const queryFn = pool.query as ReturnType<typeof vi.fn>;
    queryFn.mockResolvedValueOnce({
      rows: [
        {
          id: SESSION_ID,
          namespace: NAMESPACE,
          tmux_session_name: 'oc-test',
          status: 'terminated',
        },
      ],
    });

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() =>
      expect(stream.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: grpc.status.NOT_FOUND }),
      ),
    );
  });

  it('does not process input after stream end during initialization', async () => {
    // Make the session resolution slow using a delayed response
    const queryFn = pool.query as ReturnType<typeof vi.fn>;
    queryFn.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                rows: [
                  {
                    id: SESSION_ID,
                    namespace: NAMESPACE,
                    tmux_session_name: 'oc-test',
                    status: 'active',
                  },
                ],
              }),
            50,
          ),
        ),
    );

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    // End stream before init completes
    stream._emit('end');

    // Wait long enough for the init to have completed
    await new Promise((r) => setTimeout(r, 100));

    // PTY should not have been spawned because stream ended during init
    expect(mockPtyInstance).toBeNull();
  });

  it('rejects invalid tmux session names during attach', async () => {
    const queryFn = pool.query as ReturnType<typeof vi.fn>;
    // Session with invalid tmux name containing shell metacharacters
    queryFn.mockResolvedValueOnce({
      rows: [
        {
          id: SESSION_ID,
          namespace: NAMESPACE,
          tmux_session_name: 'bad;rm -rf /',
          status: 'active',
        },
      ],
    });
    queryFn.mockResolvedValueOnce({
      rows: [{ pane_id: 'pane-uuid', window_index: 0, pane_index: 0 }],
    });
    queryFn.mockResolvedValueOnce({
      rows: [{ cols: 80, rows: 24 }],
    });

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() =>
      expect(stream.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          code: grpc.status.INVALID_ARGUMENT,
          message: expect.stringContaining('Invalid tmux session name'),
        }),
      ),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Window switching and pane selection
// ═══════════════════════════════════════════════════════════════

describe('Critical Path 3: Window switching and pane selection', () => {
  let pool: ReturnType<typeof createTrackingPool>;
  let tmux: ReturnType<typeof vi.fn> & Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    pool = createTrackingPool();
    tmux = {
      createWindow: vi.fn(),
      closeWindow: vi.fn(),
      splitPane: vi.fn(),
      closePane: vi.fn(),
      listWindows: vi.fn().mockResolvedValue([
        { index: 0, name: 'editor', active: false },
        { index: 1, name: 'shell', active: false },
        { index: 2, name: 'new-window', active: true },
      ]),
      listPanes: vi.fn().mockResolvedValue([
        { index: 0, active: true, pid: 100, currentCommand: 'bash' },
      ]),
    } as unknown as ReturnType<typeof vi.fn> &
      Record<string, ReturnType<typeof vi.fn>>;
  });

  it('creates a window and deactivates previous windows', async () => {
    pool.__setResult('SELECT id, namespace, tmux_session_name, status', {
      rows: [
        {
          id: 'sess-1',
          namespace: 'default',
          tmux_session_name: 'my-session',
          status: 'active',
        },
      ],
      rowCount: 1,
    });

    const result = await handleCreateWindow(
      { session_id: 'sess-1', window_name: 'new-window' },
      pool as never,
      tmux as never,
    );

    expect(result.is_active).toBe(true);
    expect(result.window_index).toBe(2);

    // Verify the deactivation query was issued
    const deactivateQuery = pool.__queries.find(
      (q) =>
        q.text.includes('UPDATE terminal_session_window') &&
        q.text.includes('is_active = false'),
    );
    expect(deactivateQuery).toBeDefined();
  });

  it('creates a pane via split and deactivates sibling panes', async () => {
    pool.__setResult('SELECT id, namespace, tmux_session_name, status', {
      rows: [
        {
          id: 'sess-1',
          namespace: 'default',
          tmux_session_name: 'my-session',
          status: 'active',
        },
      ],
      rowCount: 1,
    });
    pool.__setResult('SELECT id, namespace FROM terminal_session_window', {
      rows: [{ id: 'win-1', namespace: 'default' }],
      rowCount: 1,
    });

    tmux.listPanes = vi.fn().mockResolvedValue([
      { index: 0, active: false, pid: 100, currentCommand: 'bash' },
      { index: 1, active: true, pid: 200, currentCommand: 'vim' },
    ]);

    const result = await handleSplitPane(
      { session_id: 'sess-1', window_index: 0, horizontal: false },
      pool as never,
      tmux as never,
    );

    // The new pane should be active
    expect(result.is_active).toBe(true);
    expect(result.pane_index).toBe(1);

    // Verify the deactivation query for sibling panes
    const deactivateQuery = pool.__queries.find(
      (q) =>
        q.text.includes('UPDATE terminal_session_pane') &&
        q.text.includes('is_active = false'),
    );
    expect(deactivateQuery).toBeDefined();
  });

  it('resolveSessionPaneTarget selects active pane of active window', async () => {
    const pool = mockPool();
    const queryFn = pool.query as ReturnType<typeof vi.fn>;

    // Session lookup
    queryFn.mockResolvedValueOnce({
      rows: [
        {
          id: SESSION_ID,
          namespace: NAMESPACE,
          tmux_session_name: 'oc-test',
          status: 'active',
        },
      ],
    });
    // Active pane lookup — returns the active pane of the active window
    queryFn.mockResolvedValueOnce({
      rows: [{ pane_id: 'active-pane', window_index: 2, pane_index: 1 }],
    });

    const result = await resolveSessionPaneTarget(pool, SESSION_ID, '');

    expect(result.paneId).toBe('active-pane');
    expect(result.windowIndex).toBe(2);
    expect(result.paneIndex).toBe(1);
  });

  it('resolveSessionPaneTarget selects specific pane when provided', async () => {
    const pool = mockPool();
    const specificPaneId = randomUUID();
    const queryFn = pool.query as ReturnType<typeof vi.fn>;

    queryFn.mockResolvedValueOnce({
      rows: [
        {
          id: SESSION_ID,
          namespace: NAMESPACE,
          tmux_session_name: 'oc-test',
          status: 'active',
        },
      ],
    });
    queryFn.mockResolvedValueOnce({
      rows: [
        { pane_id: specificPaneId, window_index: 0, pane_index: 3 },
      ],
    });

    const result = await resolveSessionPaneTarget(
      pool,
      SESSION_ID,
      specificPaneId,
    );

    expect(result.paneId).toBe(specificPaneId);
    expect(result.paneIndex).toBe(3);
  });

  it('closeWindow removes associated panes from DB', async () => {
    pool.__setResult('SELECT id, namespace, tmux_session_name, status', {
      rows: [
        {
          id: 'sess-1',
          namespace: 'default',
          tmux_session_name: 'my-session',
          status: 'active',
        },
      ],
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

    // Verify pane deletion query
    const deletePaneQuery = pool.__queries.find(
      (q) =>
        q.text.includes('DELETE FROM terminal_session_pane') &&
        q.params.includes('win-1'),
    );
    expect(deletePaneQuery).toBeDefined();

    // Verify window deletion query
    const deleteWindowQuery = pool.__queries.find(
      (q) =>
        q.text.includes('DELETE FROM terminal_session_window') &&
        q.params.includes('win-1'),
    );
    expect(deleteWindowQuery).toBeDefined();
  });

  it('closePane removes specific pane by window_id and pane_index', async () => {
    pool.__setResult('SELECT id, namespace, tmux_session_name, status', {
      rows: [
        {
          id: 'sess-1',
          namespace: 'default',
          tmux_session_name: 'my-session',
          status: 'active',
        },
      ],
      rowCount: 1,
    });
    pool.__setResult('SELECT id FROM terminal_session_window', {
      rows: [{ id: 'win-1' }],
      rowCount: 1,
    });

    await handleClosePane(
      { session_id: 'sess-1', window_index: 0, pane_index: 2 },
      pool as never,
      tmux as never,
    );

    const deletePaneQuery = pool.__queries.find(
      (q) =>
        q.text.includes('DELETE FROM terminal_session_pane') &&
        q.params.includes('win-1') &&
        q.params.includes(2),
    );
    expect(deletePaneQuery).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Entry throttling and data loss verification
// ═══════════════════════════════════════════════════════════════

describe('Critical Path 4: Entry throttling and data loss', () => {
  function createTestMockPool() {
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

  it('does not lose non-throttled entries under high volume', async () => {
    const mockPool = createTestMockPool();
    const recorder = new EntryRecorder(mockPool as never, {
      maxBufferSize: 50,
      flushIntervalMs: 60000,
      throttleBytesPerSec: 1_048_576, // high threshold — no throttling
      throttleSustainedMs: 10000,
    });

    // Record 100 command entries (commands are never throttled)
    for (let i = 0; i < 100; i++) {
      const accepted = recorder.record(
        makeEntry({ kind: 'command', content: `cmd-${i}` }),
      );
      expect(accepted).toBe(true);
    }

    // Allow auto-flush for entries beyond maxBufferSize
    await new Promise((r) => setTimeout(r, 50));

    // Flush remaining
    await recorder.flush();

    // Count total entries flushed via INSERT queries
    let totalInserted = 0;
    for (const q of mockPool.queries) {
      if (q.text.includes('INSERT INTO terminal_session_entry')) {
        // Each entry has 7 values
        totalInserted += q.values.length / 7;
      }
    }

    expect(totalInserted).toBe(100);
  });

  it('throttles output but keeps accepting command entries concurrently', () => {
    const mockPool = createTestMockPool();
    const recorder = new EntryRecorder(mockPool as never, {
      maxBufferSize: 1000,
      flushIntervalMs: 60000,
      throttleBytesPerSec: 100, // very low threshold
      throttleSustainedMs: 1000, // 100 bytes total before throttle
    });

    // First output entry (50 bytes) — accepted
    expect(
      recorder.record(
        makeEntry({ kind: 'output', content: 'x'.repeat(50) }),
      ),
    ).toBe(true);

    // Second output entry (200 bytes) — throttled (total 250 > 100)
    expect(
      recorder.record(
        makeEntry({ kind: 'output', content: 'y'.repeat(200) }),
      ),
    ).toBe(false);

    // Command entries continue being accepted even while output is throttled
    for (let i = 0; i < 5; i++) {
      expect(
        recorder.record(
          makeEntry({ kind: 'command', content: `cmd-during-throttle-${i}` }),
        ),
      ).toBe(true);
    }

    // Buffer should have 1 output + 5 commands = 6 entries
    expect(recorder.bufferSize).toBe(6);
  });

  it('records throttle summary with correct metadata', async () => {
    const mockPool = createTestMockPool();
    const recorder = new EntryRecorder(mockPool as never);

    recorder.recordThrottleSummary(
      'sess-1',
      'default',
      10_000_000,
      30.5,
      'first-1024-bytes...',
      'last-1024-bytes...',
    );

    expect(recorder.bufferSize).toBe(1);
    await recorder.flush();

    const insertQuery = mockPool.queries.find((q) =>
      q.text.includes('INSERT INTO terminal_session_entry'),
    );
    expect(insertQuery).toBeDefined();

    // Verify the kind is 'scrollback' (5th value per entry)
    expect(insertQuery!.values[4]).toBe('scrollback');

    // Verify metadata includes throttle info
    const metadataStr = insertQuery!.values[6] as string;
    const metadata = JSON.parse(metadataStr) as Record<string, unknown>;
    expect(metadata.throttled).toBe(true);
    expect(metadata.total_bytes).toBe(10_000_000);
    expect(metadata.duration_s).toBe(30.5);
  });

  it('resets throttle state for a session and accepts entries again', () => {
    const mockPool = createTestMockPool();
    const recorder = new EntryRecorder(mockPool as never, {
      maxBufferSize: 1000,
      flushIntervalMs: 60000,
      throttleBytesPerSec: 100,
      throttleSustainedMs: 1000,
    });

    // Exhaust throttle for sess-1
    recorder.record(
      makeEntry({
        kind: 'output',
        content: 'a'.repeat(50),
        session_id: 'sess-1',
      }),
    );
    expect(
      recorder.record(
        makeEntry({
          kind: 'output',
          content: 'b'.repeat(200),
          session_id: 'sess-1',
        }),
      ),
    ).toBe(false);

    // Different session should NOT be throttled
    expect(
      recorder.record(
        makeEntry({
          kind: 'output',
          content: 'c'.repeat(50),
          session_id: 'sess-2',
        }),
      ),
    ).toBe(true);

    // Reset sess-1
    recorder.resetThrottle('sess-1');

    // sess-1 should accept again
    expect(
      recorder.record(
        makeEntry({
          kind: 'output',
          content: 'd'.repeat(50),
          session_id: 'sess-1',
        }),
      ),
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Fatal close code handling and UI behavior
// ═══════════════════════════════════════════════════════════════

describe('Critical Path 5: Fatal close code handling', () => {
  let pool: pg.Pool;
  let tmux: TmuxManager;
  let recorder: ReturnType<typeof mockEntryRecorder>;
  let stream: ReturnType<typeof mockDuplexStream>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPtyInstance = null;
    pool = mockPool();
    tmux = mockTmuxManager();
    recorder = mockEntryRecorder();
    stream = mockDuplexStream();
  });

  it('sends "terminated" event for PTY exit code 0', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    mockPtyInstance!._emitExit(0);

    const event = stream.written.find(
      (w) => w.event?.type === 'status_change' && w.event?.message === 'terminated',
    );
    expect(event).toBeDefined();
    expect(stream.end).toHaveBeenCalled();
  });

  it('sends "disconnected" event for non-zero PTY exit code', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // Simulate fatal exit (e.g. tmux died, SSH connection lost)
    mockPtyInstance!._emitExit(1);

    const event = stream.written.find(
      (w) =>
        w.event?.type === 'status_change' &&
        w.event?.message === 'disconnected',
    );
    expect(event).toBeDefined();
    expect(stream.end).toHaveBeenCalled();
  });

  it('sends "disconnected" event for signal-killed PTY (code 128+)', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // SIGKILL = 128+9 = 137
    mockPtyInstance!._emitExit(137);

    const event = stream.written.find(
      (w) =>
        w.event?.type === 'status_change' &&
        w.event?.message === 'disconnected',
    );
    expect(event).toBeDefined();
  });

  it('cleans up PTY on fatal exit', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    mockPtyInstance!._emitExit(1);

    // After fatal exit, further input should not crash
    stream._dataHandlers[0]({
      session_id: '',
      data: Buffer.from('should be ignored'),
    });

    // Write should not have been called after cleanup
    // (it may have been called before exit for output events)
    expect(mockPtyInstance!.write).not.toHaveBeenCalled();
  });

  it('does not send duplicate events on rapid PTY exit', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // Trigger exit twice rapidly
    mockPtyInstance!._emitExit(0);
    mockPtyInstance!._emitExit(0);

    // Should only get one status_change event (cleanup sets ended=true)
    const exitEvents = stream.written.filter(
      (w) =>
        w.event?.type === 'status_change' &&
        (w.event?.message === 'terminated' ||
          w.event?.message === 'disconnected'),
    );
    expect(exitEvents).toHaveLength(1);

    // call.end should be called exactly once
    expect(stream.end).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Backpressure overflow under high-volume output
// ═══════════════════════════════════════════════════════════════

describe('Critical Path 6: Backpressure under high-volume output', () => {
  let pool: pg.Pool;
  let tmux: TmuxManager;
  let recorder: ReturnType<typeof mockEntryRecorder>;
  let stream: ReturnType<typeof mockDuplexStream>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPtyInstance = null;
    pool = mockPool();
    tmux = mockTmuxManager();
    recorder = mockEntryRecorder();
    stream = mockDuplexStream();
  });

  it('handles backpressure when call.write returns false', async () => {
    setupPoolForAttach(pool);

    // Make write return false (backpressure) for the first few data writes
    let writeCount = 0;
    (stream.write as ReturnType<typeof vi.fn>).mockImplementation(
      (data: TerminalOutput) => {
        stream.written.push(data);
        writeCount++;
        // Return false for data writes (not events) to simulate backpressure
        if (data.data) {
          return writeCount <= 3 ? false : true;
        }
        return true;
      },
    );

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // Emit high-volume PTY output
    for (let i = 0; i < 10; i++) {
      mockPtyInstance!._emitData(`output-chunk-${i}\r\n`);
    }

    // All data should still be written (backpressure handled by 'drain' listener)
    const dataWrites = stream.written.filter((w) => w.data !== undefined);
    expect(dataWrites.length).toBe(10);

    // call.once('drain') should have been called when backpressure was detected
    expect(stream.once).toHaveBeenCalledWith('drain', expect.any(Function));
  });

  it('continues recording entries during backpressure', async () => {
    setupPoolForAttach(pool);

    // Simulate backpressure on all data writes
    (stream.write as ReturnType<typeof vi.fn>).mockImplementation(
      (data: TerminalOutput) => {
        stream.written.push(data);
        return !data.data; // return false for data, true for events
      },
    );

    handleAttachSession(
      stream,
      pool,
      tmux,
      recorder as unknown as import('./entry-recorder.ts').EntryRecorder,
    );
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    mockPtyInstance!._emitData('output during backpressure');

    // Entry should still be recorded regardless of backpressure
    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'output',
        content: 'output during backpressure',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Host key approval flow end-to-end
// ═══════════════════════════════════════════════════════════════

describe('Critical Path 7: Host key approval flow E2E', () => {
  let pool: ReturnType<typeof createTrackingPool>;

  beforeEach(() => {
    pool = createTrackingPool();
  });

  it('full approve flow: pending → approve → active', async () => {
    // Session starts in pending_host_verification
    pool.__setResult('SELECT id, namespace, connection_id, status', {
      rows: [
        {
          id: 'sess-1',
          namespace: 'default',
          connection_id: 'conn-1',
          status: 'pending_host_verification',
        },
      ],
      rowCount: 1,
    });

    await handleApproveHostKey(
      {
        session_id: 'sess-1',
        host: 'production.example.com',
        port: 22,
        key_type: 'ssh-ed25519',
        fingerprint: 'SHA256:xYz123AbC',
        public_key: 'AAAAC3NzaC1lZDI1NTE5AAAAIKnownGoodKey',
      },
      pool as never,
    );

    // Verify known host was upserted
    const upsertQuery = pool.__queries.find((q) =>
      q.text.includes('INSERT INTO terminal_known_host'),
    );
    expect(upsertQuery).toBeDefined();
    expect(upsertQuery!.params).toContain('production.example.com');
    expect(upsertQuery!.params).toContain(22);
    expect(upsertQuery!.params).toContain('ssh-ed25519');
    expect(upsertQuery!.params).toContain('SHA256:xYz123AbC');
    expect(upsertQuery!.params).toContain(
      'AAAAC3NzaC1lZDI1NTE5AAAAIKnownGoodKey',
    );

    // Verify ON CONFLICT DO UPDATE is used (upsert)
    expect(upsertQuery!.text).toContain('ON CONFLICT');
    expect(upsertQuery!.text).toContain('DO UPDATE');

    // Verify session was resumed
    const resumeQuery = pool.__queries.find(
      (q) =>
        q.text.includes('UPDATE terminal_session') &&
        q.text.includes("status = 'active'"),
    );
    expect(resumeQuery).toBeDefined();
    expect(resumeQuery!.params).toContain('sess-1');
  });

  it('full reject flow: pending → reject → error', async () => {
    pool.__setResult('SELECT id, namespace, connection_id, status', {
      rows: [
        {
          id: 'sess-1',
          namespace: 'default',
          connection_id: 'conn-1',
          status: 'pending_host_verification',
        },
      ],
      rowCount: 1,
    });

    await handleRejectHostKey({ session_id: 'sess-1' }, pool as never);

    // Verify session was set to error with message
    const updateQuery = pool.__queries.find(
      (q) =>
        q.text.includes('UPDATE terminal_session') &&
        q.text.includes("status = 'error'"),
    );
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.text).toContain('error_message');
    expect(updateQuery!.text).toContain('Host key rejected by user');
    expect(updateQuery!.text).toContain('terminated_at');
  });

  it('approve rejects already-active sessions', async () => {
    pool.__setResult('SELECT id, namespace, connection_id, status', {
      rows: [
        {
          id: 'sess-1',
          namespace: 'default',
          connection_id: 'conn-1',
          status: 'active',
        },
      ],
      rowCount: 1,
    });

    await expect(
      handleApproveHostKey(
        {
          session_id: 'sess-1',
          host: 'example.com',
          port: 22,
          key_type: 'ssh-ed25519',
          fingerprint: 'SHA256:test',
          public_key: 'key',
        },
        pool as never,
      ),
    ).rejects.toThrow('not pending host verification');
  });

  it('reject rejects already-terminated sessions', async () => {
    pool.__setResult('SELECT id, namespace, connection_id, status', {
      rows: [
        {
          id: 'sess-1',
          namespace: 'default',
          connection_id: 'conn-1',
          status: 'terminated',
        },
      ],
      rowCount: 1,
    });

    await expect(
      handleRejectHostKey({ session_id: 'sess-1' }, pool as never),
    ).rejects.toThrow('not pending host verification');
  });

  it('approve with ON CONFLICT handles re-keyed hosts', async () => {
    pool.__setResult('SELECT id, namespace, connection_id, status', {
      rows: [
        {
          id: 'sess-2',
          namespace: 'default',
          connection_id: 'conn-1',
          status: 'pending_host_verification',
        },
      ],
      rowCount: 1,
    });

    // Approve with a new fingerprint (simulating host re-keying)
    await handleApproveHostKey(
      {
        session_id: 'sess-2',
        host: 'rekeyed.example.com',
        port: 22,
        key_type: 'ssh-ed25519',
        fingerprint: 'SHA256:newFingerprint',
        public_key: 'AAAAC3NewKey',
      },
      pool as never,
    );

    // The upsert should update the fingerprint and public_key on conflict
    const upsertQuery = pool.__queries.find((q) =>
      q.text.includes('INSERT INTO terminal_known_host'),
    );
    expect(upsertQuery).toBeDefined();
    expect(upsertQuery!.text).toContain('key_fingerprint = EXCLUDED.key_fingerprint');
    expect(upsertQuery!.text).toContain('public_key = EXCLUDED.public_key');
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Enrollment token concurrent usage
// ═══════════════════════════════════════════════════════════════

describe('Critical Path 8: Enrollment token concurrent usage', () => {
  it('enrollment event bus handles concurrent subscribers', () => {
    // Import the event bus
    const {
      enrollmentEventBus,
      toEnrollmentEvent,
    } = require('./enrollment-stream.ts') as typeof import('./enrollment-stream.ts');

    const receivedEvents: Array<
      import('./enrollment-stream.ts').EnrollmentEventData
    > = [];
    const cleanups: Array<() => void> = [];

    // Register 10 concurrent subscribers
    for (let i = 0; i < 10; i++) {
      const cleanup = enrollmentEventBus.onEnrollment((event) => {
        receivedEvents.push(event);
      });
      cleanups.push(cleanup);
    }

    // Emit a single event
    enrollmentEventBus.emitEnrollment({
      connectionId: 'conn-concurrent',
      host: '10.0.0.1',
      port: 22,
      label: 'concurrent-test',
      tags: ['test'],
      enrolledAt: new Date(),
    });

    // All 10 subscribers should have received the event
    expect(receivedEvents).toHaveLength(10);
    for (const event of receivedEvents) {
      expect(event.connectionId).toBe('conn-concurrent');
    }

    // Cleanup
    cleanups.forEach((c) => c());
    enrollmentEventBus.removeAllListeners('enrollment');
  });

  it('enrollment event bus handles subscriber cleanup during event emission', () => {
    const {
      enrollmentEventBus,
    } = require('./enrollment-stream.ts') as typeof import('./enrollment-stream.ts');

    const events1: unknown[] = [];
    const events2: unknown[] = [];
    let cleanup1: (() => void) | null = null;

    // First subscriber removes itself upon receiving an event
    cleanup1 = enrollmentEventBus.onEnrollment((event) => {
      events1.push(event);
      if (cleanup1) {
        cleanup1();
        cleanup1 = null;
      }
    });

    // Second subscriber is stable
    const cleanup2 = enrollmentEventBus.onEnrollment((event) => {
      events2.push(event);
    });

    // Emit first event — subscriber 1 receives and unsubscribes
    enrollmentEventBus.emitEnrollment({
      connectionId: 'c1',
      host: '10.0.0.1',
      port: 22,
      label: 'test',
      tags: [],
      enrolledAt: new Date(),
    });

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);

    // Emit second event — only subscriber 2 should receive
    enrollmentEventBus.emitEnrollment({
      connectionId: 'c2',
      host: '10.0.0.1',
      port: 22,
      label: 'test',
      tags: [],
      enrolledAt: new Date(),
    });

    expect(events1).toHaveLength(1); // subscriber 1 unsubscribed
    expect(events2).toHaveLength(2);

    cleanup2();
    enrollmentEventBus.removeAllListeners('enrollment');
  });

  it('enrollment event conversion preserves all fields', () => {
    const {
      toEnrollmentEvent,
    } = require('./enrollment-stream.ts') as typeof import('./enrollment-stream.ts');

    const now = new Date('2026-03-04T12:00:00Z');
    const data: import('./enrollment-stream.ts').EnrollmentEventData = {
      connectionId: 'conn-test-123',
      host: '192.168.1.100',
      port: 2222,
      label: 'my-homelab',
      tags: ['production', 'web', 'gpu'],
      enrolledAt: now,
    };

    const event = toEnrollmentEvent(data);

    expect(event.connection_id).toBe('conn-test-123');
    expect(event.host).toBe('192.168.1.100');
    expect(event.port).toBe(2222);
    expect(event.label).toBe('my-homelab');
    expect(event.tags).toEqual(['production', 'web', 'gpu']);
    expect(event.enrolled_at).toBeDefined();
    // Timestamp should have seconds field representing the date
    expect(event.enrolled_at!.seconds).toBeDefined();
  });

  it('enrollment event bus handles rapid emissions without losing events', () => {
    const {
      enrollmentEventBus,
    } = require('./enrollment-stream.ts') as typeof import('./enrollment-stream.ts');

    const received: unknown[] = [];
    const cleanup = enrollmentEventBus.onEnrollment((event) => {
      received.push(event);
    });

    // Emit 100 events in rapid succession
    for (let i = 0; i < 100; i++) {
      enrollmentEventBus.emitEnrollment({
        connectionId: `conn-${i}`,
        host: '10.0.0.1',
        port: 22,
        label: `token-${i}`,
        tags: [],
        enrolledAt: new Date(),
      });
    }

    // All 100 should have been received (synchronous emission)
    expect(received).toHaveLength(100);

    cleanup();
    enrollmentEventBus.removeAllListeners('enrollment');
  });
});
