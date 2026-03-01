/**
 * Real-time event types and interfaces.
 * Part of Issues #213, #634 (note presence), #1946 (chat events)
 */

/**
 * Chat-specific event types (#1946).
 */
export type ChatEventType =
  | 'chat:message_received'
  | 'chat:session_created'
  | 'chat:session_ended'
  | 'chat:typing'
  | 'chat:read_cursor_updated';

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
  | 'note:presence_cursor'
  // Chat events (#1946)
  | ChatEventType;

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
  memory_type?: string;
}

/**
 * Contact event data
 */
export interface ContactEventData {
  id: string;
  changes?: string[];
  display_name?: string;
}

/**
 * Message received event data
 */
export interface MessageEventData {
  id: string;
  thread_id?: string;
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
  entity_type?: string;
  entity_id?: string;
}

/**
 * Connection event data
 */
export interface ConnectionEventData {
  client_id: string;
  connected_at?: string;
}

/**
 * User presence information for notes (#634)
 */
export interface NotePresenceUser {
  email: string;
  display_name?: string;
  avatar_url?: string;
  last_seen_at: string;
  cursor_position?: {
    line: number;
    column: number;
  };
}

/**
 * Note presence joined/left event data
 */
export interface NotePresenceEventData {
  note_id: string;
  user: NotePresenceUser;
}

/**
 * Note presence list event data
 */
export interface NotePresenceListEventData {
  note_id: string;
  users: NotePresenceUser[];
}

/**
 * Note cursor position event data
 */
export interface NoteCursorEventData {
  note_id: string;
  user_email: string;
  cursor_position: {
    line: number;
    column: number;
  };
}

/**
 * Internal event for PostgreSQL NOTIFY
 */
export interface NotifyPayload {
  event: RealtimeEventType;
  user_id?: string;
  data: unknown;
}

/**
 * WebSocket client info
 */
export interface WebSocketClient {
  client_id: string;
  user_id?: string;
  socket: unknown;
  connected_at: Date;
  last_ping: Date;
}

// ============================================================================
// Chat Event Data Types (#1946)
// ============================================================================

/**
 * Chat message received event data
 */
export interface ChatMessageReceivedEventData {
  session_id: string;
  message_id: string;
}

/**
 * Chat session created event data
 */
export interface ChatSessionCreatedEventData {
  session_id: string;
}

/**
 * Chat session ended event data
 */
export interface ChatSessionEndedEventData {
  session_id: string;
}

/**
 * Chat typing indicator event data
 */
export interface ChatTypingEventData {
  session_id: string;
  agent_id: string | null;
  is_typing: boolean;
  /** Connection ID of the originating device (for echo filtering). */
  source_connection_id?: string;
}

/**
 * Chat read cursor updated event data
 */
export interface ChatReadCursorEventData {
  session_id: string;
  last_read_message_id: string;
}
