/**
 * Tests for YjsDocManager.
 * Part of Issue #2256
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

// Mock the notes service
vi.mock('../../src/api/notes/service.ts', () => ({
  userCanAccessNote: vi.fn().mockResolvedValue(true),
}));

// Mock the realtime hub
vi.mock('../../src/api/realtime/hub.ts', () => ({
  getRealtimeHub: vi.fn().mockReturnValue({
    emit: vi.fn().mockResolvedValue(undefined),
    sendToClient: vi.fn().mockReturnValue(true),
  }),
}));

import { YjsDocManager } from '../../src/api/realtime/yjs-doc-manager.ts';
import { userCanAccessNote } from '../../src/api/notes/service.ts';

function createMockPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn(),
  };
}

describe('YjsDocManager', () => {
  let manager: YjsDocManager;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(userCanAccessNote).mockResolvedValue(true);
    mockPool = createMockPool();
    mockPool.query.mockResolvedValue({ rows: [{ yjs_state: null, content: '' }], rowCount: 1 });
    manager = new YjsDocManager(mockPool as never);
  });

  afterEach(async () => {
    await manager.shutdown();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('joinRoom', () => {
    it('creates a new doc for a note on first join', async () => {
      await manager.joinRoom('client-1', 'user@test.com', 'note-uuid-1');
      expect(manager.getDocCount()).toBe(1);
      expect(manager.getClientRooms('client-1')).toContain('note-uuid-1');
    });

    it('rejects join if user lacks access', async () => {
      vi.mocked(userCanAccessNote).mockResolvedValueOnce(false);

      await expect(
        manager.joinRoom('client-1', 'user@test.com', 'note-uuid-1'),
      ).rejects.toThrow('Access denied');
    });

    it('loads existing yjs_state from DB', async () => {
      const doc = new Y.Doc();
      const text = doc.getText('content');
      text.insert(0, 'existing content');
      const state = Y.encodeStateAsUpdate(doc);
      doc.destroy();

      mockPool.query.mockResolvedValueOnce({
        rows: [{ yjs_state: Buffer.from(state), content: 'existing content' }],
        rowCount: 1,
      });

      await manager.joinRoom('client-1', 'user@test.com', 'note-uuid-1');
      expect(manager.getDocCount()).toBe(1);
    });

    it('allows multiple clients in the same room', async () => {
      await manager.joinRoom('client-1', 'user1@test.com', 'note-uuid-1');
      await manager.joinRoom('client-2', 'user2@test.com', 'note-uuid-1');

      expect(manager.getRoomClientCount('note-uuid-1')).toBe(2);
    });

    it('reuses existing doc for same note', async () => {
      await manager.joinRoom('client-1', 'user1@test.com', 'note-uuid-1');
      await manager.joinRoom('client-2', 'user2@test.com', 'note-uuid-1');

      // Only one doc created
      expect(manager.getDocCount()).toBe(1);
      // Only one DB query for loading the doc (second join reuses)
      const loadCalls = mockPool.query.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('SELECT yjs_state'),
      );
      expect(loadCalls.length).toBe(1);
    });

    it('throws for non-existent note', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(
        manager.joinRoom('client-1', 'user@test.com', 'missing-note'),
      ).rejects.toThrow('Note not found');
    });
  });

  describe('leaveRoom', () => {
    it('removes client from room', async () => {
      await manager.joinRoom('client-1', 'user@test.com', 'note-uuid-1');
      await manager.leaveRoom('client-1', 'note-uuid-1');

      expect(manager.getClientRooms('client-1')).not.toContain('note-uuid-1');
    });

    it('persists immediately when last client leaves', async () => {
      // Set up doc with some dirty state
      await manager.joinRoom('client-1', 'user@test.com', 'note-uuid-1');
      manager.markDirty('note-uuid-1');

      // Reset mock to track persist calls
      mockPool.query.mockClear();
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await manager.leaveRoom('client-1', 'note-uuid-1');

      // Should have called persist
      const persistCalls = mockPool.query.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE note SET'),
      );
      expect(persistCalls.length).toBeGreaterThan(0);
    });

    it('does not persist if doc is not dirty', async () => {
      await manager.joinRoom('client-1', 'user@test.com', 'note-uuid-1');
      mockPool.query.mockClear();
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await manager.leaveRoom('client-1', 'note-uuid-1');

      const persistCalls = mockPool.query.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE note SET'),
      );
      expect(persistCalls.length).toBe(0);
    });

    it('handles leaving non-existent room gracefully', async () => {
      await expect(manager.leaveRoom('client-1', 'unknown')).resolves.not.toThrow();
    });
  });

  describe('leaveAllRooms', () => {
    it('removes client from all rooms', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ yjs_state: null, content: '' }],
        rowCount: 1,
      });

      await manager.joinRoom('client-1', 'user@test.com', 'note-1');
      await manager.joinRoom('client-1', 'user@test.com', 'note-2');

      expect(manager.getClientRooms('client-1').length).toBe(2);

      await manager.leaveAllRooms('client-1');

      expect(manager.getClientRooms('client-1').length).toBe(0);
    });
  });

  describe('isClientInRoom', () => {
    it('returns false for unknown clients', () => {
      expect(manager.isClientInRoom('unknown', 'note-1')).toBe(false);
    });

    it('returns true for clients in room', async () => {
      await manager.joinRoom('client-1', 'user@test.com', 'note-1');
      expect(manager.isClientInRoom('client-1', 'note-1')).toBe(true);
    });
  });

  describe('hasActiveDoc', () => {
    it('returns false for unknown notes', () => {
      expect(manager.hasActiveDoc('unknown-id')).toBe(false);
    });

    it('returns true for active notes', async () => {
      await manager.joinRoom('client-1', 'user@test.com', 'note-uuid-1');
      expect(manager.hasActiveDoc('note-uuid-1')).toBe(true);
    });
  });

  describe('getDoc', () => {
    it('returns null for unknown notes', () => {
      expect(manager.getDoc('unknown')).toBeNull();
    });

    it('returns doc for active notes', async () => {
      await manager.joinRoom('client-1', 'user@test.com', 'note-uuid-1');
      const doc = manager.getDoc('note-uuid-1');
      expect(doc).not.toBeNull();
      expect(doc).toBeInstanceOf(Y.Doc);
    });
  });

  describe('markDirty and persistence', () => {
    it('debounces persistence', async () => {
      await manager.joinRoom('client-1', 'user@test.com', 'note-uuid-1');
      mockPool.query.mockClear();
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      manager.markDirty('note-uuid-1');

      // No persist yet (debounce not elapsed)
      const callsBeforeDebounce = mockPool.query.mock.calls.length;
      expect(callsBeforeDebounce).toBe(0);

      // Advance past debounce
      vi.advanceTimersByTime(11_000);

      // Flush promise
      await vi.runAllTimersAsync();

      const persistCalls = mockPool.query.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE note SET'),
      );
      expect(persistCalls.length).toBeGreaterThan(0);
    });
  });

  describe('shutdown', () => {
    it('clears all docs and rooms', async () => {
      await manager.joinRoom('client-1', 'user@test.com', 'note-uuid-1');
      await manager.shutdown();

      expect(manager.getDocCount()).toBe(0);
      expect(manager.getClientRooms('client-1').length).toBe(0);
    });
  });
});
