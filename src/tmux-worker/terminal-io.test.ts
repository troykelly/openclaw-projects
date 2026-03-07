/**
 * Tests for terminal I/O handlers: AttachSession, SendCommand, SendKeys, CapturePane.
 * Issues #1848, #1849 — Terminal I/O streaming and command execution RPCs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import {
  handleSendCommand,
  handleSendKeys,
  handleCapturePane,
  handleAttachSession,
  resolveSessionPaneTarget,
  COMMAND_MARKER_PREFIX,
} from './terminal-io.ts';
import type { TmuxManager } from './tmux/manager.ts';
import type pg from 'pg';
import type { EntryRecorder } from './entry-recorder.ts';
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
    onData: (cb: DataHandler) => { dataHandlers.push(cb); return { dispose: () => {} }; },
    onExit: (cb: ExitHandler) => { exitHandlers.push(cb); return { dispose: () => {} }; },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _dataHandlers: dataHandlers,
    _exitHandlers: exitHandlers,
    _emitData: (data: string) => dataHandlers.forEach((h) => h(data)),
    _emitExit: (code: number) => exitHandlers.forEach((h) => h({ exitCode: code })),
  };
}

let mockPtyInstance: MockPty | null = null;

vi.mock('node-pty', () => ({
  spawn: vi.fn((..._args: unknown[]) => {
    mockPtyInstance = createMockPty();
    return mockPtyInstance;
  }),
}));

// ── Helpers to create mocks ──────────────────────────────────

function mockPool(): pg.Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  } as unknown as pg.Pool;
}

function mockTmuxManager(): TmuxManager {
  return {
    sendKeys: vi.fn().mockResolvedValue(undefined),
    capturePane: vi.fn().mockResolvedValue('captured content\n'),
    resizeSession: vi.fn().mockResolvedValue(undefined),
  } as unknown as TmuxManager;
}

function mockEntryRecorder(): EntryRecorder {
  return {
    record: vi.fn().mockReturnValue(true),
  } as unknown as EntryRecorder;
}

const SESSION_ID = randomUUID();
const NAMESPACE = 'test-ns';

// ── resolveSessionPaneTarget ──────────────────────────────────

describe('resolveSessionPaneTarget', () => {
  it('resolves session with active pane when no pane_id given', async () => {
    const pool = mockPool();
    const queryFn = pool.query as ReturnType<typeof vi.fn>;
    // First call: session lookup
    queryFn.mockResolvedValueOnce({
      rows: [
        {
          id: SESSION_ID,
          namespace: NAMESPACE,
          connection_id: 'conn-1',
          tmux_session_name: 'oc-test',
          status: 'active',
          tags: [],
        },
      ],
    });
    // Second call: active pane lookup
    queryFn.mockResolvedValueOnce({
      rows: [
        {
          pane_id: 'pane-uuid',
          window_index: 0,
          pane_index: 0,
        },
      ],
    });

    const result = await resolveSessionPaneTarget(pool, SESSION_ID, '');
    expect(result).toEqual({
      sessionId: SESSION_ID,
      namespace: NAMESPACE,
      connectionId: 'conn-1',
      tmuxSessionName: 'oc-test',
      windowIndex: 0,
      paneIndex: 0,
      paneId: 'pane-uuid',
      tags: [],
    });
  });

  it('resolves session with specific pane_id', async () => {
    const pool = mockPool();
    const paneId = randomUUID();
    const queryFn = pool.query as ReturnType<typeof vi.fn>;
    // First call: session lookup
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
    // Second call: specific pane lookup
    queryFn.mockResolvedValueOnce({
      rows: [
        {
          pane_id: paneId,
          window_index: 1,
          pane_index: 2,
        },
      ],
    });

    const result = await resolveSessionPaneTarget(pool, SESSION_ID, paneId);
    expect(result.paneId).toBe(paneId);
    expect(result.windowIndex).toBe(1);
    expect(result.paneIndex).toBe(2);
  });

  it('throws when session not found', async () => {
    const pool = mockPool();
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    await expect(resolveSessionPaneTarget(pool, SESSION_ID, '')).rejects.toThrow(
      /Session not found/,
    );
  });

  it('throws when session is not active', async () => {
    const pool = mockPool();
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        {
          id: SESSION_ID,
          namespace: NAMESPACE,
          tmux_session_name: 'oc-test',
          status: 'terminated',
        },
      ],
    });

    await expect(resolveSessionPaneTarget(pool, SESSION_ID, '')).rejects.toThrow(
      /not active/,
    );
  });

  it('throws when pane not found', async () => {
    const pool = mockPool();
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
    queryFn.mockResolvedValueOnce({ rows: [] });

    await expect(resolveSessionPaneTarget(pool, SESSION_ID, '')).rejects.toThrow(
      /Pane not found/,
    );
  });
});

// ── handleSendCommand ────────────────────────────────────────

describe('handleSendCommand', () => {
  let pool: pg.Pool;
  let tmux: TmuxManager;
  let recorder: EntryRecorder;

  beforeEach(() => {
    pool = mockPool();
    tmux = mockTmuxManager();
    recorder = mockEntryRecorder();

    const queryFn = pool.query as ReturnType<typeof vi.fn>;
    // resolveSessionPaneTarget: session lookup
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
    // resolveSessionPaneTarget: pane lookup
    queryFn.mockResolvedValueOnce({
      rows: [{ pane_id: 'pane-uuid', window_index: 0, pane_index: 0 }],
    });
  });

  it('sends command and returns output when marker is found', async () => {
    // Capture the marker that handleSendCommand generates, then return it in capturePane
    let capturedMarker = '';
    (tmux.sendKeys as ReturnType<typeof vi.fn>).mockImplementation(
      async (_sess: string, _win: number, _pane: number, keys: string) => {
        // Extract marker from the command string
        const match = keys.match(new RegExp(`(${COMMAND_MARKER_PREFIX}[a-f0-9]+)`));
        if (match) capturedMarker = match[1];
      },
    );

    const captureFn = tmux.capturePane as ReturnType<typeof vi.fn>;
    // Baseline capture
    captureFn.mockResolvedValueOnce('$\n');
    // Subsequent captures: return output with marker (after sendKeys sets it)
    captureFn.mockImplementation(async () => {
      if (capturedMarker) {
        return `$ echo hello\nhello\n${capturedMarker} EXIT_CODE:0\n`;
      }
      return '$\n';
    });

    const result = await handleSendCommand(
      { session_id: SESSION_ID, command: 'echo hello', timeout_s: 5, pane_id: '' },
      pool,
      tmux,
      recorder,
    );

    expect(tmux.sendKeys).toHaveBeenCalled();
    expect(result.timed_out).toBe(false);
    expect(typeof result.output).toBe('string');
  });

  it('returns timed_out when marker is not seen within timeout', async () => {
    const captureFn = tmux.capturePane as ReturnType<typeof vi.fn>;
    // Baseline capture
    captureFn.mockResolvedValueOnce('\n');
    // All subsequent captures: no marker
    captureFn.mockResolvedValue('$ long-running-cmd\nstill running...\n');

    const result = await handleSendCommand(
      { session_id: SESSION_ID, command: 'long-running-cmd', timeout_s: 1, pane_id: '' },
      pool,
      tmux,
      recorder,
    );

    expect(result.timed_out).toBe(true);
    expect(typeof result.output).toBe('string');
  });

  it('records command entry via EntryRecorder', async () => {
    let capturedMarker = '';
    (tmux.sendKeys as ReturnType<typeof vi.fn>).mockImplementation(
      async (_sess: string, _win: number, _pane: number, keys: string) => {
        const match = keys.match(new RegExp(`(${COMMAND_MARKER_PREFIX}[a-f0-9]+)`));
        if (match) capturedMarker = match[1];
      },
    );

    const captureFn = tmux.capturePane as ReturnType<typeof vi.fn>;
    captureFn.mockResolvedValueOnce('\n');
    captureFn.mockImplementation(async () => {
      if (capturedMarker) {
        return `hello\n${capturedMarker} EXIT_CODE:0\n`;
      }
      return '\n';
    });

    await handleSendCommand(
      { session_id: SESSION_ID, command: 'echo hello', timeout_s: 5, pane_id: '' },
      pool,
      tmux,
      recorder,
    );

    expect(recorder.record).toHaveBeenCalled();
    const recordCalls = (recorder.record as ReturnType<typeof vi.fn>).mock.calls;
    const commandEntries = recordCalls.filter(
      (call: unknown[]) => (call[0] as { kind: string }).kind === 'command',
    );
    expect(commandEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('uses default timeout when timeout_s is 0 but finds marker quickly', async () => {
    let capturedMarker = '';
    (tmux.sendKeys as ReturnType<typeof vi.fn>).mockImplementation(
      async (_sess: string, _win: number, _pane: number, keys: string) => {
        const match = keys.match(new RegExp(`(${COMMAND_MARKER_PREFIX}[a-f0-9]+)`));
        if (match) capturedMarker = match[1];
      },
    );

    const captureFn = tmux.capturePane as ReturnType<typeof vi.fn>;
    captureFn.mockResolvedValueOnce('\n');
    captureFn.mockImplementation(async () => {
      if (capturedMarker) {
        return `output\n${capturedMarker} EXIT_CODE:0\n`;
      }
      return '\n';
    });

    const result = await handleSendCommand(
      { session_id: SESSION_ID, command: 'ls', timeout_s: 0, pane_id: '' },
      pool,
      tmux,
      recorder,
    );

    expect(result.timed_out).toBe(false);
  });
});

// ── handleSendKeys ───────────────────────────────────────────

describe('handleSendKeys', () => {
  it('sends keys to the correct pane', async () => {
    const pool = mockPool();
    const tmux = mockTmuxManager();
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

    await handleSendKeys(
      { session_id: SESSION_ID, keys: 'C-c', pane_id: '' },
      pool,
      tmux,
    );

    expect(tmux.sendKeys).toHaveBeenCalledWith('oc-test', 0, 0, 'C-c');
  });

  it('throws when session not found', async () => {
    const pool = mockPool();
    const tmux = mockTmuxManager();
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    await expect(
      handleSendKeys({ session_id: SESSION_ID, keys: 'Enter', pane_id: '' }, pool, tmux),
    ).rejects.toThrow(/Session not found/);
  });
});

// ── handleCapturePane ────────────────────────────────────────

describe('handleCapturePane', () => {
  it('captures pane content and returns it', async () => {
    const pool = mockPool();
    const tmux = mockTmuxManager();
    const recorder = mockEntryRecorder();
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

    const result = await handleCapturePane(
      { session_id: SESSION_ID, pane_id: '', lines: 100 },
      pool,
      tmux,
      recorder,
    );

    expect(tmux.capturePane).toHaveBeenCalledWith('oc-test', 0, 0, 100);
    expect(result.content).toBe('captured content\n');
    expect(result.lines_captured).toBeGreaterThanOrEqual(1);
  });

  it('records scrollback entry via EntryRecorder', async () => {
    const pool = mockPool();
    const tmux = mockTmuxManager();
    const recorder = mockEntryRecorder();
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

    await handleCapturePane(
      { session_id: SESSION_ID, pane_id: '', lines: 50 },
      pool,
      tmux,
      recorder,
    );

    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: SESSION_ID,
        kind: 'scrollback',
      }),
    );
  });
});

// ── COMMAND_MARKER_PREFIX ────────────────────────────────────

describe('COMMAND_MARKER_PREFIX', () => {
  it('is a non-empty string prefix', () => {
    expect(typeof COMMAND_MARKER_PREFIX).toBe('string');
    expect(COMMAND_MARKER_PREFIX.length).toBeGreaterThan(0);
  });
});

// ── handleAttachSession (PTY-based) ─────────────────────────

/** Helper to create a mock gRPC duplex stream. */
function mockDuplexStream(): grpc.ServerDuplexStream<TerminalInput, TerminalOutput> & {
  _dataHandlers: Array<(input: TerminalInput) => void>;
  _emit: (event: string, ...args: unknown[]) => void;
  written: TerminalOutput[];
} {
  const dataHandlers: Array<(input: TerminalInput) => void> = [];
  const otherHandlers: Map<string, Array<(...args: unknown[]) => void>> = new Map();
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
    once: vi.fn((_event: string, _handler: (...args: unknown[]) => void) => stream),
    write: vi.fn((data: TerminalOutput) => { written.push(data); return true; }),
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

/** Set up pool mocks for session + pane resolution + dimension lookup. */
function setupPoolForAttach(pool: pg.Pool): void {
  const queryFn = pool.query as ReturnType<typeof vi.fn>;
  // resolveSessionPaneTarget: session lookup
  queryFn.mockResolvedValueOnce({
    rows: [{
      id: SESSION_ID,
      namespace: NAMESPACE,
      tmux_session_name: 'oc-test',
      status: 'active',
    }],
  });
  // resolveSessionPaneTarget: pane lookup
  queryFn.mockResolvedValueOnce({
    rows: [{ pane_id: 'pane-uuid', window_index: 0, pane_index: 0 }],
  });
  // Dimension lookup
  queryFn.mockResolvedValueOnce({
    rows: [{ cols: 80, rows: 24 }],
  });
}

describe('handleAttachSession (PTY-based)', () => {
  let pool: pg.Pool;
  let tmux: TmuxManager;
  let recorder: EntryRecorder;
  let stream: ReturnType<typeof mockDuplexStream>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPtyInstance = null;
    pool = mockPool();
    tmux = mockTmuxManager();
    recorder = mockEntryRecorder();
    stream = mockDuplexStream();
  });

  it('spawns PTY with tmux attach-session on first message', async () => {
    const { spawn } = await import('node-pty');
    setupPoolForAttach(pool);

    handleAttachSession(stream, pool, tmux, recorder);

    // Send first message with session_id
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    // Wait for async initialization
    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    expect(spawn).toHaveBeenCalledWith(
      'tmux',
      ['attach-session', '-t', 'oc-test'],
      expect.objectContaining({
        cols: 80,
        rows: 24,
        name: 'xterm-256color',
      }),
    );
  });

  it('sends attached event after PTY spawn', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(stream, pool, tmux, recorder);
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    const attachedEvent = stream.written.find(
      (w) => w.event?.type === 'status_change' && w.event?.message === 'attached',
    );
    expect(attachedEvent).toBeDefined();
  });

  it('forwards PTY output to gRPC stream', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(stream, pool, tmux, recorder);
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // Emit some PTY output
    mockPtyInstance!._emitData('hello world');

    const outputMsg = stream.written.find((w) => w.data !== undefined);
    expect(outputMsg).toBeDefined();
    expect(Buffer.from(outputMsg!.data!).toString()).toBe('hello world');
  });

  it('forwards gRPC input to PTY write', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(stream, pool, tmux, recorder);
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // Send keystroke
    stream._dataHandlers[0]({ session_id: '', data: Buffer.from('ls\r') });

    expect(mockPtyInstance!.write).toHaveBeenCalledWith('ls\r');
  });

  it('handles resize via pty.resize()', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(stream, pool, tmux, recorder);
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // Send resize
    stream._dataHandlers[0]({ session_id: '', resize: { cols: 120, rows: 40 } });

    expect(mockPtyInstance!.resize).toHaveBeenCalledWith(120, 40);
  });

  it('queues messages during initialization and replays them', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(stream, pool, tmux, recorder);

    // Send first message (triggers init)
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    // Send resize while still initializing (before PTY is ready)
    stream._dataHandlers[0]({ session_id: '', resize: { cols: 60, rows: 20 } });
    stream._dataHandlers[0]({ session_id: '', data: Buffer.from('hello') });

    // Wait for init to complete
    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // The resize should have been applied to PTY spawn dimensions
    const { spawn } = await import('node-pty');
    expect(spawn).toHaveBeenCalledWith(
      'tmux',
      expect.any(Array),
      expect.objectContaining({ cols: 60, rows: 20 }),
    );

    // Queued keystroke should have been replayed
    expect(mockPtyInstance!.write).toHaveBeenCalledWith('hello');
  });

  it('sends terminated event and ends stream on PTY exit', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(stream, pool, tmux, recorder);
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // Simulate PTY exit
    mockPtyInstance!._emitExit(0);

    const terminatedEvent = stream.written.find(
      (w) => w.event?.type === 'status_change' && w.event?.message === 'terminated',
    );
    expect(terminatedEvent).toBeDefined();
    expect(stream.end).toHaveBeenCalled();
  });

  it('records output via EntryRecorder', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(stream, pool, tmux, recorder);
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    mockPtyInstance!._emitData('some output');

    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: SESSION_ID,
        kind: 'output',
        content: 'some output',
        metadata: { source: 'pty_stream' },
      }),
    );
  });

  it('kills PTY on stream end', async () => {
    setupPoolForAttach(pool);

    handleAttachSession(stream, pool, tmux, recorder);
    stream._dataHandlers[0]({ session_id: SESSION_ID });

    await vi.waitFor(() => expect(mockPtyInstance).not.toBeNull());

    // Trigger stream end
    stream._emit('end');

    expect(mockPtyInstance!.kill).toHaveBeenCalled();
  });

  it('emits error when session_id missing from first message', () => {
    handleAttachSession(stream, pool, tmux, recorder);

    stream._dataHandlers[0]({ session_id: '' });

    expect(stream.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ code: grpc.status.INVALID_ARGUMENT }),
    );
  });
});
