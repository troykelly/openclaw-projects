/**
 * Tests for MessageRouter typed WebSocket dispatch.
 * Part of Issue #2256
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageRouter } from '../../src/api/realtime/message-router.ts';
import type { WebSocketClient } from '../../src/api/realtime/types.ts';

function mockClient(overrides: Partial<WebSocketClient> = {}): WebSocketClient {
  return {
    client_id: 'test-client-1',
    user_id: 'test-user-1',
    socket: { readyState: 1, send: vi.fn() },
    connected_at: new Date(),
    last_ping: new Date(),
    ...overrides,
  };
}

describe('MessageRouter', () => {
  let router: MessageRouter;

  beforeEach(() => {
    router = new MessageRouter();
  });

  it('routes text frames to JSON handlers by prefix match', () => {
    const handler = vi.fn();
    router.onText('connection:', handler);

    const client = mockClient();
    const data = JSON.stringify({ type: 'connection:pong' });
    router.dispatch(client, data, false);

    expect(handler).toHaveBeenCalledWith(client, { type: 'connection:pong' });
  });

  it('routes binary frames to binary handler', () => {
    const handler = vi.fn();
    router.onBinary(handler);

    const client = mockClient();
    const data = Buffer.from([0x01, 0x00, 0x01]);
    router.dispatch(client, data, true);

    expect(handler).toHaveBeenCalledWith(client, data);
  });

  it('ignores text frames with no matching handler', () => {
    const handler = vi.fn();
    router.onText('yjs:', handler);

    const client = mockClient();
    const data = JSON.stringify({ type: 'connection:pong' });
    router.dispatch(client, data, false);

    expect(handler).not.toHaveBeenCalled();
  });

  it('handles malformed JSON gracefully', () => {
    const handler = vi.fn();
    router.onText('connection:', handler);

    const client = mockClient();
    router.dispatch(client, 'not json {{{', false);

    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores text frames without a type field', () => {
    const handler = vi.fn();
    router.onText('connection:', handler);

    const client = mockClient();
    router.dispatch(client, JSON.stringify({ data: 'hello' }), false);

    expect(handler).not.toHaveBeenCalled();
  });

  it('routes to first matching handler only', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    router.onText('yjs:', handler1);
    router.onText('yjs:join', handler2);

    const client = mockClient();
    router.dispatch(client, JSON.stringify({ type: 'yjs:join', noteId: 'n1' }), false);

    expect(handler1).toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('handles Buffer text frames by converting to string', () => {
    const handler = vi.fn();
    router.onText('connection:', handler);

    const client = mockClient();
    const data = Buffer.from(JSON.stringify({ type: 'connection:pong' }));
    router.dispatch(client, data, false);

    expect(handler).toHaveBeenCalledWith(client, { type: 'connection:pong' });
  });

  it('does nothing with binary frames when no binary handler registered', () => {
    const client = mockClient();
    const data = Buffer.from([0x01, 0x00]);
    // Should not throw
    router.dispatch(client, data, true);
  });

  it('routes legacy { event: ... } field for backward compatibility', () => {
    const handler = vi.fn();
    router.onText('connection:', handler);

    const client = mockClient();
    // Frontend sends { event: 'connection:pong' } not { type: 'connection:pong' }
    const data = JSON.stringify({ event: 'connection:pong', data: {}, timestamp: '2026-01-01T00:00:00Z' });
    router.dispatch(client, data, false);

    expect(handler).toHaveBeenCalledWith(client, expect.objectContaining({ type: 'connection:pong' }));
  });

  it('ignores text frames with neither type nor event field', () => {
    const handler = vi.fn();
    router.onText('connection:', handler);

    const client = mockClient();
    router.dispatch(client, JSON.stringify({ data: 'hello', action: 'subscribe' }), false);

    expect(handler).not.toHaveBeenCalled();
  });
});
