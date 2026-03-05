/**
 * Gateway module — connection, dispatch, and event routing.
 * Issue #2154 — Gateway connection service.
 * Issue #2155 — Chat dispatch via WS.
 * Issue #2156 — Gateway event router.
 *
 * Exports:
 * - getGatewayConnection() — get the singleton instance
 * - initGatewayConnection() — initialize the connection (call once at startup)
 * - shutdownGatewayConnection() — graceful shutdown (call on server close)
 * - dispatchChatMessage() / abortChatRun() — WS-first chat dispatch
 * - getGatewayEventRouter() — get the event router singleton
 * - initGatewayEventRouter(pool) — initialize the event router
 * - shutdownGatewayEventRouter() — graceful shutdown of event router
 */

import { GatewayConnectionService } from './connection.ts';

let instance: GatewayConnectionService | null = null;

/** Get the singleton GatewayConnectionService instance. Creates lazily if needed. */
export function getGatewayConnection(): GatewayConnectionService {
  if (!instance) {
    instance = new GatewayConnectionService();
  }
  return instance;
}

/** Initialize the gateway WebSocket connection. Safe to call once at server startup. */
export async function initGatewayConnection(): Promise<void> {
  const svc = getGatewayConnection();
  await svc.initialize();
}

/** Gracefully shut down the gateway WebSocket connection. */
export async function shutdownGatewayConnection(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}

export { GatewayConnectionService } from './connection.ts';
export type { GatewayStatus, GatewayEventHandler, GatewayFrame, GatewayEventFrame, GatewayResFrame, GatewayReqFrame } from './connection.ts';
export { dispatchChatMessage, abortChatRun } from './chat-dispatch.ts';
export type { ChatSession, ChatMessageRecord, DispatchResult } from './chat-dispatch.ts';
export { GatewayEventRouter } from './event-router.ts';

// ── Event router singleton (#2156) ──────────────────────────────────

import type { Pool } from 'pg';
import { GatewayEventRouter } from './event-router.ts';

let routerInstance: GatewayEventRouter | null = null;

/** Get the singleton GatewayEventRouter instance. Creates lazily if needed. */
export function getGatewayEventRouter(): GatewayEventRouter {
  if (!routerInstance) {
    routerInstance = new GatewayEventRouter();
  }
  return routerInstance;
}

/** Initialize the gateway event router. Call once at server startup after initGatewayConnection(). */
export function initGatewayEventRouter(pool: Pool): void {
  const router = getGatewayEventRouter();
  router.initialize(pool);
}

/** Gracefully shut down the gateway event router. */
export function shutdownGatewayEventRouter(): void {
  if (routerInstance) {
    routerInstance.shutdown();
    routerInstance = null;
  }
}
