/**
 * Types for real-time updates via WebSocket
 * Issue #404: Implement real-time updates via WebSocket
 */

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting';

export type RealtimeEventType =
  | 'item:created'
  | 'item:updated'
  | 'item:deleted'
  | 'item:status_changed'
  | 'comment:created'
  | 'comment:updated'
  | 'comment:deleted'
  | 'notification:created'
  | 'activity:new'
  | 'typing:start'
  | 'typing:stop'
  // Server-side event types (hub.ts emits these directly)
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
  | 'connection:established'
  | 'connection:ping'
  | 'connection:pong'
  | 'chat:message_received'
  | 'chat:session_created'
  | 'chat:session_ended'
  | 'chat:typing'
  | 'chat:read_cursor_updated';

export interface RealtimeEvent<T = unknown> {
  type: RealtimeEventType;
  payload: T;
  timestamp: string;
  user_id?: string;
}

export interface Subscription {
  type: 'item' | 'project' | 'user' | 'global';
  id?: string;
}

export interface WebSocketMessage {
  action: 'subscribe' | 'unsubscribe' | 'event' | 'ping' | 'pong';
  subscription?: Subscription;
  event?: RealtimeEvent;
}

export interface RealtimeContextValue {
  status: ConnectionStatus;
  subscribe: (subscription: Subscription) => void;
  unsubscribe: (subscription: Subscription) => void;
  addEventHandler: (eventType: RealtimeEventType, handler: (event: RealtimeEvent) => void, entity_id?: string) => () => void;
  sendEvent: (event: RealtimeEvent) => void;
}

export interface ReconnectOptions {
  initialDelay: number;
  maxDelay: number;
  maxAttempts: number;
  backoffMultiplier: number;
}

export const DEFAULT_RECONNECT_OPTIONS: ReconnectOptions = {
  initialDelay: 1000,
  maxDelay: 30000,
  maxAttempts: 10,
  backoffMultiplier: 2,
};
