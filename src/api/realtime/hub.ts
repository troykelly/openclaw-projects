/**
 * Real-time event hub for managing WebSocket connections and events.
 * Part of Issue #213.
 */

import type { Pool, PoolClient } from 'pg';
import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { RealtimeEvent, RealtimeEventType, NotifyPayload, WebSocketClient } from './types.ts';

const HEARTBEAT_INTERVAL_MS = 30000;
const PG_CHANNEL = 'realtime_events';

/**
 * Real-time event hub singleton
 */
export class RealtimeHub {
  private clients: Map<string, WebSocketClient> = new Map();
  private userClients: Map<string, Set<string>> = new Map();
  private pool: Pool | null = null;
  private listenerClient: PoolClient | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isListening = false;

  /**
   * Initialize the hub with a database pool
   */
  async initialize(pool: Pool): Promise<void> {
    this.pool = pool;
    await this.startListener();
    this.startHeartbeat();
  }

  /**
   * Shut down the hub
   */
  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.listenerClient) {
      await this.listenerClient.query(`UNLISTEN ${PG_CHANNEL}`);
      this.listenerClient.release();
      this.listenerClient = null;
      this.isListening = false;
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      const socket = client.socket as WebSocket;
      socket.close(1001, 'Server shutdown');
    }

    this.clients.clear();
    this.userClients.clear();
  }

  /**
   * Add a WebSocket client
   */
  addClient(socket: WebSocket, userId?: string): string {
    const clientId = randomUUID();
    const now = new Date();

    const client: WebSocketClient = {
      clientId,
      userId,
      socket,
      connectedAt: now,
      lastPing: now,
    };

    this.clients.set(clientId, client);

    if (userId) {
      let userSet = this.userClients.get(userId);
      if (!userSet) {
        userSet = new Set();
        this.userClients.set(userId, userSet);
      }
      userSet.add(clientId);
    }

    // Send connection established event
    this.sendToClient(clientId, {
      event: 'connection:established',
      data: { clientId, connectedAt: now.toISOString() },
      timestamp: now.toISOString(),
    });

    return clientId;
  }

  /**
   * Remove a WebSocket client
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (client.userId) {
      const userSet = this.userClients.get(client.userId);
      if (userSet) {
        userSet.delete(clientId);
        if (userSet.size === 0) {
          this.userClients.delete(client.userId);
        }
      }
    }

    this.clients.delete(clientId);
  }

  /**
   * Update client ping time
   */
  updateClientPing(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastPing = new Date();
    }
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get client IDs for a user
   */
  getUserClientIds(userId: string): string[] {
    const userSet = this.userClients.get(userId);
    return userSet ? Array.from(userSet) : [];
  }

  /**
   * Send event to a specific client
   */
  sendToClient(clientId: string, event: RealtimeEvent): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    try {
      const socket = client.socket as WebSocket;
      if (socket.readyState === 1) {
        // WebSocket.OPEN
        socket.send(JSON.stringify(event));
        return true;
      }
    } catch (err) {
      console.error(`[RealtimeHub] Error sending to client ${clientId}:`, err);
    }

    return false;
  }

  /**
   * Send event to a specific user (all their connections)
   */
  sendToUser(userId: string, event: RealtimeEvent): number {
    const clientIds = this.getUserClientIds(userId);
    let sent = 0;

    for (const clientId of clientIds) {
      if (this.sendToClient(clientId, event)) {
        sent++;
      }
    }

    return sent;
  }

  /**
   * Broadcast event to all clients
   */
  broadcast(event: RealtimeEvent): number {
    let sent = 0;

    for (const clientId of this.clients.keys()) {
      if (this.sendToClient(clientId, event)) {
        sent++;
      }
    }

    return sent;
  }

  /**
   * Emit an event (broadcasts to relevant clients and publishes to PostgreSQL)
   */
  async emit(eventType: RealtimeEventType, data: unknown, userId?: string): Promise<void> {
    const event: RealtimeEvent = {
      event: eventType,
      data,
      timestamp: new Date().toISOString(),
    };

    // Send locally
    if (userId) {
      this.sendToUser(userId, event);
    } else {
      this.broadcast(event);
    }

    // Publish to PostgreSQL for other processes
    await this.publish({ event: eventType, userId, data });
  }

  /**
   * Publish event to PostgreSQL NOTIFY
   */
  private async publish(payload: NotifyPayload): Promise<void> {
    if (!this.pool) return;

    try {
      await this.pool.query(`SELECT pg_notify($1, $2)`, [PG_CHANNEL, JSON.stringify(payload)]);
    } catch (err) {
      console.error('[RealtimeHub] Error publishing event:', err);
    }
  }

  /**
   * Start PostgreSQL LISTEN
   */
  private async startListener(): Promise<void> {
    if (!this.pool || this.isListening) return;

    try {
      this.listenerClient = await this.pool.connect();
      await this.listenerClient.query(`LISTEN ${PG_CHANNEL}`);
      this.isListening = true;

      this.listenerClient.on('notification', (msg) => {
        if (msg.channel === PG_CHANNEL && msg.payload) {
          try {
            const payload: NotifyPayload = JSON.parse(msg.payload);
            this.handleNotification(payload);
          } catch (err) {
            console.error('[RealtimeHub] Error parsing notification:', err);
          }
        }
      });

      this.listenerClient.on('error', (err) => {
        console.error('[RealtimeHub] Listener error:', err);
        this.isListening = false;
        // Try to reconnect after a delay
        setTimeout(() => this.startListener(), 5000);
      });
    } catch (err) {
      console.error('[RealtimeHub] Error starting listener:', err);
      this.isListening = false;
    }
  }

  /**
   * Handle notification from PostgreSQL
   */
  private handleNotification(payload: NotifyPayload): void {
    const event: RealtimeEvent = {
      event: payload.event,
      data: payload.data,
      timestamp: new Date().toISOString(),
    };

    if (payload.userId) {
      this.sendToUser(payload.userId, event);
    } else {
      this.broadcast(event);
    }
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = new Date();
      const pingEvent: RealtimeEvent = {
        event: 'connection:ping',
        data: { timestamp: now.toISOString() },
        timestamp: now.toISOString(),
      };

      for (const [clientId, client] of this.clients.entries()) {
        const socket = client.socket as WebSocket;

        // Check if client is stale (no ping response in 2 intervals)
        const timeSinceLastPing = now.getTime() - client.lastPing.getTime();
        if (timeSinceLastPing > HEARTBEAT_INTERVAL_MS * 2) {
          console.log(`[RealtimeHub] Removing stale client ${clientId}`);
          socket.close(1001, 'Connection timeout');
          this.removeClient(clientId);
          continue;
        }

        // Send ping
        try {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify(pingEvent));
          }
        } catch {
          // Socket error, will be cleaned up on next interval
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
}

// Global singleton instance
let hubInstance: RealtimeHub | null = null;

/**
 * Get the global RealtimeHub instance
 */
export function getRealtimeHub(): RealtimeHub {
  if (!hubInstance) {
    hubInstance = new RealtimeHub();
  }
  return hubInstance;
}

/**
 * Reset the hub (for testing)
 */
export async function resetRealtimeHub(): Promise<void> {
  if (hubInstance) {
    await hubInstance.shutdown();
    hubInstance = null;
  }
}
