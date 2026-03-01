/**
 * Event emitter helpers for easy event publishing from API handlers.
 * Part of Issues #213, #634 (note presence), #1946 (chat events)
 */

import { getRealtimeHub } from './hub.ts';
import type {
  WorkItemEventData,
  MemoryEventData,
  ContactEventData,
  MessageEventData,
  NotificationEventData,
  NotePresenceEventData,
  NotePresenceListEventData,
  NoteCursorEventData,
  ChatMessageReceivedEventData,
  ChatSessionCreatedEventData,
  ChatSessionEndedEventData,
  ChatTypingEventData,
  ChatReadCursorEventData,
} from './types.ts';

/**
 * Emit work item created event
 */
export async function emitWorkItemCreated(data: WorkItemEventData, user_id?: string): Promise<void> {
  await getRealtimeHub().emit('work_item:created', data, user_id);
}

/**
 * Emit work item updated event
 */
export async function emitWorkItemUpdated(data: WorkItemEventData, user_id?: string): Promise<void> {
  await getRealtimeHub().emit('work_item:updated', data, user_id);
}

/**
 * Emit work item deleted event
 */
export async function emitWorkItemDeleted(data: WorkItemEventData, user_id?: string): Promise<void> {
  await getRealtimeHub().emit('work_item:deleted', data, user_id);
}

/**
 * Emit memory created event
 */
export async function emitMemoryCreated(data: MemoryEventData, user_id?: string): Promise<void> {
  await getRealtimeHub().emit('memory:created', data, user_id);
}

/**
 * Emit memory updated event
 */
export async function emitMemoryUpdated(data: MemoryEventData, user_id?: string): Promise<void> {
  await getRealtimeHub().emit('memory:updated', data, user_id);
}

/**
 * Emit memory deleted event
 */
export async function emitMemoryDeleted(data: MemoryEventData, user_id?: string): Promise<void> {
  await getRealtimeHub().emit('memory:deleted', data, user_id);
}

/**
 * Emit contact created event
 */
export async function emitContactCreated(data: ContactEventData, user_id?: string): Promise<void> {
  await getRealtimeHub().emit('contact:created', data, user_id);
}

/**
 * Emit contact updated event
 */
export async function emitContactUpdated(data: ContactEventData, user_id?: string): Promise<void> {
  await getRealtimeHub().emit('contact:updated', data, user_id);
}

/**
 * Emit contact deleted event
 */
export async function emitContactDeleted(data: ContactEventData, user_id?: string): Promise<void> {
  await getRealtimeHub().emit('contact:deleted', data, user_id);
}

/**
 * Emit message received event
 */
export async function emitMessageReceived(data: MessageEventData, user_id?: string): Promise<void> {
  await getRealtimeHub().emit('message:received', data, user_id);
}

/**
 * Emit notification created event
 */
export async function emitNotificationCreated(data: NotificationEventData, user_id?: string): Promise<void> {
  await getRealtimeHub().emit('notification:created', data, user_id);
}

// ============================================================================
// Note Presence Events (#634)
// ============================================================================

/**
 * Emit note presence joined event (user started viewing a note)
 */
export async function emitNotePresenceJoined(data: NotePresenceEventData): Promise<void> {
  // Broadcast to all users viewing this note
  await getRealtimeHub().emit('note:presence_joined', data);
}

/**
 * Emit note presence left event (user stopped viewing a note)
 */
export async function emitNotePresenceLeft(data: NotePresenceEventData): Promise<void> {
  await getRealtimeHub().emit('note:presence_left', data);
}

/**
 * Emit note presence list (current viewers of a note)
 */
export async function emitNotePresenceList(data: NotePresenceListEventData, user_id?: string): Promise<void> {
  // Send to specific user who requested the list
  await getRealtimeHub().emit('note:presence_list', data, user_id);
}

/**
 * Emit note cursor position update
 */
export async function emitNoteCursorUpdate(data: NoteCursorEventData): Promise<void> {
  await getRealtimeHub().emit('note:presence_cursor', data);
}

// ============================================================================
// Chat Events (#1946)
// ============================================================================

/**
 * Emit chat message received event (new message in a session).
 * Payloads contain only IDs — no message body (respects 8KB NOTIFY limit).
 */
export async function emitChatMessageReceived(data: ChatMessageReceivedEventData, user_id: string): Promise<void> {
  await getRealtimeHub().emit('chat:message_received', data, user_id);
}

/**
 * Emit chat session created event.
 */
export async function emitChatSessionCreated(data: ChatSessionCreatedEventData, user_id: string): Promise<void> {
  await getRealtimeHub().emit('chat:session_created', data, user_id);
}

/**
 * Emit chat session ended event.
 */
export async function emitChatSessionEnded(data: ChatSessionEndedEventData, user_id: string): Promise<void> {
  await getRealtimeHub().emit('chat:session_ended', data, user_id);
}

/**
 * Emit chat typing indicator event.
 * Typing events include source_connection_id for echo filtering (don't echo to originating device).
 */
export async function emitChatTyping(data: ChatTypingEventData, user_id: string): Promise<void> {
  await getRealtimeHub().emit('chat:typing', data, user_id);
}

/**
 * Emit chat read cursor updated event.
 */
export async function emitChatReadCursorUpdated(data: ChatReadCursorEventData, user_id: string): Promise<void> {
  await getRealtimeHub().emit('chat:read_cursor_updated', data, user_id);
}
