/**
 * Gateway WebSocket metrics — in-memory counters for observability.
 * Issue #2164 — Structured logging and metrics for gateway WebSocket lifecycle.
 *
 * Uses the same Counter primitive as the worker metrics (src/worker/metrics.ts).
 * Counters reset on server restart (in-memory only, no persistence needed).
 *
 * Exposed via GET /api/gateway/status in the `metrics` field.
 */

import { Counter } from '../../worker/metrics.ts';

// ── Counters ──────────────────────────────────────────────────────────

export const gwConnectAttempts = new Counter(
  'gateway_connect_attempts_total',
  'Total gateway WS connection attempts',
);

export const gwReconnects = new Counter(
  'gateway_reconnects_total',
  'Total gateway WS reconnection attempts (excludes first connect)',
);

export const gwEventsReceived = new Counter(
  'gateway_events_received_total',
  'Total gateway WS events received',
);

export const gwChatEventsRouted = new Counter(
  'gateway_chat_events_routed_total',
  'Total chat events routed to users via RealtimeHub',
);

export const gwDuplicateEventsSuppressed = new Counter(
  'gateway_duplicate_events_suppressed_total',
  'Total duplicate chat events suppressed by seq dedup',
);

export const gwAuthFailures = new Counter(
  'gateway_auth_failures_total',
  'Total gateway WS authentication failures',
);

export const gwChatDispatchWs = new Counter(
  'gateway_chat_dispatch_ws_total',
  'Total chat messages dispatched via WS',
);

export const gwChatDispatchHttp = new Counter(
  'gateway_chat_dispatch_http_total',
  'Total chat messages dispatched via HTTP fallback',
);

// ── Snapshot ──────────────────────────────────────────────────────────

export interface GatewayMetricsSnapshot {
  connect_attempts: number;
  reconnects: number;
  events_received: number;
  chat_events_routed: number;
  duplicate_events_suppressed: number;
  auth_failures: number;
  chat_dispatch_ws: number;
  chat_dispatch_http: number;
}

/** Return a snapshot of all gateway metrics for the status endpoint. */
export function getGatewayMetrics(): GatewayMetricsSnapshot {
  return {
    connect_attempts: gwConnectAttempts.get(),
    reconnects: gwReconnects.get(),
    events_received: gwEventsReceived.get(),
    chat_events_routed: gwChatEventsRouted.get(),
    duplicate_events_suppressed: gwDuplicateEventsSuppressed.get(),
    auth_failures: gwAuthFailures.get(),
    chat_dispatch_ws: gwChatDispatchWs.get(),
    chat_dispatch_http: gwChatDispatchHttp.get(),
  };
}
