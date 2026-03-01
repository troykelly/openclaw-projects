/**
 * Unit tests for RealtimeHub chat event broadcasting (#1946).
 *
 * Tests the 5 chat event types via the RealtimeHub.
 * Pure unit tests — no database or server required.
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RealtimeHub, resetRealtimeHub } from '../../src/api/realtime/hub.ts';
import type { RealtimeEvent, ChatEventType } from '../../src/api/realtime/types.ts';

// Mock WebSocket
class MockWebSocket {
  readyState = 1; // OPEN
  messages: string[] = [];

  send(data: string): void {
    this.messages.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  // Event emitter stubs
  on(): void {}
  emit(): void {}
}

describe('RealtimeHub Chat Events (#1946)', () => {
  let hub: RealtimeHub;

  beforeEach(async () => {
    vi.useFakeTimers();
    await resetRealtimeHub();
    hub = new RealtimeHub();
  });

  afterEach(async () => {
    await hub.shutdown();
    vi.useRealTimers();
  });

  const chatEventTypes: ChatEventType[] = [
    'chat:message_received',
    'chat:session_created',
    'chat:session_ended',
    'chat:typing',
    'chat:read_cursor_updated',
  ];

  describe('chat event routing', () => {
    for (const eventType of chatEventTypes) {
      it(`routes ${eventType} to user's connections`, async () => {
        const userSocket = new MockWebSocket();
        const otherSocket = new MockWebSocket();

        hub.addClient(userSocket as unknown as WebSocket, 'user@example.com');
        hub.addClient(otherSocket as unknown as WebSocket, 'other@example.com');

        // Clear the connection:established messages
        userSocket.messages = [];
        otherSocket.messages = [];

        await hub.emit(eventType, { session_id: 'sess-1' }, 'user@example.com');

        // User should receive the event
        expect(userSocket.messages.length).toBe(1);
        const parsed = JSON.parse(userSocket.messages[0]) as RealtimeEvent;
        expect(parsed.event).toBe(eventType);
        expect(parsed.data).toEqual({ session_id: 'sess-1' });

        // Other user should NOT receive the event
        expect(otherSocket.messages.length).toBe(0);
      });
    }
  });

  describe('chat:message_received', () => {
    it('sends session_id and message_id only (ID-only payloads)', async () => {
      const socket = new MockWebSocket();
      hub.addClient(socket as unknown as WebSocket, 'user@example.com');
      socket.messages = [];

      await hub.emit('chat:message_received', {
        session_id: 'sess-123',
        message_id: 'msg-456',
      }, 'user@example.com');

      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.data).toEqual({
        session_id: 'sess-123',
        message_id: 'msg-456',
      });
      // No message body in payload (respects 8KB NOTIFY limit)
      expect(event.data).not.toHaveProperty('content');
      expect(event.data).not.toHaveProperty('body');
    });
  });

  describe('chat:typing echo filtering', () => {
    it('delivers typing to all user connections (filtering is client-side)', async () => {
      const socket1 = new MockWebSocket();
      const socket2 = new MockWebSocket();

      hub.addClient(socket1 as unknown as WebSocket, 'user@example.com');
      hub.addClient(socket2 as unknown as WebSocket, 'user@example.com');

      socket1.messages = [];
      socket2.messages = [];

      // Typing event includes source_connection_id for client-side filtering
      await hub.emit('chat:typing', {
        session_id: 'sess-1',
        agent_id: null,
        is_typing: true,
        source_connection_id: 'conn-1',
      }, 'user@example.com');

      // Both connections receive the event (client-side filters by source_connection_id)
      expect(socket1.messages.length).toBe(1);
      expect(socket2.messages.length).toBe(1);

      // Both contain source_connection_id for client filtering
      const event = JSON.parse(socket1.messages[0]) as RealtimeEvent<{
        source_connection_id: string;
      }>;
      expect(event.data.source_connection_id).toBe('conn-1');
    });
  });

  describe('multi-device delivery', () => {
    it('delivers chat events to all user connections', async () => {
      const sockets = Array.from({ length: 3 }, () => new MockWebSocket());

      for (const socket of sockets) {
        hub.addClient(socket as unknown as WebSocket, 'user@example.com');
        socket.messages = [];
      }

      await hub.emit('chat:session_created', { session_id: 'sess-new' }, 'user@example.com');

      for (const socket of sockets) {
        expect(socket.messages.length).toBe(1);
      }
    });
  });
});
