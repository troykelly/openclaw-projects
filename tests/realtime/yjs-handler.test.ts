/**
 * Tests for YjsHandler.
 * Part of Issue #2256
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YjsHandler } from '../../src/api/realtime/yjs-handler.ts';
import { YJS_MSG_SYNC, YJS_MSG_AWARENESS, YJS_MAX_BINARY_SIZE } from '../../src/api/realtime/yjs-types.ts';
import type { WebSocketClient } from '../../src/api/realtime/types.ts';

vi.mock('../../src/api/notes/service.ts', () => ({
  userCanAccessNote: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/api/realtime/hub.ts', () => ({
  getRealtimeHub: vi.fn().mockReturnValue({
    emit: vi.fn().mockResolvedValue(undefined),
    sendToClient: vi.fn().mockReturnValue(true),
  }),
}));

function mockClient(id = 'client-1', userId = 'user@test.com'): WebSocketClient {
  return {
    client_id: id,
    user_id: userId,
    socket: {
      readyState: 1,
      send: vi.fn(),
    },
    connected_at: new Date(),
    last_ping: new Date(),
  };
}

/** Build a binary Yjs frame: [1 byte type][noteId\0][payload] */
function buildBinaryFrame(msgType: number, noteId: string, payload: number[] = [0x00]): Buffer {
  const noteIdBytes = Buffer.from(noteId + '\0', 'utf-8');
  return Buffer.concat([Buffer.from([msgType]), noteIdBytes, Buffer.from(payload)]);
}

describe('YjsHandler', () => {
  let handler: YjsHandler;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ yjs_state: null, content: '' }],
        rowCount: 1,
      }),
    };
    handler = new YjsHandler(mockPool as never);
  });

  afterEach(async () => {
    await handler.shutdown();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('handleControlMessage', () => {
    it('handles yjs:join by adding client to room', async () => {
      const client = mockClient();
      await handler.handleControlMessage(client, { type: 'yjs:join', noteId: 'note-1' });

      expect(handler.isClientInRoom('client-1', 'note-1')).toBe(true);
    });

    it('handles yjs:leave by removing client from room', async () => {
      const client = mockClient();
      await handler.handleControlMessage(client, { type: 'yjs:join', noteId: 'note-1' });
      await handler.handleControlMessage(client, { type: 'yjs:leave', noteId: 'note-1' });

      expect(handler.isClientInRoom('client-1', 'note-1')).toBe(false);
    });

    it('sends error for missing noteId', async () => {
      const client = mockClient();
      await handler.handleControlMessage(client, { type: 'yjs:join' });

      const socket = client.socket as { send: ReturnType<typeof vi.fn> };
      expect(socket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"yjs:error"'),
      );
    });

    it('sends error for unknown message type', async () => {
      const client = mockClient();
      await handler.handleControlMessage(client, { type: 'yjs:unknown', noteId: 'note-1' });

      const socket = client.socket as { send: ReturnType<typeof vi.fn> };
      expect(socket.send).toHaveBeenCalledWith(
        expect.stringContaining('Unknown message type'),
      );
    });

    it('sends error when feature is disabled', async () => {
      const disabledHandler = new YjsHandler(mockPool as never, false);
      const client = mockClient();
      await disabledHandler.handleControlMessage(client, { type: 'yjs:join', noteId: 'note-1' });

      const socket = client.socket as { send: ReturnType<typeof vi.fn> };
      expect(socket.send).toHaveBeenCalledWith(
        expect.stringContaining('disabled'),
      );
      await disabledHandler.shutdown();
    });
  });

  describe('handleBinaryMessage', () => {
    it('drops binary messages if client is not in room', () => {
      const client = mockClient();
      const data = buildBinaryFrame(YJS_MSG_SYNC, 'note-1');

      // Should not throw
      handler.handleBinaryMessage(client, data);
    });

    it('drops binary messages exceeding max size', () => {
      const client = mockClient();
      const data = Buffer.alloc(YJS_MAX_BINARY_SIZE + 1);

      handler.handleBinaryMessage(client, data);
      // Should be silently dropped
    });

    it('drops binary messages that are too short', () => {
      const client = mockClient();
      handler.handleBinaryMessage(client, Buffer.from([0x01]));
      // Should not throw
    });

    it('drops binary messages without null terminator in noteId', () => {
      const client = mockClient();
      // No null byte after message type
      handler.handleBinaryMessage(client, Buffer.from([0x01, 0x41, 0x42]));
      // Should be silently dropped
    });

    it('processes sync messages for subscribed clients', async () => {
      const client = mockClient();
      await handler.handleControlMessage(client, { type: 'yjs:join', noteId: 'note-1' });

      const data = buildBinaryFrame(YJS_MSG_SYNC, 'note-1', [0x00, 0x01]);
      handler.handleBinaryMessage(client, data);

      // Should not throw — message is accepted and doc marked dirty
    });

    it('processes awareness messages for subscribed clients', async () => {
      const client = mockClient();
      await handler.handleControlMessage(client, { type: 'yjs:join', noteId: 'note-1' });

      const data = buildBinaryFrame(YJS_MSG_AWARENESS, 'note-1', [0x00]);
      handler.handleBinaryMessage(client, data);
      // Should not throw
    });
  });

  describe('handleDisconnect', () => {
    it('removes client from all rooms', async () => {
      const client = mockClient();
      await handler.handleControlMessage(client, { type: 'yjs:join', noteId: 'note-1' });

      expect(handler.isClientInRoom('client-1', 'note-1')).toBe(true);

      await handler.handleDisconnect('client-1');

      expect(handler.isClientInRoom('client-1', 'note-1')).toBe(false);
    });
  });

  describe('hasActiveDoc', () => {
    it('returns false for unknown notes', () => {
      expect(handler.hasActiveDoc('unknown')).toBe(false);
    });

    it('returns true after a client joins', async () => {
      const client = mockClient();
      await handler.handleControlMessage(client, { type: 'yjs:join', noteId: 'note-1' });
      expect(handler.hasActiveDoc('note-1')).toBe(true);
    });
  });

  describe('getDocManager', () => {
    it('returns the internal doc manager', () => {
      expect(handler.getDocManager()).toBeDefined();
    });
  });
});
