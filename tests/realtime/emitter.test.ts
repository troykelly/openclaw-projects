/**
 * Tests for event emitter helpers.
 * Part of Issue #213.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetRealtimeHub, getRealtimeHub } from '../../src/api/realtime/hub.ts';
import {
  emitWorkItemCreated,
  emitWorkItemUpdated,
  emitWorkItemDeleted,
  emitMemoryCreated,
  emitMemoryUpdated,
  emitMemoryDeleted,
  emitContactCreated,
  emitContactUpdated,
  emitContactDeleted,
  emitMessageReceived,
  emitNotificationCreated,
} from '../../src/api/realtime/emitter.ts';
import type { RealtimeEvent } from '../../src/api/realtime/types.ts';

// Mock WebSocket
class MockWebSocket {
  readyState = 1;
  messages: string[] = [];

  send(data: string): void {
    this.messages.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  on(): void {}
}

describe('Event Emitter Helpers', () => {
  let socket: MockWebSocket;

  beforeEach(async () => {
    await resetRealtimeHub();
    socket = new MockWebSocket();
    getRealtimeHub().addClient(socket as unknown as WebSocket, 'test-user');
    socket.messages = []; // Clear connection message
  });

  afterEach(async () => {
    await resetRealtimeHub();
  });

  describe('Work Item Events', () => {
    it('emitWorkItemCreated sends work_item:created event', async () => {
      await emitWorkItemCreated({ id: '123', title: 'Test Task' }, 'test-user');

      expect(socket.messages.length).toBe(1);
      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.event).toBe('work_item:created');
      expect(event.data).toEqual({ id: '123', title: 'Test Task' });
    });

    it('emitWorkItemUpdated sends work_item:updated event', async () => {
      await emitWorkItemUpdated({ id: '123', changes: ['status', 'title'] }, 'test-user');

      expect(socket.messages.length).toBe(1);
      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.event).toBe('work_item:updated');
      expect(event.data).toEqual({ id: '123', changes: ['status', 'title'] });
    });

    it('emitWorkItemDeleted sends work_item:deleted event', async () => {
      await emitWorkItemDeleted({ id: '123' }, 'test-user');

      expect(socket.messages.length).toBe(1);
      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.event).toBe('work_item:deleted');
      expect(event.data).toEqual({ id: '123' });
    });
  });

  describe('Memory Events', () => {
    it('emitMemoryCreated sends memory:created event', async () => {
      await emitMemoryCreated({ id: '456', title: 'Test Memory', memory_type: 'preference' }, 'test-user');

      expect(socket.messages.length).toBe(1);
      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.event).toBe('memory:created');
      expect(event.data).toEqual({
        id: '456',
        title: 'Test Memory',
        memory_type: 'preference',
      });
    });

    it('emitMemoryUpdated sends memory:updated event', async () => {
      await emitMemoryUpdated({ id: '456', changes: ['content'] }, 'test-user');

      expect(socket.messages.length).toBe(1);
      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.event).toBe('memory:updated');
    });

    it('emitMemoryDeleted sends memory:deleted event', async () => {
      await emitMemoryDeleted({ id: '456' }, 'test-user');

      expect(socket.messages.length).toBe(1);
      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.event).toBe('memory:deleted');
    });
  });

  describe('Contact Events', () => {
    it('emitContactCreated sends contact:created event', async () => {
      await emitContactCreated({ id: '789', display_name: 'John Doe' }, 'test-user');

      expect(socket.messages.length).toBe(1);
      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.event).toBe('contact:created');
      expect(event.data).toEqual({ id: '789', display_name: 'John Doe' });
    });

    it('emitContactUpdated sends contact:updated event', async () => {
      await emitContactUpdated({ id: '789', changes: ['display_name'] }, 'test-user');

      expect(socket.messages.length).toBe(1);
      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.event).toBe('contact:updated');
    });

    it('emitContactDeleted sends contact:deleted event', async () => {
      await emitContactDeleted({ id: '789' }, 'test-user');

      expect(socket.messages.length).toBe(1);
      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.event).toBe('contact:deleted');
    });
  });

  describe('Message Events', () => {
    it('emitMessageReceived sends message:received event', async () => {
      await emitMessageReceived({ id: 'msg-1', thread_id: 'thread-1', source: 'sms', preview: 'Hello' }, 'test-user');

      expect(socket.messages.length).toBe(1);
      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.event).toBe('message:received');
      expect(event.data).toEqual({
        id: 'msg-1',
        thread_id: 'thread-1',
        source: 'sms',
        preview: 'Hello',
      });
    });
  });

  describe('Notification Events', () => {
    it('emitNotificationCreated sends notification:created event', async () => {
      await emitNotificationCreated(
        {
          id: 'notif-1',
          type: 'reminder',
          title: 'Task due soon',
          entity_type: 'work_item',
          entity_id: '123',
        },
        'test-user',
      );

      expect(socket.messages.length).toBe(1);
      const event = JSON.parse(socket.messages[0]) as RealtimeEvent;
      expect(event.event).toBe('notification:created');
      expect(event.data).toEqual({
        id: 'notif-1',
        type: 'reminder',
        title: 'Task due soon',
        entity_type: 'work_item',
        entity_id: '123',
      });
    });
  });

  describe('Broadcast Events', () => {
    it('broadcasts event when no user_id provided', async () => {
      const socket2 = new MockWebSocket();
      getRealtimeHub().addClient(socket2 as unknown as WebSocket, 'other-user');
      socket2.messages = [];

      await emitNotificationCreated({
        id: 'notif-2',
        type: 'system',
        title: 'System update',
      });

      // Both sockets should receive the broadcast
      expect(socket.messages.length).toBe(1);
      expect(socket2.messages.length).toBe(1);
    });
  });
});
