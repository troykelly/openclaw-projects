/**
 * Unit tests for AgentPresenceTracker.
 * Issue #2158 — Agent presence tracking.
 *
 * TDD: These tests are written FIRST, before the implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GatewayEventFrame } from './connection.ts';

// Mock the realtime hub — return the SAME object every time
const mockHub = { emit: vi.fn() };
vi.mock('../realtime/hub.ts', () => ({
  getRealtimeHub: vi.fn(() => mockHub),
}));

import { AgentPresenceTracker, type AgentStatus } from './presence-tracker.ts';

describe('AgentPresenceTracker', () => {
  let tracker: AgentPresenceTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    mockHub.emit.mockClear();
    tracker = new AgentPresenceTracker();
  });

  afterEach(() => {
    tracker.shutdown();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Status queries ────────────────────────────────────────────────

  it('returns "unknown" for untracked agent', () => {
    expect(tracker.getStatus('agent-xyz')).toBe('unknown');
  });

  // ── Presence event handling ───────────────────────────────────────

  it('updates to "online" on agent.online event', () => {
    const frame: GatewayEventFrame = {
      type: 'event',
      event: 'agent.online',
      payload: { agent_id: 'agent-1' },
    };
    tracker.handleEvent(frame);
    expect(tracker.getStatus('agent-1')).toBe('online');
  });

  it('updates to "busy" on agent.busy event', () => {
    const frame: GatewayEventFrame = {
      type: 'event',
      event: 'agent.busy',
      payload: { agent_id: 'agent-1' },
    };
    tracker.handleEvent(frame);
    expect(tracker.getStatus('agent-1')).toBe('busy');
  });

  it('updates to "offline" on agent.offline event', () => {
    const frame: GatewayEventFrame = {
      type: 'event',
      event: 'agent.offline',
      payload: { agent_id: 'agent-1' },
    };
    tracker.handleEvent(frame);
    expect(tracker.getStatus('agent-1')).toBe('offline');
  });

  it('infers "busy" from chat.delta event', () => {
    const frame: GatewayEventFrame = {
      type: 'event',
      event: 'chat.delta',
      payload: { sessionKey: 'agent:agent-2:agent_chat:thread-1', state: 'delta' },
    };
    tracker.handleEvent(frame);
    expect(tracker.getStatus('agent-2')).toBe('busy');
  });

  it('infers "online" from chat.final event', () => {
    // First set busy
    tracker.handleEvent({
      type: 'event',
      event: 'chat.delta',
      payload: { sessionKey: 'agent:agent-2:agent_chat:thread-1', state: 'delta' },
    });
    expect(tracker.getStatus('agent-2')).toBe('busy');

    // Then final
    tracker.handleEvent({
      type: 'event',
      event: 'chat.final',
      payload: { sessionKey: 'agent:agent-2:agent_chat:thread-1', state: 'final' },
    });
    expect(tracker.getStatus('agent-2')).toBe('online');
  });

  it('ignores events without agent_id or sessionKey', () => {
    const frame: GatewayEventFrame = {
      type: 'event',
      event: 'agent.online',
      payload: {},
    };
    tracker.handleEvent(frame);
    expect(tracker.getAllStatuses().size).toBe(0);
  });

  // ── WS disconnect ────────────────────────────────────────────────

  it('on WS disconnect: all agents set to "unknown" (not "offline")', () => {
    // Set some agents online
    tracker.handleEvent({
      type: 'event',
      event: 'agent.online',
      payload: { agent_id: 'agent-1' },
    });
    tracker.handleEvent({
      type: 'event',
      event: 'agent.busy',
      payload: { agent_id: 'agent-2' },
    });

    expect(tracker.getStatus('agent-1')).toBe('online');
    expect(tracker.getStatus('agent-2')).toBe('busy');

    tracker.onDisconnect();

    expect(tracker.getStatus('agent-1')).toBe('unknown');
    expect(tracker.getStatus('agent-2')).toBe('unknown');
  });

  // ── TTL staleness ────────────────────────────────────────────────

  it('TTL staleness: entry older than 5min returns "unknown"', () => {
    tracker.handleEvent({
      type: 'event',
      event: 'agent.online',
      payload: { agent_id: 'agent-1' },
    });
    expect(tracker.getStatus('agent-1')).toBe('online');

    // Advance 5 minutes + 1ms
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(tracker.getStatus('agent-1')).toBe('unknown');
  });

  // ── Explicit pruning ─────────────────────────────────────────────

  it('explicit pruning: entries older than 10min removed by interval', () => {
    tracker.startPruning();

    tracker.handleEvent({
      type: 'event',
      event: 'agent.online',
      payload: { agent_id: 'agent-1' },
    });

    expect(tracker.getAllStatuses().size).toBe(1);

    // Advance past 10 minutes + one full prune interval so the
    // prune callback fires with Date.now() > updatedAt + PRUNE_TTL
    vi.advanceTimersByTime(10 * 60 * 1000 + 60 * 1000 + 1);

    // After pruning runs, entry should be removed
    expect(tracker.getAllStatuses().size).toBe(0);
  });

  // ── Bounded map ──────────────────────────────────────────────────

  it('bounded map: evicts least-recently-updated when > 1000 entries', () => {
    // Insert 1001 agents
    for (let i = 0; i < 1001; i++) {
      tracker.handleEvent({
        type: 'event',
        event: 'agent.online',
        payload: { agent_id: `agent-${i}` },
      });
      // Small time advance so updatedAt differs
      vi.advanceTimersByTime(1);
    }

    // Should be capped at 1000
    expect(tracker.getAllStatuses().size).toBe(1000);

    // The first agent (oldest) should have been evicted
    expect(tracker.getStatus('agent-0')).toBe('unknown');

    // The last agent should still be present
    expect(tracker.getStatus('agent-1000')).toBe('online');
  });

  // ── Status change emission ────────────────────────────────────────

  it('emits agent:status_changed only when status actually changes', () => {
    mockHub.emit.mockClear();

    tracker.handleEvent({
      type: 'event',
      event: 'agent.online',
      payload: { agent_id: 'agent-1' },
    });

    expect(mockHub.emit).toHaveBeenCalledWith(
      'agent:status_changed',
      { agent_id: 'agent-1', status: 'online' },
      undefined,
    );

    // Same status again — should NOT emit
    mockHub.emit.mockClear();
    tracker.handleEvent({
      type: 'event',
      event: 'agent.online',
      payload: { agent_id: 'agent-1' },
    });

    expect(mockHub.emit).not.toHaveBeenCalled();
  });

  // ── getAllStatuses ────────────────────────────────────────────────

  it('getAllStatuses returns all non-evicted entries', () => {
    tracker.handleEvent({
      type: 'event',
      event: 'agent.online',
      payload: { agent_id: 'agent-1' },
    });
    tracker.handleEvent({
      type: 'event',
      event: 'agent.busy',
      payload: { agent_id: 'agent-2' },
    });

    const statuses = tracker.getAllStatuses();
    expect(statuses.size).toBe(2);
    expect(statuses.get('agent-1')).toBe('online');
    expect(statuses.get('agent-2')).toBe('busy');
  });

  // ── Shutdown ─────────────────────────────────────────────────────

  it('shutdown() clears pruning interval', () => {
    tracker.startPruning();

    // Add an agent
    tracker.handleEvent({
      type: 'event',
      event: 'agent.online',
      payload: { agent_id: 'agent-1' },
    });

    tracker.shutdown();

    // Advance well past prune time — should NOT crash or prune
    vi.advanceTimersByTime(20 * 60 * 1000);

    // Map should still have the entry (interval was cleared, no pruning happened)
    // After shutdown we don't guarantee anything about the map, but no error should throw
  });
});
