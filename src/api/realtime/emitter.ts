/**
 * Event emitter helpers for easy event publishing from API handlers.
 * Part of Issue #213.
 */

import { getRealtimeHub } from './hub.ts';
import type {
  WorkItemEventData,
  MemoryEventData,
  ContactEventData,
  MessageEventData,
  NotificationEventData,
} from './types.ts';

/**
 * Emit work item created event
 */
export async function emitWorkItemCreated(
  data: WorkItemEventData,
  userId?: string
): Promise<void> {
  await getRealtimeHub().emit('work_item:created', data, userId);
}

/**
 * Emit work item updated event
 */
export async function emitWorkItemUpdated(
  data: WorkItemEventData,
  userId?: string
): Promise<void> {
  await getRealtimeHub().emit('work_item:updated', data, userId);
}

/**
 * Emit work item deleted event
 */
export async function emitWorkItemDeleted(
  data: WorkItemEventData,
  userId?: string
): Promise<void> {
  await getRealtimeHub().emit('work_item:deleted', data, userId);
}

/**
 * Emit memory created event
 */
export async function emitMemoryCreated(
  data: MemoryEventData,
  userId?: string
): Promise<void> {
  await getRealtimeHub().emit('memory:created', data, userId);
}

/**
 * Emit memory updated event
 */
export async function emitMemoryUpdated(
  data: MemoryEventData,
  userId?: string
): Promise<void> {
  await getRealtimeHub().emit('memory:updated', data, userId);
}

/**
 * Emit memory deleted event
 */
export async function emitMemoryDeleted(
  data: MemoryEventData,
  userId?: string
): Promise<void> {
  await getRealtimeHub().emit('memory:deleted', data, userId);
}

/**
 * Emit contact created event
 */
export async function emitContactCreated(
  data: ContactEventData,
  userId?: string
): Promise<void> {
  await getRealtimeHub().emit('contact:created', data, userId);
}

/**
 * Emit contact updated event
 */
export async function emitContactUpdated(
  data: ContactEventData,
  userId?: string
): Promise<void> {
  await getRealtimeHub().emit('contact:updated', data, userId);
}

/**
 * Emit contact deleted event
 */
export async function emitContactDeleted(
  data: ContactEventData,
  userId?: string
): Promise<void> {
  await getRealtimeHub().emit('contact:deleted', data, userId);
}

/**
 * Emit message received event
 */
export async function emitMessageReceived(
  data: MessageEventData,
  userId?: string
): Promise<void> {
  await getRealtimeHub().emit('message:received', data, userId);
}

/**
 * Emit notification created event
 */
export async function emitNotificationCreated(
  data: NotificationEventData,
  userId?: string
): Promise<void> {
  await getRealtimeHub().emit('notification:created', data, userId);
}
