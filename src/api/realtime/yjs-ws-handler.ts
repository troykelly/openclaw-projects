/**
 * WebSocket handler for Yjs collaborative editing using standard y-protocols.
 *
 * This handler implements the server side of the y-websocket protocol:
 * - Responds to sync step 1 with sync step 2
 * - Applies incoming updates to the server-side Y.Doc
 * - Broadcasts updates and awareness to other clients in the room
 * - Debounced persistence of Y.Doc state to PostgreSQL
 *
 * Part of Issue #2256
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { YjsDocManager } from './yjs-doc-manager.ts';
import { YjsRateLimiter } from './yjs-rate-limiter.ts';
import {
  YJS_RATE_LIMIT_PER_SECOND,
  YJS_RATE_LIMIT_GLOBAL_PER_SECOND,
  YJS_MAX_BINARY_SIZE,
} from './yjs-types.ts';

/** y-websocket message type constants (must match client) */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

interface YjsClient {
  clientId: string;
  userEmail: string;
  noteId: string;
  socket: WebSocket & { readyState: number; send: (data: ArrayBuffer | Uint8Array) => void };
}

export class YjsWsHandler {
  private docManager: YjsDocManager;
  private rateLimiter: YjsRateLimiter;
  /** Map of noteId -> Set of YjsClient for broadcast */
  private roomClients = new Map<string, Set<YjsClient>>();
  /** Map of clientId -> YjsClient for cleanup */
  private clientMap = new Map<string, YjsClient>();
  /** Awareness instances per noteId */
  private awarenessMap = new Map<string, awarenessProtocol.Awareness>();

  constructor(docManager: YjsDocManager) {
    this.docManager = docManager;
    this.rateLimiter = new YjsRateLimiter(YJS_RATE_LIMIT_PER_SECOND, YJS_RATE_LIMIT_GLOBAL_PER_SECOND);
  }

  /** Handle a new WebSocket connection for a note */
  async handleConnection(
    socket: YjsClient['socket'],
    clientId: string,
    userEmail: string,
    noteId: string,
  ): Promise<void> {
    // Join the room (auth check happens inside docManager.joinRoom)
    const doc = await this.docManager.joinRoom(clientId, userEmail, noteId);

    const client: YjsClient = { clientId, userEmail, noteId, socket };

    // Track client
    this.clientMap.set(clientId, client);
    let roomSet = this.roomClients.get(noteId);
    if (!roomSet) {
      roomSet = new Set();
      this.roomClients.set(noteId, roomSet);
    }
    roomSet.add(client);

    // Get or create awareness for this room
    let awareness = this.awarenessMap.get(noteId);
    if (!awareness) {
      awareness = new awarenessProtocol.Awareness(doc);
      this.awarenessMap.set(noteId, awareness);
    }

    // Send sync step 1 to the new client (server → client)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    socket.send(encoding.toUint8Array(encoder));

    // Send sync step 2 (full state as update)
    const encoder2 = encoding.createEncoder();
    encoding.writeVarUint(encoder2, MESSAGE_SYNC);
    syncProtocol.writeSyncStep2(encoder2, doc);
    socket.send(encoding.toUint8Array(encoder2));

    // Send current awareness states to the new client
    const awarenessStates = awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awarenessStates.keys())),
      );
      socket.send(encoding.toUint8Array(awarenessEncoder));
    }
  }

  /** Handle an incoming binary message from a client */
  handleMessage(clientId: string, data: ArrayBuffer | Buffer): void {
    const client = this.clientMap.get(clientId);
    if (!client) return;

    const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    // Size check
    if (buf.byteLength > YJS_MAX_BINARY_SIZE) {
      console.warn(`[YjsWsHandler] Message too large from ${clientId}: ${buf.byteLength} bytes`);
      return;
    }

    // Rate limit check
    if (!this.rateLimiter.allowGlobal(clientId) || !this.rateLimiter.allow(clientId, client.noteId)) {
      return;
    }

    const decoder = decoding.createDecoder(buf);
    const messageType = decoding.readVarUint(decoder);

    const doc = this.docManager.getDoc(client.noteId);
    if (!doc) return;

    if (messageType === MESSAGE_SYNC) {
      // Process sync message and generate response
      const responseEncoder = encoding.createEncoder();
      encoding.writeVarUint(responseEncoder, MESSAGE_SYNC);
      const syncMessageType = syncProtocol.readSyncMessage(decoder, responseEncoder, doc, null);

      // If there's a response (e.g., sync step 2 in response to sync step 1), send it back
      if (encoding.length(responseEncoder) > 1) {
        client.socket.send(encoding.toUint8Array(responseEncoder));
      }

      // If this was an update (sync step 2 or update), mark dirty and broadcast
      if (syncMessageType === syncProtocol.messageYjsSyncStep2 || syncMessageType === syncProtocol.messageYjsUpdate) {
        this.docManager.markDirty(client.noteId);
        // Broadcast the original message to other clients
        this.broadcastToRoom(client.noteId, clientId, buf);
      }
    } else if (messageType === MESSAGE_AWARENESS) {
      // Apply awareness update
      const awareness = this.awarenessMap.get(client.noteId);
      if (awareness) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), client);
      }
      // Broadcast awareness to other clients
      this.broadcastToRoom(client.noteId, clientId, buf);
    }
  }

  /** Handle client disconnect */
  async handleDisconnect(clientId: string): Promise<void> {
    const client = this.clientMap.get(clientId);
    if (!client) return;

    // Remove from room set
    const roomSet = this.roomClients.get(client.noteId);
    if (roomSet) {
      roomSet.delete(client);
      if (roomSet.size === 0) {
        this.roomClients.delete(client.noteId);
        // Clean up awareness when room is empty
        const awareness = this.awarenessMap.get(client.noteId);
        if (awareness) {
          awareness.destroy();
          this.awarenessMap.delete(client.noteId);
        }
      }
    }

    // Remove from client map
    this.clientMap.delete(clientId);

    // Clean up rate limiter state
    this.rateLimiter.cleanup(clientId);

    // Leave room in doc manager (handles persistence + eviction)
    await this.docManager.leaveRoom(clientId, client.noteId);
  }

  /** Check if handler is managing any rooms */
  hasActiveDoc(noteId: string): boolean {
    return this.docManager.hasActiveDoc(noteId);
  }

  /** Get doc manager for REST API coordination */
  getDocManager(): YjsDocManager {
    return this.docManager;
  }

  /** Graceful shutdown */
  async shutdown(): Promise<void> {
    // Clean up all awareness instances
    for (const awareness of this.awarenessMap.values()) {
      awareness.destroy();
    }
    this.awarenessMap.clear();
    this.roomClients.clear();
    this.clientMap.clear();
    await this.docManager.shutdown();
  }

  /** Broadcast a binary message to all clients in a room except the sender */
  private broadcastToRoom(noteId: string, excludeClientId: string, data: Uint8Array): void {
    const roomSet = this.roomClients.get(noteId);
    if (!roomSet) return;

    for (const client of roomSet) {
      if (client.clientId === excludeClientId) continue;
      try {
        if (client.socket.readyState === 1) { // OPEN
          client.socket.send(data);
        }
      } catch (err) {
        console.debug(`[YjsWsHandler] Broadcast send failed for ${client.clientId}:`, err instanceof Error ? err.message : err);
      }
    }
  }
}
