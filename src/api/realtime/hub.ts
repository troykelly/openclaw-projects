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
  addClient(socket: WebSocket, user_id?: string): string {
    const client_id = randomUUID();
    const now = new Date();

    const client: WebSocketClient = {
      client_id: client_id,
      user_id: user_id,
      socket,
      connected_at: now,
      last_ping: now,
    };

    this.clients.set(client_id, client);

    if (user_id) {
      let userSet = this.userClients.get(user_id);
      if (!userSet) {
        userSet = new Set();
        this.userClients.set(user_id, userSet);
      }
      userSet.add(client_id);
    }

    // Send connection established event
    this.sendToClient(client_id, {
      event: 'connection:established',
      data: { client_id: client_id, connected_at: now.toISOString() },
      timestamp: now.toISOString(),
    });

    return client_id;
  }

  /**
   * Remove a WebSocket client
   */
  removeClient(client_id: string): void {
    const client = this.clients.get(client_id);
    if (!client) return;

    if (client.user_id) {
      const userSet = this.userClients.get(client.user_id);
      if (userSet) {
        userSet.delete(client_id);
        if (userSet.size === 0) {
          this.userClients.delete(client.user_id);
        }
      }
    }

    this.clients.delete(client_id);
  }

  /**
   * Update client ping time
   */
  updateClientPing(client_id: string): void {
    const client = this.clients.get(client_id);
    if (client) {
      client.last_ping = new Date();
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
  getUserClientIds(user_id: string): string[] {
    const userSet = this.userClients.get(user_id);
    return userSet ? Array.from(userSet) : [];
  }

  /**
   * Send event to a specific client
   */
  sendToClient(client_id: string, event: RealtimeEvent): boolean {
    const client = this.clients.get(client_id);
    if (!client) return false;

    try {
      const socket = client.socket as WebSocket;
      if (socket.readyState === 1) {
        // WebSocket.OPEN
        socket.send(JSON.stringify(event));
        return true;
      }
    } catch (err) {
      console.error(`[RealtimeHub] Error sending to client ${client_id}:`, err);
    }

    return false;
  }

  /**
   * Send event to a specific user (all their connections)
   */
  sendToUser(user_id: string, event: RealtimeEvent): number {
    const clientIds = this.getUserClientIds(user_id);
    let sent = 0;

    for (const client_id of clientIds) {
      if (this.sendToClient(client_id, event)) {
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

    for (const client_id of this.clients.keys()) {
      if (this.sendToClient(client_id, event)) {
        sent++;
      }
    }

    return sent;
  }

  /**
   * Emit an event (broadcasts to relevant clients and publishes to PostgreSQL)
   */
  async emit(eventType: RealtimeEventType, data: unknown, user_id?: string): Promise<void> {
    const event: RealtimeEvent = {
      event: eventType,
      data,
      timestamp: new Date().toISOString(),
    };

    // Send locally
    if (user_id) {
      this.sendToUser(user_id, event);
    } else {
      this.broadcast(event);
    }

    // Publish to PostgreSQL for other processes
    await this.publish({ event: eventType, user_id: user_id, data });
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

    if (payload.user_id) {
      this.sendToUser(payload.user_id, event);
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

      for (const [client_id, client] of this.clients.entries()) {
        const socket = client.socket as WebSocket;

        // Check if client is stale (no ping response in 2 intervals)
        const timeSinceLastPing = now.getTime() - client.last_ping.getTime();
        if (timeSinceLastPing > HEARTBEAT_INTERVAL_MS * 2) {
          console.log(`[RealtimeHub] Removing stale client ${client_id}`);
          socket.close(1001, 'Connection timeout');
          this.removeClient(client_id);
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
