/**
 * Real-time event types and interfaces.
 * Part of Issues #213, #634 (note presence)
 */

/**
 * Available real-time event types
 */
export type RealtimeEventType =
  | 'work_item:created'
  | 'work_item:updated'
  | 'work_item:deleted'
  | 'memory:created'
  | 'memory:updated'
  | 'memory:deleted'
  | 'contact:created'
  | 'contact:updated'
  | 'contact:deleted'
  | 'message:received'
  | 'notification:created'
  | 'connection:established'
  | 'connection:ping'
  | 'connection:pong'
  // Note presence events (#634)
  | 'note:presence_joined'
  | 'note:presence_left'
  | 'note:presence_list'
  | 'note:presence_cursor';

/**
 * Real-time event message structure
 */
export interface RealtimeEvent<T = unknown> {
  event: RealtimeEventType;
  data: T;
  timestamp: string;
}

/**
 * Work item event data
 */
export interface WorkItemEventData {
  id: string;
  changes?: string[];
  title?: string;
  action?: string;
}

/**
 * Memory event data
 */
export interface MemoryEventData {
  id: string;
  changes?: string[];
  title?: string;
  memoryType?: string;
}

/**
 * Contact event data
 */
export interface ContactEventData {
  id: string;
  changes?: string[];
  displayName?: string;
}

/**
 * Message received event data
 */
export interface MessageEventData {
  id: string;
  threadId?: string;
  source: string;
  preview?: string;
}

/**
 * Notification event data
 */
export interface NotificationEventData {
  id: string;
  type: string;
  title?: string;
  entityType?: string;
  entityId?: string;
}

/**
 * Connection event data
 */
export interface ConnectionEventData {
  clientId: string;
  connectedAt?: string;
}

/**
 * User presence information for notes (#634)
 */
export interface NotePresenceUser {
  email: string;
  displayName?: string;
  avatarUrl?: string;
  lastSeenAt: string;
  cursorPosition?: {
    line: number;
    column: number;
  };
}

/**
 * Note presence joined/left event data
 */
export interface NotePresenceEventData {
  noteId: string;
  user: NotePresenceUser;
}

/**
 * Note presence list event data
 */
export interface NotePresenceListEventData {
  noteId: string;
  users: NotePresenceUser[];
}

/**
 * Note cursor position event data
 */
export interface NoteCursorEventData {
  noteId: string;
  userEmail: string;
  cursorPosition: {
    line: number;
    column: number;
  };
}

/**
 * Internal event for PostgreSQL NOTIFY
 */
export interface NotifyPayload {
  event: RealtimeEventType;
  userId?: string;
  data: unknown;
}

/**
 * WebSocket client info
 */
export interface WebSocketClient {
  clientId: string;
  userId?: string;
  socket: unknown;
  connectedAt: Date;
  lastPing: Date;
}
