/**
 * Yjs-specific types for collaborative editing.
 * Separate from RealtimeEventType — Yjs messages are binary protocol, not domain events.
 * Part of Issue #2256
 */

/**
 * Legacy binary message type discriminators (first byte of custom binary frame).
 * NOTE: These differ from standard y-protocols values (sync=0, awareness=1).
 * Used only by the legacy YjsHandler custom binary protocol on /ws.
 * The standard YjsWsHandler on /yjs/:noteId uses y-protocols directly.
 */
export const YJS_MSG_SYNC = 0x01;
export const YJS_MSG_AWARENESS = 0x02;

/** JSON control message types for Yjs room management */
export type YjsControlMessageType = 'yjs:join' | 'yjs:leave' | 'yjs:error' | 'yjs:persisted';

/** Yjs join request (JSON, text frame) */
export interface YjsJoinMessage {
  type: 'yjs:join';
  noteId: string;
}

/** Yjs leave request (JSON, text frame) */
export interface YjsLeaveMessage {
  type: 'yjs:leave';
  noteId: string;
}

/** Yjs error response (JSON, text frame) */
export interface YjsErrorMessage {
  type: 'yjs:error';
  noteId: string;
  error: string;
}

/**
 * Yjs persistence confirmed (JSON, text frame).
 * TODO(#2256): Not yet sent by any handler — planned for save status UI.
 */
export interface YjsPersistedMessage {
  type: 'yjs:persisted';
  noteId: string;
  timestamp: string;
}

export type YjsControlMessage = YjsJoinMessage | YjsLeaveMessage | YjsErrorMessage | YjsPersistedMessage;

/**
 * Awareness state schema.
 * NOTE: Server does not currently validate or overwrite these fields.
 * TODO(#2256): Add server-side email validation from JWT for security.
 */
export interface YjsAwarenessState {
  user: {
    email: string;
    name: string;
    color: string;
  };
  cursor: {
    anchor: unknown;
    focus: unknown;
  } | null;
}

/** Max binary Yjs message size (1MB) */
export const YJS_MAX_BINARY_SIZE = 1024 * 1024;

/** Max awareness payload size (4KB) */
export const YJS_MAX_AWARENESS_SIZE = 4096;

/** Rate limit: messages per second per client per note */
export const YJS_RATE_LIMIT_PER_SECOND = 60;

/** Rate limit: messages per second per connection (all rooms) */
export const YJS_RATE_LIMIT_GLOBAL_PER_SECOND = 120;

/** Persistence debounce interval (ms) */
export const YJS_PERSIST_DEBOUNCE_MS = 10_000;

/** Max forced flush interval (ms) — caps crash-loss window */
export const YJS_MAX_FLUSH_INTERVAL_MS = 60_000;

/** Idle document eviction timeout (ms) */
export const YJS_DOC_EVICTION_TIMEOUT_MS = 5 * 60 * 1000;

/** Max in-memory documents */
export const YJS_MAX_DOCS = 500;

/** Trailing-edge re-embedding delay after editing quiesces (ms) */
export const YJS_EMBEDDING_IDLE_MS = 2 * 60 * 1000;

/**
 * Periodic re-auth interval (ms).
 * TODO(#2256): Not yet implemented — planned for Phase 2 security hardening.
 */
export const YJS_REAUTH_INTERVAL_MS = 30_000;
