/**
 * Integration tests for MessageRouter + YjsHandler wiring.
 * Part of Issue #2256
 */

import { describe, it, expect, vi } from 'vitest';
import { MessageRouter } from '../../src/api/realtime/message-router.ts';
import type { WebSocketClient } from '../../src/api/realtime/types.ts';

describe('MessageRouter integration', () => {
  it('routes yjs:join to text handler and binary frames to binary handler', () => {
    const router = new MessageRouter();
    const yjsTextHandler = vi.fn();
    const connectionHandler = vi.fn();
    const binaryHandler = vi.fn();

    router.onText('yjs:', yjsTextHandler);
    router.onText('connection:', connectionHandler);
    router.onBinary(binaryHandler);

    const mockClient: WebSocketClient = {
      client_id: 'c1',
      user_id: 'u1',
      socket: { readyState: 1, send: vi.fn() },
      connected_at: new Date(),
      last_ping: new Date(),
    };

    // Text message — yjs:join routes to yjsTextHandler
    router.dispatch(mockClient, JSON.stringify({ type: 'yjs:join', noteId: 'n1' }), false);
    expect(yjsTextHandler).toHaveBeenCalledWith(mockClient, { type: 'yjs:join', noteId: 'n1' });
    expect(connectionHandler).not.toHaveBeenCalled();

    // Text message — connection:pong routes to connectionHandler
    router.dispatch(mockClient, JSON.stringify({ type: 'connection:pong' }), false);
    expect(connectionHandler).toHaveBeenCalledWith(mockClient, { type: 'connection:pong' });

    // Binary message routes to binaryHandler
    const binary = Buffer.from([0x01, 0x00]);
    router.dispatch(mockClient, binary, true);
    expect(binaryHandler).toHaveBeenCalledWith(mockClient, binary);
  });

  it('dispatches yjs:leave to yjs text handler', () => {
    const router = new MessageRouter();
    const yjsHandler = vi.fn();
    router.onText('yjs:', yjsHandler);

    const client: WebSocketClient = {
      client_id: 'c1',
      user_id: 'u1',
      socket: { readyState: 1, send: vi.fn() },
      connected_at: new Date(),
      last_ping: new Date(),
    };

    router.dispatch(client, JSON.stringify({ type: 'yjs:leave', noteId: 'n1' }), false);
    expect(yjsHandler).toHaveBeenCalledWith(client, { type: 'yjs:leave', noteId: 'n1' });
  });

  it('does not route event messages to yjs handler', () => {
    const router = new MessageRouter();
    const yjsHandler = vi.fn();
    const eventHandler = vi.fn();
    router.onText('yjs:', yjsHandler);
    router.onText('connection:', eventHandler);

    const client: WebSocketClient = {
      client_id: 'c1',
      user_id: 'u1',
      socket: { readyState: 1, send: vi.fn() },
      connected_at: new Date(),
      last_ping: new Date(),
    };

    router.dispatch(client, JSON.stringify({ event: 'connection:pong', type: 'connection:pong' }), false);
    expect(yjsHandler).not.toHaveBeenCalled();
    expect(eventHandler).toHaveBeenCalled();
  });
});
