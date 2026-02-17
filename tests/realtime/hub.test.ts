/**
 * Tests for RealtimeHub.
 * Part of Issue #213.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RealtimeHub, resetRealtimeHub } from '../../src/api/realtime/hub.ts';
import type { RealtimeEvent } from '../../src/api/realtime/types.ts';

// Mock WebSocket
class MockWebSocket {
  readyState = 1; // OPEN
  messages: string[] = [];
  closeCode?: number;
  closeReason?: string;

  send(data: string): void {
    this.messages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3; // CLOSED
    this.closeCode = code;
    this.closeReason = reason;
  }

  // Event emitter methods
  private handlers: Record<string, Array<(data: unknown) => void>> = {};

  on(event: string, handler: (data: unknown) => void): void {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(handler);
  }

  emit(event: string, data: unknown): void {
    const handlers = this.handlers[event] || [];
    for (const handler of handlers) {
      handler(data);
    }
  }
}

describe('RealtimeHub', () => {
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

  describe('addClient', () => {
    it('adds a client and returns a client ID', () => {
      const socket = new MockWebSocket();
      const client_id = hub.addClient(socket as unknown as WebSocket);

      expect(client_id).toBeDefined();
      expect(typeof client_id).toBe('string');
      expect(hub.getClientCount()).toBe(1);
    });

    it('associates client with user ID when provided', () => {
      const socket = new MockWebSocket();
      const user_id = 'user@example.com';
      const client_id = hub.addClient(socket as unknown as WebSocket, user_id);

      expect(hub.getUserClientIds(user_id)).toContain(client_id);
    });

    it('sends connection established event to new client', () => {
      const socket = new MockWebSocket();
      hub.addClient(socket as unknown as WebSocket);

      expect(socket.messages.length).toBe(1);
      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.event).toBe('connection:established');
      expect(event.data).toHaveProperty('client_id');
      expect(event.data).toHaveProperty('connected_at');
    });
  });

  describe('removeClient', () => {
    it('removes a client', () => {
      const socket = new MockWebSocket();
      const client_id = hub.addClient(socket as unknown as WebSocket);

      expect(hub.getClientCount()).toBe(1);

      hub.removeClient(client_id);

      expect(hub.getClientCount()).toBe(0);
    });

    it('removes client from user mapping', () => {
      const socket = new MockWebSocket();
      const user_id = 'user@example.com';
      const client_id = hub.addClient(socket as unknown as WebSocket, user_id);

      hub.removeClient(client_id);

      expect(hub.getUserClientIds(user_id)).toHaveLength(0);
    });

    it('handles removing non-existent client gracefully', () => {
      expect(() => hub.removeClient('non-existent')).not.toThrow();
    });
  });

  describe('sendToClient', () => {
    it('sends event to a specific client', () => {
      const socket = new MockWebSocket();
      const client_id = hub.addClient(socket as unknown as WebSocket);
      socket.messages = []; // Clear the connection established message

      const event: RealtimeEvent = {
        event: 'work_item:created',
        data: { id: '123' },
        timestamp: new Date().toISOString(),
      };

      const result = hub.sendToClient(client_id, event);

      expect(result).toBe(true);
      expect(socket.messages.length).toBe(1);
      expect(JSON.parse(socket.messages[0])).toEqual(event);
    });

    it('returns false for non-existent client', () => {
      const event: RealtimeEvent = {
        event: 'work_item:created',
        data: { id: '123' },
        timestamp: new Date().toISOString(),
      };

      const result = hub.sendToClient('non-existent', event);

      expect(result).toBe(false);
    });

    it('returns false for closed socket', () => {
      const socket = new MockWebSocket();
      const client_id = hub.addClient(socket as unknown as WebSocket);
      socket.readyState = 3; // CLOSED
      socket.messages = [];

      const event: RealtimeEvent = {
        event: 'work_item:created',
        data: { id: '123' },
        timestamp: new Date().toISOString(),
      };

      const result = hub.sendToClient(client_id, event);

      expect(result).toBe(false);
      expect(socket.messages.length).toBe(0);
    });
  });

  describe('sendToUser', () => {
    it('sends event to all user connections', () => {
      const user_id = 'user@example.com';
      const socket1 = new MockWebSocket();
      const socket2 = new MockWebSocket();

      hub.addClient(socket1 as unknown as WebSocket, user_id);
      hub.addClient(socket2 as unknown as WebSocket, user_id);

      socket1.messages = [];
      socket2.messages = [];

      const event: RealtimeEvent = {
        event: 'work_item:updated',
        data: { id: '123' },
        timestamp: new Date().toISOString(),
      };

      const sent = hub.sendToUser(user_id, event);

      expect(sent).toBe(2);
      expect(socket1.messages.length).toBe(1);
      expect(socket2.messages.length).toBe(1);
    });

    it('returns 0 for user with no connections', () => {
      const event: RealtimeEvent = {
        event: 'work_item:updated',
        data: { id: '123' },
        timestamp: new Date().toISOString(),
      };

      const sent = hub.sendToUser('nobody@example.com', event);

      expect(sent).toBe(0);
    });
  });

  describe('broadcast', () => {
    it('sends event to all connected clients', () => {
      const socket1 = new MockWebSocket();
      const socket2 = new MockWebSocket();
      const socket3 = new MockWebSocket();

      hub.addClient(socket1 as unknown as WebSocket, 'user1');
      hub.addClient(socket2 as unknown as WebSocket, 'user2');
      hub.addClient(socket3 as unknown as WebSocket); // No user

      socket1.messages = [];
      socket2.messages = [];
      socket3.messages = [];

      const event: RealtimeEvent = {
        event: 'notification:created',
        data: { type: 'system' },
        timestamp: new Date().toISOString(),
      };

      const sent = hub.broadcast(event);

      expect(sent).toBe(3);
      expect(socket1.messages.length).toBe(1);
      expect(socket2.messages.length).toBe(1);
      expect(socket3.messages.length).toBe(1);
    });
  });

  describe('updateClientPing', () => {
    it('updates client last ping time', () => {
      const socket = new MockWebSocket();
      const client_id = hub.addClient(socket as unknown as WebSocket);

      // Advance time
      vi.advanceTimersByTime(10000);

      hub.updateClientPing(client_id);

      // Client should still be active after heartbeat check
      expect(hub.getClientCount()).toBe(1);
    });

    it('handles non-existent client gracefully', () => {
      expect(() => hub.updateClientPing('non-existent')).not.toThrow();
    });
  });

  describe('getUserClientIds', () => {
    it('returns all client IDs for a user', () => {
      const user_id = 'user@example.com';
      const socket1 = new MockWebSocket();
      const socket2 = new MockWebSocket();

      const clientId1 = hub.addClient(socket1 as unknown as WebSocket, user_id);
      const clientId2 = hub.addClient(socket2 as unknown as WebSocket, user_id);

      const clientIds = hub.getUserClientIds(user_id);

      expect(clientIds).toContain(clientId1);
      expect(clientIds).toContain(clientId2);
      expect(clientIds.length).toBe(2);
    });

    it('returns empty array for user with no connections', () => {
      const clientIds = hub.getUserClientIds('nobody@example.com');
      expect(clientIds).toEqual([]);
    });
  });

  describe('getClientCount', () => {
    it('returns correct client count', () => {
      expect(hub.getClientCount()).toBe(0);

      const socket1 = new MockWebSocket();
      hub.addClient(socket1 as unknown as WebSocket);
      expect(hub.getClientCount()).toBe(1);

      const socket2 = new MockWebSocket();
      hub.addClient(socket2 as unknown as WebSocket);
      expect(hub.getClientCount()).toBe(2);
    });
  });

  describe('shutdown', () => {
    it('closes all client connections', async () => {
      const socket1 = new MockWebSocket();
      const socket2 = new MockWebSocket();

      hub.addClient(socket1 as unknown as WebSocket);
      hub.addClient(socket2 as unknown as WebSocket);

      await hub.shutdown();

      expect(socket1.closeCode).toBe(1001);
      expect(socket2.closeCode).toBe(1001);
      expect(hub.getClientCount()).toBe(0);
    });
  });
});

describe('RealtimeHub emit', () => {
  let hub: RealtimeHub;

  beforeEach(async () => {
    await resetRealtimeHub();
    hub = new RealtimeHub();
  });

  afterEach(async () => {
    await hub.shutdown();
  });

  it('emits event to specific user', async () => {
    const user_id = 'user@example.com';
    const socket = new MockWebSocket();
    hub.addClient(socket as unknown as WebSocket, user_id);
    socket.messages = [];

    await hub.emit('work_item:created', { id: '123' }, user_id);

    expect(socket.messages.length).toBe(1);
    const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
    expect(event.event).toBe('work_item:created');
    expect(event.data).toEqual({ id: '123' });
  });

  it('broadcasts event when no user specified', async () => {
    const socket1 = new MockWebSocket();
    const socket2 = new MockWebSocket();

    hub.addClient(socket1 as unknown as WebSocket, 'user1');
    hub.addClient(socket2 as unknown as WebSocket, 'user2');
    socket1.messages = [];
    socket2.messages = [];

    await hub.emit('notification:created', { type: 'system' });

    expect(socket1.messages.length).toBe(1);
    expect(socket2.messages.length).toBe(1);
  });
});
