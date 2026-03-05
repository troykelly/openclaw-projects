/**
 * Gateway connection singleton module.
 * Issue #2154 — Gateway connection service.
 *
 * Exports:
 * - getGatewayConnection() — get the singleton instance
 * - initGatewayConnection() — initialize the connection (call once at startup)
 * - shutdownGatewayConnection() — graceful shutdown (call on server close)
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
