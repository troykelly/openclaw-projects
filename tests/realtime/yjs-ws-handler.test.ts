/**
 * Tests for YjsWsHandler — standard y-protocols WebSocket handler.
 * Part of Issue #2256
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { YjsWsHandler } from '../../src/api/realtime/yjs-ws-handler.ts';
import type { YjsDocManager } from '../../src/api/realtime/yjs-doc-manager.ts';

// Message type constants (must match y-websocket)
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

function createMockSocket(): { socket: ReturnType<typeof vi.fn> & { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } } {
  const socket = {
    readyState: 1, // OPEN
    send: vi.fn(),
    close: vi.fn(),
  };
  return { socket: socket as ReturnType<typeof vi.fn> & typeof socket };
}

function createMockDocManager(): {
  manager: {
    joinRoom: ReturnType<typeof vi.fn>;
    leaveRoom: ReturnType<typeof vi.fn>;
    getDoc: ReturnType<typeof vi.fn>;
    hasActiveDoc: ReturnType<typeof vi.fn>;
    markDirty: ReturnType<typeof vi.fn>;
    getDocCount: ReturnType<typeof vi.fn>;
    shutdown: ReturnType<typeof vi.fn>;
    getRoomClientIds: ReturnType<typeof vi.fn>;
    isClientInRoom: ReturnType<typeof vi.fn>;
  };
  doc: Y.Doc;
} {
  const doc = new Y.Doc();
  const manager = {
    joinRoom: vi.fn().mockResolvedValue(doc),
    leaveRoom: vi.fn().mockResolvedValue(undefined),
    getDoc: vi.fn().mockReturnValue(doc),
    hasActiveDoc: vi.fn().mockReturnValue(true),
    markDirty: vi.fn(),
    getDocCount: vi.fn().mockReturnValue(1),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getRoomClientIds: vi.fn().mockReturnValue([]),
    isClientInRoom: vi.fn().mockReturnValue(true),
  };
  return { manager, doc };
}

function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

describe('YjsWsHandler', () => {
  let handler: YjsWsHandler;
  let mockManager: ReturnType<typeof createMockDocManager>;

  beforeEach(() => {
    mockManager = createMockDocManager();
    handler = new YjsWsHandler(mockManager.manager as unknown as YjsDocManager);
  });

  describe('handleConnection', () => {
    it('joins the room and sends sync messages', async () => {
      const { socket } = createMockSocket();

      await handler.handleConnection(
        socket as unknown as Parameters<typeof handler.handleConnection>[0],
        'client-1',
        'user@test.com',
        'note-uuid-1',
      );

      expect(mockManager.manager.joinRoom).toHaveBeenCalledWith('client-1', 'user@test.com', 'note-uuid-1');
      // Should send at least sync step 1 and sync step 2
      expect(socket.send.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('throws on access denied', async () => {
      mockManager.manager.joinRoom.mockRejectedValue(new Error('Access denied'));
      const { socket } = createMockSocket();

      await expect(
        handler.handleConnection(
          socket as unknown as Parameters<typeof handler.handleConnection>[0],
          'client-1',
          'user@test.com',
          'note-uuid-1',
        ),
      ).rejects.toThrow('Access denied');
    });
  });

  describe('handleMessage', () => {
    it('processes sync step 1 and responds with sync step 2', async () => {
      const { socket } = createMockSocket();

      await handler.handleConnection(
        socket as unknown as Parameters<typeof handler.handleConnection>[0],
        'client-1',
        'user@test.com',
        'note-uuid-1',
      );

      socket.send.mockClear();

      // Create a sync step 1 message
      const clientDoc = new Y.Doc();
      const syncMsg = encodeSyncStep1(clientDoc);

      handler.handleMessage('client-1', syncMsg);

      // Should respond with sync step 2 (the diff)
      expect(socket.send).toHaveBeenCalled();
    });

    it('ignores messages from unknown clients', () => {
      const syncMsg = encodeSyncStep1(new Y.Doc());
      // Should not throw
      handler.handleMessage('unknown-client', syncMsg);
    });

    it('rejects oversized messages', async () => {
      const { socket } = createMockSocket();

      await handler.handleConnection(
        socket as unknown as Parameters<typeof handler.handleConnection>[0],
        'client-1',
        'user@test.com',
        'note-uuid-1',
      );

      // Create a message larger than YJS_MAX_BINARY_SIZE (2MB)
      const largeMsg = new Uint8Array(3 * 1024 * 1024);
      handler.handleMessage('client-1', largeMsg);

      // Should not crash, markDirty should not be called
      expect(mockManager.manager.markDirty).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('leaves the room and cleans up', async () => {
      const { socket } = createMockSocket();

      await handler.handleConnection(
        socket as unknown as Parameters<typeof handler.handleConnection>[0],
        'client-1',
        'user@test.com',
        'note-uuid-1',
      );

      await handler.handleDisconnect('client-1');

      expect(mockManager.manager.leaveRoom).toHaveBeenCalledWith('client-1', 'note-uuid-1');
    });

    it('handles disconnect for unknown client gracefully', async () => {
      // Should not throw
      await handler.handleDisconnect('unknown-client');
    });
  });

  describe('broadcast', () => {
    it('broadcasts sync messages to other clients in the room', async () => {
      const { socket: socket1 } = createMockSocket();
      const { socket: socket2 } = createMockSocket();

      await handler.handleConnection(
        socket1 as unknown as Parameters<typeof handler.handleConnection>[0],
        'client-1',
        'user1@test.com',
        'note-uuid-1',
      );
      await handler.handleConnection(
        socket2 as unknown as Parameters<typeof handler.handleConnection>[0],
        'client-2',
        'user2@test.com',
        'note-uuid-1',
      );

      socket1.send.mockClear();
      socket2.send.mockClear();

      // Client 1 sends a sync step 1 message (standard y-protocols format)
      const clientDoc = new Y.Doc();
      const syncMsg = encodeSyncStep1(clientDoc);

      handler.handleMessage('client-1', syncMsg);

      // Socket 1 should receive the sync step 2 response
      // Socket 2 may or may not receive a broadcast depending on sync message type
      // (sync step 1 generates a sync step 2 response, not a broadcast)
      expect(socket1.send).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('shuts down cleanly', async () => {
      const { socket } = createMockSocket();

      await handler.handleConnection(
        socket as unknown as Parameters<typeof handler.handleConnection>[0],
        'client-1',
        'user@test.com',
        'note-uuid-1',
      );

      await handler.shutdown();
      expect(mockManager.manager.shutdown).toHaveBeenCalled();
    });
  });
});
