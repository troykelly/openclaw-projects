/**
 * Unit tests for GatewayEventRouter.
 * Issue #2156 — Agent response event router.
 *
 * TDD: These tests are written FIRST, before the implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { GatewayEventFrame, GatewayEventHandler } from './connection.ts';

// ── Mocks ────────────────────────────────────────────────────────────

// Mock pool for DB queries
function createMockPool() {
  return {
    query: vi.fn(),
  };
}

// Mock RealtimeHub
const mockEmit = vi.fn().mockResolvedValue(undefined);
const mockSendToUser = vi.fn().mockReturnValue(1);

vi.mock('../realtime/hub.ts', () => ({
  getRealtimeHub: () => ({
    emit: mockEmit,
    sendToUser: mockSendToUser,
  }),
  RealtimeHub: vi.fn(),
  resetRealtimeHub: vi.fn(),
}));

// Capture registered event handlers from GatewayConnectionService
let capturedHandlers: GatewayEventHandler[] = [];
const mockOnEvent = vi.fn((handler: GatewayEventHandler) => {
  capturedHandlers.push(handler);
});

vi.mock('./index.ts', () => ({
  getGatewayConnection: () => ({
    onEvent: mockOnEvent,
  }),
}));

// Import after mocks
import { GatewayEventRouter } from './event-router.ts';
import { gwChatEventsRouted, gwDuplicateEventsSuppressed } from './metrics.ts';

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a ChatEvent gateway frame. */
function makeChatEvent(overrides: Partial<{
  runId: string;
  sessionKey: string;
  seq: number;
  state: string;
  message: unknown;
  errorMessage: string;
  stopReason: string;
}> = {}): GatewayEventFrame {
  return {
    type: 'event',
    event: 'chat',
    payload: {
      runId: overrides.runId ?? 'run-1',
      sessionKey: overrides.sessionKey ?? 'agent:agent-1:agent_chat:thread-1',
      seq: overrides.seq ?? 0,
      state: overrides.state ?? 'delta',
      message: overrides.message ?? 'hello',
      errorMessage: overrides.errorMessage,
      stopReason: overrides.stopReason,
    },
  };
}

/** Simulate a valid chat_session row for the given agent/thread. */
function mockSessionLookup(pool: ReturnType<typeof createMockPool>, session: {
  id?: string;
  thread_id?: string;
  user_email?: string;
  agent_id?: string;
  status?: string;
}) {
  pool.query.mockResolvedValue({
    rows: [{
      id: session.id ?? 'session-1',
      thread_id: session.thread_id ?? 'thread-1',
      user_email: session.user_email ?? 'user@example.com',
      agent_id: session.agent_id ?? 'agent-1',
      status: session.status ?? 'active',
    }],
  });
}

/** Simulate no session found. */
function mockSessionNotFound(pool: ReturnType<typeof createMockPool>) {
  pool.query.mockResolvedValue({ rows: [] });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('GatewayEventRouter', () => {
  let router: GatewayEventRouter;
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandlers = [];
    pool = createMockPool();
    router = new GatewayEventRouter();
  });

  afterEach(() => {
    router.shutdown();
  });

  // ── Registration ─────────────────────────────────────────────────

  it('registers with GatewayConnectionService.onEvent on initialization', () => {
    router.initialize(pool as never);
    expect(mockOnEvent).toHaveBeenCalledTimes(1);
    expect(capturedHandlers).toHaveLength(1);
  });

  it('ignores non-chat events', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    // Send a non-chat event
    handler({ type: 'event', event: 'agents.status', payload: {} });

    // No DB lookup should happen
    expect(pool.query).not.toHaveBeenCalled();
  });

  // ── Validation ───────────────────────────────────────────────────

  it('validates sessionKey: discards event if thread_id not found in DB', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockSessionNotFound(pool);

    handler(makeChatEvent());

    // Wait for async processing
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });

    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('validates sessionKey: discards event if agent_id mismatch with DB', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // DB says agent_id is 'agent-2' but event says 'agent-1'
    mockSessionLookup(pool, { agent_id: 'agent-2' });

    handler(makeChatEvent({ sessionKey: 'agent:agent-1:agent_chat:thread-1' }));

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });

    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('uses user_email from DB — not from event payload', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    // DB returns user_email = 'db-user@example.com'
    mockSessionLookup(pool, { user_email: 'db-user@example.com' });

    handler(makeChatEvent({ state: 'delta', message: 'chunk text' }));

    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalled();
    });

    // Verify the first arg to sendToUser is the DB email
    expect(mockSendToUser).toHaveBeenCalledWith(
      'db-user@example.com',
      expect.objectContaining({ event: 'stream:chunk' }),
    );
  });

  it('invalid sessionKey format: logs and discards without crashing', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Invalid sessionKey format (missing parts)
    handler(makeChatEvent({ sessionKey: 'invalid-key' }));

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });

    expect(mockSendToUser).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('expired/ended session: discarded with WARN log', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockSessionLookup(pool, { status: 'ended' });

    handler(makeChatEvent());

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });

    expect(mockSendToUser).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ── Delta events ─────────────────────────────────────────────────

  it('delta: routes stream:chunk to RealtimeHub with correct session user', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    mockSessionLookup(pool, { user_email: 'user@example.com' });

    handler(makeChatEvent({ state: 'delta', seq: 0, message: 'hello ' }));

    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalledWith(
        'user@example.com',
        expect.objectContaining({
          event: 'stream:chunk',
          data: expect.objectContaining({
            session_id: 'session-1',
            seq: 0,
            content: 'hello ',
          }),
        }),
      );
    });
  });

  it('delta: does NOT write to DB (only session lookup)', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    mockSessionLookup(pool, {});

    handler(makeChatEvent({ state: 'delta', message: 'chunk' }));

    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalled();
    });

    // Only the session lookup query, no insert or update
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('SELECT');
  });

  it('delta: includes seq and content in event payload', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    mockSessionLookup(pool, {});

    handler(makeChatEvent({ state: 'delta', seq: 5, message: 'content text' }));

    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          data: expect.objectContaining({
            seq: 5,
            content: 'content text',
          }),
        }),
      );
    });
  });

  it('delta: skips already-seen seq (duplicate delta)', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    mockSessionLookup(pool, {});

    // Send seq 0
    handler(makeChatEvent({ state: 'delta', seq: 0, message: 'first' }));
    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalledTimes(1);
    });

    // Reset DB mock to return same session
    mockSessionLookup(pool, {});

    // Send seq 0 again (duplicate)
    handler(makeChatEvent({ state: 'delta', seq: 0, message: 'duplicate' }));

    // Give some time for async processing
    await new Promise((r) => setTimeout(r, 50));

    // Should still be 1 (duplicate was skipped)
    expect(mockSendToUser).toHaveBeenCalledTimes(1);
  });

  // ── Final events ─────────────────────────────────────────────────

  it('final: persists to external_message with ON CONFLICT DO NOTHING', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    // First call: session lookup
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'session-1',
        thread_id: 'thread-1',
        user_email: 'user@example.com',
        agent_id: 'agent-1',
        status: 'active',
      }],
    });
    // Second call: insert external_message
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'msg-1' }],
    });
    // Third call: update chat_session
    pool.query.mockResolvedValueOnce({ rows: [] });

    handler(makeChatEvent({ state: 'final', message: 'full response', runId: 'run-42' }));

    await vi.waitFor(() => {
      // Check the insert query includes ON CONFLICT
      const insertCall = pool.query.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO external_message'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![0]).toContain('ON CONFLICT');
      expect(insertCall![0]).toContain('DO NOTHING');
    });
  });

  it('final: emits chat:message_received to RealtimeHub', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'session-1', thread_id: 'thread-1', user_email: 'user@example.com',
        agent_id: 'agent-1', status: 'active',
      }],
    });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    handler(makeChatEvent({ state: 'final', message: 'done' }));

    await vi.waitFor(() => {
      expect(mockEmit).toHaveBeenCalledWith(
        'chat:message_received',
        expect.objectContaining({ session_id: 'session-1' }),
        'user@example.com',
      );
    });
  });

  it('final: updates chat_session.last_activity_at', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'session-1', thread_id: 'thread-1', user_email: 'user@example.com',
        agent_id: 'agent-1', status: 'active',
      }],
    });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    handler(makeChatEvent({ state: 'final', message: 'done' }));

    await vi.waitFor(() => {
      const updateCall = pool.query.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE chat_session'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0]).toContain('last_activity_at');
    });
  });

  it('final: sets agent_run_id and direction=inbound', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'session-1', thread_id: 'thread-1', user_email: 'user@example.com',
        agent_id: 'agent-1', status: 'active',
      }],
    });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    handler(makeChatEvent({ state: 'final', message: 'done', runId: 'run-99' }));

    await vi.waitFor(() => {
      const insertCall = pool.query.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO external_message'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![0]).toContain('inbound');
      // Check params include runId
      expect(insertCall![1]).toContain('run-99');
    });
  });

  it('final: second identical final event is safe (dedup)', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    // First final event
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'session-1', thread_id: 'thread-1', user_email: 'user@example.com',
        agent_id: 'agent-1', status: 'active',
      }],
    });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    handler(makeChatEvent({ state: 'final', message: 'done', runId: 'run-1' }));
    await vi.waitFor(() => {
      expect(mockEmit).toHaveBeenCalledTimes(1);
    });

    // Second identical final event — insert returns no rows (conflict)
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'session-1', thread_id: 'thread-1', user_email: 'user@example.com',
        agent_id: 'agent-1', status: 'active',
      }],
    });
    pool.query.mockResolvedValueOnce({ rows: [] }); // ON CONFLICT DO NOTHING → no rows returned

    handler(makeChatEvent({ state: 'final', message: 'done', runId: 'run-1' }));

    // Should not crash, and emit should NOT be called again (dedup skips notification)
    await new Promise((r) => setTimeout(r, 50));
    expect(mockEmit).toHaveBeenCalledTimes(1); // Still only 1 from first final
  });

  // ── Aborted events ───────────────────────────────────────────────

  it('aborted: emits stream:aborted event without DB write', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    mockSessionLookup(pool, {});

    handler(makeChatEvent({ state: 'aborted', runId: 'run-5' }));

    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalledWith(
        'user@example.com',
        expect.objectContaining({
          event: 'stream:aborted',
          data: expect.objectContaining({
            session_id: 'session-1',
            run_id: 'run-5',
          }),
        }),
      );
    });

    // Only session lookup, no insert or update
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  // ── Error events ─────────────────────────────────────────────────

  it('error: emits stream:failed with sanitized error (not raw gateway error)', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    mockSessionLookup(pool, {});

    handler(makeChatEvent({
      state: 'error',
      runId: 'run-err',
      errorMessage: 'Internal server error at /gateway/internal/process.ts:42',
    }));

    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalledWith(
        'user@example.com',
        expect.objectContaining({
          event: 'stream:failed',
          data: expect.objectContaining({
            session_id: 'session-1',
            run_id: 'run-err',
            error: expect.any(String),
          }),
        }),
      );
    });
  });

  it('error: truncates long error messages', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    mockSessionLookup(pool, {});

    const longError = 'A'.repeat(500);
    handler(makeChatEvent({ state: 'error', errorMessage: longError }));

    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalled();
    });

    const data = mockSendToUser.mock.calls[0][1].data as { error: string };
    expect(data.error.length).toBeLessThanOrEqual(200);
  });

  // ── Edge cases ───────────────────────────────────────────────────

  it('unknown sessionKey: logged at WARN, no crash', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockSessionNotFound(pool);

    // Should not throw
    handler(makeChatEvent({ sessionKey: 'agent:unknown-agent:agent_chat:unknown-thread' }));

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });

    warnSpy.mockRestore();
  });

  it('seq gap: logged at WARN, continues processing', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockSessionLookup(pool, {});
    handler(makeChatEvent({ state: 'delta', seq: 0, message: 'a' }));
    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalledTimes(1);
    });

    // Reset mock for second lookup
    mockSessionLookup(pool, {});

    // Seq gap: skip seq 1, send seq 3
    handler(makeChatEvent({ state: 'delta', seq: 3, message: 'c' }));

    await vi.waitFor(() => {
      // Should warn about gap but still process
      expect(warnSpy).toHaveBeenCalled();
      expect(mockSendToUser).toHaveBeenCalledTimes(2);
    });

    warnSpy.mockRestore();
  });

  it('DB error in final: logged, does not crash event loop', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Session lookup succeeds
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'session-1', thread_id: 'thread-1', user_email: 'user@example.com',
        agent_id: 'agent-1', status: 'active',
      }],
    });
    // Insert fails with DB error
    pool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    // Should not throw
    handler(makeChatEvent({ state: 'final', message: 'done' }));

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalled();
    });

    errorSpy.mockRestore();
  });

  it('handler errors do not crash the event router', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    // Make pool.query throw synchronously
    pool.query.mockImplementation(() => {
      throw new Error('Unexpected sync error');
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Should not throw
    expect(() => handler(makeChatEvent())).not.toThrow();

    await new Promise((r) => setTimeout(r, 50));
    errorSpy.mockRestore();
  });

  it('per-session tracker cleaned up after final/aborted/error', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    // Send delta to create tracker
    mockSessionLookup(pool, {});
    handler(makeChatEvent({ state: 'delta', seq: 0, runId: 'run-1', message: 'a' }));
    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalledTimes(1);
    });

    // Now send final — should clean up tracker
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'session-1', thread_id: 'thread-1', user_email: 'user@example.com',
        agent_id: 'agent-1', status: 'active',
      }],
    });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    handler(makeChatEvent({ state: 'final', runId: 'run-1', message: 'done' }));
    await vi.waitFor(() => {
      expect(mockEmit).toHaveBeenCalled();
    });

    // The internal tracker should be cleaned — verify by checking activeTrackers count
    expect(router.getActiveTrackerCount()).toBe(0);
  });

  it('per-session tracker TTL: removed after 10 minutes', async () => {
    vi.useFakeTimers();

    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    mockSessionLookup(pool, {});
    handler(makeChatEvent({ state: 'delta', seq: 0, runId: 'run-ttl', message: 'a' }));

    // Wait for async processing
    await vi.advanceTimersByTimeAsync(50);

    expect(router.getActiveTrackerCount()).toBe(1);

    // Advance past 10 min TTL
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);

    expect(router.getActiveTrackerCount()).toBe(0);

    vi.useRealTimers();
  });

  // ── Codex review fixes ───────────────────────────────────────────

  it('initialize is idempotent: second call does not register duplicate handler', () => {
    router.initialize(pool as never);
    router.initialize(pool as never); // second call
    expect(mockOnEvent).toHaveBeenCalledTimes(1);
  });

  it('final: no emit when insert conflicts (dedup returns no rows)', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    // Session lookup
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'session-1', thread_id: 'thread-1', user_email: 'user@example.com',
        agent_id: 'agent-1', status: 'active',
      }],
    });
    // Insert returns 0 rows (conflict)
    pool.query.mockResolvedValueOnce({ rows: [] });

    handler(makeChatEvent({ state: 'final', message: 'done', runId: 'run-dup' }));

    await new Promise((r) => setTimeout(r, 50));

    // No emit should happen
    expect(mockEmit).not.toHaveBeenCalled();
    // No session update should happen (early return before update)
    expect(pool.query).toHaveBeenCalledTimes(2); // lookup + insert only
  });

  it('rejects invalid payload: missing runId', () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handler({
      type: 'event',
      event: 'chat',
      payload: { sessionKey: 'agent:a:agent_chat:t', seq: 0, state: 'delta' },
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('runId'));
    expect(pool.query).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('rejects invalid payload: non-object payload', () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handler({ type: 'event', event: 'chat', payload: 'not-an-object' });

    expect(warnSpy).toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('late delta after terminal state is silently discarded', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];

    // Send aborted event to terminate the run
    mockSessionLookup(pool, {});
    handler(makeChatEvent({ state: 'aborted', runId: 'run-term' }));
    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalledTimes(1); // aborted event sent
    });

    // Now send a late delta for the same run
    mockSessionLookup(pool, {});
    handler(makeChatEvent({ state: 'delta', seq: 99, runId: 'run-term', message: 'late' }));

    await new Promise((r) => setTimeout(r, 50));

    // Should still only have 1 sendToUser call (the aborted one), no delta sent
    expect(mockSendToUser).toHaveBeenCalledTimes(1);
  });

  // ── Metrics integration (#2164) ──────────────────────────────────

  it('gwChatEventsRouted increments on each routed chat event', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];
    mockSessionLookup(pool, {});

    const before = gwChatEventsRouted.get();
    handler(makeChatEvent({ state: 'delta', seq: 0, message: 'hi' }));

    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalled();
    });

    expect(gwChatEventsRouted.get()).toBe(before + 1);
  });

  it('gwDuplicateEventsSuppressed increments on duplicate seq', async () => {
    router.initialize(pool as never);
    const handler = capturedHandlers[0];
    mockSessionLookup(pool, {});

    // First delta with seq=0
    handler(makeChatEvent({ state: 'delta', seq: 0, runId: 'run-dedup', message: 'first' }));
    await vi.waitFor(() => {
      expect(mockSendToUser).toHaveBeenCalledTimes(1);
    });

    const before = gwDuplicateEventsSuppressed.get();

    // Duplicate delta with same seq=0
    mockSessionLookup(pool, {});
    handler(makeChatEvent({ state: 'delta', seq: 0, runId: 'run-dedup', message: 'duplicate' }));

    // Small delay for async processing
    await new Promise((r) => setTimeout(r, 50));

    expect(gwDuplicateEventsSuppressed.get()).toBe(before + 1);
    // Still only one sendToUser call (duplicate was suppressed)
    expect(mockSendToUser).toHaveBeenCalledTimes(1);
  });
});
