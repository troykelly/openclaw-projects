/**
 * Tests for terminal I/O handlers: AttachSession, SendCommand, SendKeys, CapturePane.
 * Issues #1848, #1849 — Terminal I/O streaming and command execution RPCs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  handleSendCommand,
  handleSendKeys,
  handleCapturePane,
  resolveSessionPaneTarget,
  COMMAND_MARKER_PREFIX,
} from './terminal-io.ts';
import type { TmuxManager } from './tmux/manager.ts';
import type pg from 'pg';
import type { EntryRecorder } from './entry-recorder.ts';

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
          tmux_session_name: 'oc-test',
          status: 'active',
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
      tmuxSessionName: 'oc-test',
      windowIndex: 0,
      paneIndex: 0,
      paneId: 'pane-uuid',
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
