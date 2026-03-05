/**
 * Gateway module — connection, dispatch, event routing, agent cache, and presence tracking.
 * Issue #2154 — Gateway connection service.
 * Issue #2155 — Chat dispatch via WS.
 * Issue #2156 — Gateway event router.
 * Issues #2157, #2158 — Agent cache, presence tracker.
 *
 * Exports:
 * - getGatewayConnection() — get the singleton connection instance
 * - initGatewayConnection() — initialize the connection (call once at startup)
 * - shutdownGatewayConnection() — graceful shutdown (call on server close)
 * - dispatchChatMessage() / abortChatRun() — WS-first chat dispatch
 * - getGatewayEventRouter() — get the event router singleton
 * - initGatewayEventRouter(pool) — initialize the event router
 * - shutdownGatewayEventRouter() — graceful shutdown of event router
 * - getAgentCache() — get the singleton agent cache
 * - getPresenceTracker() — get the singleton presence tracker
 * - initPresenceTracker() — initialize and start presence tracking
 * - initAgentCache() — initialize agent cache with presence tracker
 */

import { GatewayConnectionService } from './connection.ts';
import { AgentPresenceTracker } from './presence-tracker.ts';
import { AgentCache } from './agent-cache.ts';

let instance: GatewayConnectionService | null = null;
let presenceTracker: AgentPresenceTracker | null = null;
let agentCache: AgentCache | null = null;

/** Get the singleton GatewayConnectionService instance. Creates lazily if needed. */
export function getGatewayConnection(): GatewayConnectionService {
  if (!instance) {
    instance = new GatewayConnectionService();
  }
  return instance;
}

/** Get the singleton AgentPresenceTracker. Creates lazily if needed. */
export function getPresenceTracker(): AgentPresenceTracker {
  if (!presenceTracker) {
    presenceTracker = new AgentPresenceTracker();
  }
  return presenceTracker;
}

/** Get the singleton AgentCache. Creates lazily if needed. */
export function getAgentCache(): AgentCache {
  if (!agentCache) {
    agentCache = new AgentCache(getGatewayConnection(), getPresenceTracker());
  }
  return agentCache;
}

/** Initialize the gateway WebSocket connection. Safe to call once at server startup. */
export async function initGatewayConnection(): Promise<void> {
  const svc = getGatewayConnection();
  await svc.initialize();
}

/** Initialize presence tracker: registers event handler on gateway connection. */
export function initPresenceTracker(): void {
  const conn = getGatewayConnection();
  const tracker = getPresenceTracker();

  // Register for all gateway events
  conn.onEvent((frame) => {
    tracker.handleEvent(frame);
  });

  // On disconnect: set all tracked agents to "unknown"
  conn.onDisconnect(() => {
    tracker.onDisconnect();
  });

  // Start periodic pruning
  tracker.startPruning();
}

/** Initialize agent cache: registers disconnect/reconnect hooks. */
export function initAgentCache(): void {
  const conn = getGatewayConnection();
  const cache = getAgentCache();

  // On disconnect: invalidate cache
  conn.onDisconnect(() => {
    cache.invalidate();
  });

  // On reconnect: eagerly refresh agent list
  conn.onConnected(() => {
    cache.refresh().catch((err) => {
      console.error('[AgentCache] Eager refresh on reconnect failed:', err);
    });
  });
}

/** Gracefully shut down the gateway WebSocket connection and subsystems. */
export async function shutdownGatewayConnection(): Promise<void> {
  if (presenceTracker) {
    presenceTracker.shutdown();
    presenceTracker = null;
  }
  agentCache = null;
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
export { AgentPresenceTracker, type AgentStatus } from './presence-tracker.ts';
export { AgentCache, type CachedAgent } from './agent-cache.ts';

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
