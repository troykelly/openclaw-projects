/**
 * WebSocket message handler for Yjs protocol.
 * Handles binary Yjs frames and JSON control messages (yjs:join, yjs:leave).
 * Part of Issue #2256
 */

import type { Pool } from 'pg';
import type { WebSocketClient } from './types.ts';
import { YjsDocManager } from './yjs-doc-manager.ts';
import { YjsRateLimiter } from './yjs-rate-limiter.ts';
import {
  YJS_MSG_SYNC,
  YJS_MSG_AWARENESS,
  YJS_MAX_BINARY_SIZE,
  YJS_MAX_AWARENESS_SIZE,
  YJS_RATE_LIMIT_PER_SECOND,
  YJS_RATE_LIMIT_GLOBAL_PER_SECOND,
} from './yjs-types.ts';

export class YjsHandler {
  private docManager: YjsDocManager;
  private rateLimiter: YjsRateLimiter;
  private enabled: boolean;

  constructor(pool: Pool, enabled?: boolean) {
    this.docManager = new YjsDocManager(pool);
    this.rateLimiter = new YjsRateLimiter(YJS_RATE_LIMIT_PER_SECOND, YJS_RATE_LIMIT_GLOBAL_PER_SECOND);
    this.enabled = enabled ?? (process.env.ENABLE_YJS_COLLAB !== 'false');
  }

  /** Handle a JSON control message (yjs:join, yjs:leave) */
  async handleControlMessage(
    client: WebSocketClient,
    message: { type: string; noteId?: string; [key: string]: unknown },
  ): Promise<void> {
    if (!this.enabled) {
      this.sendError(client, message.noteId ?? '', 'Collaborative editing is disabled');
      return;
    }

    const noteId = message.noteId;
    if (!noteId || typeof noteId !== 'string') {
      this.sendError(client, '', 'Missing noteId');
      return;
    }

    switch (message.type) {
      case 'yjs:join':
        await this.handleJoin(client, noteId);
        break;
      case 'yjs:leave':
        await this.handleLeave(client, noteId);
        break;
      default:
        this.sendError(client, noteId, `Unknown message type: ${message.type}`);
    }
  }

  /** Handle a binary Yjs frame */
  handleBinaryMessage(client: WebSocketClient, data: Buffer): void {
    if (!this.enabled || data.length < 2) return;

    // Validate size
    if (data.length > YJS_MAX_BINARY_SIZE) {
      console.warn(`[YjsHandler] Binary message too large from ${client.client_id}: ${data.length} bytes`);
      return;
    }

    // Parse binary frame: [1 byte type][noteId null-terminated][payload]
    const msgType = data[0];
    const nullIndex = data.indexOf(0x00, 1);
    if (nullIndex === -1) return;

    const noteId = data.subarray(1, nullIndex).toString('utf-8');
    const payload = data.subarray(nullIndex + 1);

    // Room membership check
    if (!this.docManager.isClientInRoom(client.client_id, noteId)) {
      return; // Silently drop
    }

    // Global rate limit check
    if (!this.rateLimiter.allowGlobal(client.client_id)) {
      return; // Silently drop
    }

    // Per-room rate limit check
    if (!this.rateLimiter.allow(client.client_id, noteId)) {
      return; // Silently drop
    }

    // Awareness size check
    if (msgType === YJS_MSG_AWARENESS && payload.length > YJS_MAX_AWARENESS_SIZE) {
      return;
    }

    // Get the in-memory doc
    const doc = this.docManager.getDoc(noteId);
    if (!doc) return;

    if (msgType === YJS_MSG_SYNC) {
      // Mark doc as dirty for persistence
      this.docManager.markDirty(noteId);
    }

    // Broadcast to other clients in the room
    this.broadcastToRoom(noteId, client.client_id, data);
  }

  /** Handle client disconnect */
  async handleDisconnect(clientId: string): Promise<void> {
    await this.docManager.leaveAllRooms(clientId);
  }

  /** Check if client is in a room */
  isClientInRoom(clientId: string, noteId: string): boolean {
    return this.docManager.isClientInRoom(clientId, noteId);
  }

  /** Check if a note has an active Yjs doc */
  hasActiveDoc(noteId: string): boolean {
    return this.docManager.hasActiveDoc(noteId);
  }

  /** Get the doc manager (for REST API coordination) */
  getDocManager(): YjsDocManager {
    return this.docManager;
  }

  /** Check if Yjs collaboration is enabled */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Graceful shutdown */
  async shutdown(): Promise<void> {
    await this.docManager.shutdown();
  }

  private async handleJoin(client: WebSocketClient, noteId: string): Promise<void> {
    try {
      const userEmail = client.user_id ?? '';
      await this.docManager.joinRoom(client.client_id, userEmail, noteId);
      console.log(`[YjsHandler] Client ${client.client_id} joined room ${noteId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Join failed';
      this.sendError(client, noteId, message);
    }
  }

  private async handleLeave(client: WebSocketClient, noteId: string): Promise<void> {
    await this.docManager.leaveRoom(client.client_id, noteId);
    console.log(`[YjsHandler] Client ${client.client_id} left room ${noteId}`);
  }

  private broadcastToRoom(noteId: string, excludeClientId: string, data: Buffer): void {
    const clientIds = this.docManager.getRoomClientIds(noteId);
    for (const clientId of clientIds) {
      if (clientId === excludeClientId) continue;
      // Send raw binary via the hub - this is handled by the server.ts wiring
      // The hub's sendToClient sends JSON, so we need direct socket access
      // This will be wired up in server.ts where we have access to the raw socket
    }
  }

  private sendError(client: WebSocketClient, noteId: string, error: string): void {
    try {
      const socket = client.socket as { readyState: number; send: (data: string) => void };
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'yjs:error', noteId, error }));
      }
    } catch {
      // Client may have disconnected
    }
  }
}
