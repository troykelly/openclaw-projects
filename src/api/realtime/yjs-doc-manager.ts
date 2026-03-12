/**
 * Server-side Yjs document manager.
 * Manages in-memory Yjs docs, room subscriptions, persistence, and authorization.
 * Part of Issue #2256
 */

import * as Y from 'yjs';
import type { Pool } from 'pg';
import { userCanAccessNote } from '../notes/service.ts';
import {
  YJS_PERSIST_DEBOUNCE_MS,
  YJS_MAX_FLUSH_INTERVAL_MS,
  YJS_DOC_EVICTION_TIMEOUT_MS,
  YJS_MAX_DOCS,
  YJS_EMBEDDING_IDLE_MS,
} from './yjs-types.ts';
import { triggerNoteEmbedding } from '../embeddings/note-integration.ts';

interface ManagedDoc {
  doc: Y.Doc;
  noteId: string;
  clients: Map<string, string>; // clientId -> userEmail
  dirty: boolean;
  persistTimer: ReturnType<typeof setTimeout> | null;
  maxFlushTimer: ReturnType<typeof setTimeout> | null;
  evictionTimer: ReturnType<typeof setTimeout> | null;
  embeddingTimer: ReturnType<typeof setTimeout> | null;
  lastPersistedAt: number;
}

export class YjsDocManager {
  private docs = new Map<string, ManagedDoc>();
  private clientRooms = new Map<string, Set<string>>(); // clientId -> Set<noteId>
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /** Join a client to a note's Yjs document room */
  async joinRoom(clientId: string, userEmail: string, noteId: string, namespaces: string[] = []): Promise<Y.Doc> {
    // Authorization check: pass namespaces for namespace-scoped access, userEmail for sharing lookups
    const canAccess = await userCanAccessNote(this.pool, noteId, namespaces, userEmail || null, 'read_write');
    if (!canAccess) {
      throw new Error('Access denied');
    }

    let managed = this.docs.get(noteId);

    if (!managed) {
      // Load or create the Yjs document
      managed = await this.loadOrCreateDoc(noteId);
      this.docs.set(noteId, managed);
    }

    // Cancel eviction timer if set
    if (managed.evictionTimer) {
      clearTimeout(managed.evictionTimer);
      managed.evictionTimer = null;
    }

    // Add client to room
    managed.clients.set(clientId, userEmail);

    // Track in client rooms
    let rooms = this.clientRooms.get(clientId);
    if (!rooms) {
      rooms = new Set();
      this.clientRooms.set(clientId, rooms);
    }
    rooms.add(noteId);

    return managed.doc;
  }

  /** Remove a client from a note's room */
  async leaveRoom(clientId: string, noteId: string): Promise<void> {
    const managed = this.docs.get(noteId);
    if (!managed) return;

    managed.clients.delete(clientId);

    // Update client rooms tracking
    const rooms = this.clientRooms.get(clientId);
    if (rooms) {
      rooms.delete(noteId);
      if (rooms.size === 0) {
        this.clientRooms.delete(clientId);
      }
    }

    // If no clients left, persist immediately, re-embed, and schedule eviction
    if (managed.clients.size === 0) {
      // Cancel the idle embedding timer — we'll trigger immediately below
      if (managed.embeddingTimer) {
        clearTimeout(managed.embeddingTimer);
        managed.embeddingTimer = null;
      }

      const wasDirty = managed.dirty;
      await this.persistDoc(noteId);

      // Trigger re-embedding if we had unsaved edits (content was modified)
      if (wasDirty) {
        triggerNoteEmbedding(this.pool, noteId);
        console.log(`[YjsDocManager] Triggered re-embedding on last client leave for ${noteId}`);
      }

      managed.evictionTimer = setTimeout(() => {
        this.evictDoc(noteId);
      }, YJS_DOC_EVICTION_TIMEOUT_MS);
    }
  }

  /** Remove a client from all rooms (on disconnect) */
  async leaveAllRooms(clientId: string): Promise<void> {
    const rooms = this.clientRooms.get(clientId);
    if (!rooms) return;

    for (const noteId of Array.from(rooms)) {
      await this.leaveRoom(clientId, noteId);
    }
  }

  /** Check if client is subscribed to a room */
  isClientInRoom(clientId: string, noteId: string): boolean {
    const rooms = this.clientRooms.get(clientId);
    return rooms?.has(noteId) ?? false;
  }

  /** Get all rooms a client is in */
  getClientRooms(clientId: string): string[] {
    const rooms = this.clientRooms.get(clientId);
    return rooms ? Array.from(rooms) : [];
  }

  /** Get number of clients in a room */
  getRoomClientCount(noteId: string): number {
    return this.docs.get(noteId)?.clients.size ?? 0;
  }

  /** Check if a note has an active in-memory doc */
  hasActiveDoc(noteId: string): boolean {
    return this.docs.has(noteId);
  }

  /** Get the Yjs doc for a note (if active) */
  getDoc(noteId: string): Y.Doc | null {
    return this.docs.get(noteId)?.doc ?? null;
  }

  /** Get total number of in-memory docs */
  getDocCount(): number {
    return this.docs.size;
  }

  /** Get all client IDs in a room */
  getRoomClientIds(noteId: string): string[] {
    const managed = this.docs.get(noteId);
    return managed ? Array.from(managed.clients.keys()) : [];
  }

  /** Mark a doc as dirty (needs persistence) */
  markDirty(noteId: string): void {
    const managed = this.docs.get(noteId);
    if (!managed) return;

    managed.dirty = true;

    // Reset debounce timer
    if (managed.persistTimer) {
      clearTimeout(managed.persistTimer);
    }
    managed.persistTimer = setTimeout(() => {
      this.persistDoc(noteId).catch((err) => {
        console.error(`[YjsDocManager] Persistence failed for ${noteId}:`, err);
      });
    }, YJS_PERSIST_DEBOUNCE_MS);

    // Set max flush timer if not already set
    if (!managed.maxFlushTimer) {
      managed.maxFlushTimer = setTimeout(() => {
        managed.maxFlushTimer = null;
        if (managed.dirty) {
          this.persistDoc(noteId).catch((err) => {
            console.error(`[YjsDocManager] Max flush failed for ${noteId}:`, err);
          });
        }
      }, YJS_MAX_FLUSH_INTERVAL_MS);
    }

    // Reset trailing-edge embedding timer — fires after editing quiesces
    if (managed.embeddingTimer) {
      clearTimeout(managed.embeddingTimer);
    }
    managed.embeddingTimer = setTimeout(() => {
      managed.embeddingTimer = null;
      triggerNoteEmbedding(this.pool, noteId);
      console.log(`[YjsDocManager] Triggered re-embedding for idle note ${noteId}`);
    }, YJS_EMBEDDING_IDLE_MS);
  }

  /** Persist a doc's state to the database */
  async persistDoc(noteId: string): Promise<void> {
    const managed = this.docs.get(noteId);
    if (!managed || !managed.dirty) return;

    // Clear timers
    if (managed.persistTimer) {
      clearTimeout(managed.persistTimer);
      managed.persistTimer = null;
    }
    if (managed.maxFlushTimer) {
      clearTimeout(managed.maxFlushTimer);
      managed.maxFlushTimer = null;
    }

    try {
      // Encode full state as update (standard Yjs persistence format)
      const state = Y.encodeStateAsUpdate(managed.doc);

      // @lexical/yjs CollaborationPlugin always stores content at the 'root' key as Y.XmlText
      // (see createBinding() in LexicalYjs.dev.js line 832). The `id` prop only affects docMap
      // lookup, not the Yjs shared type key. (#2472)
      const xmlText = managed.doc.get('root', Y.XmlText);
      const content = xmlText.toString();

      // Check state size and warn if too large
      if (state.byteLength > 1024 * 1024) {
        console.warn(`[YjsDocManager] Large yjs_state for ${noteId}: ${state.byteLength} bytes`);
      }

      // Persist with embedding skip using a pinned client connection for
      // transactional SET LOCAL (pool.query may dispatch to different backends).
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL app.skip_embedding_pending = 'true'`);
        const result = await client.query(
          `UPDATE note SET yjs_state = $1, content = $2 WHERE id = $3 AND deleted_at IS NULL`,
          [Buffer.from(state), content, noteId],
        );
        await client.query('COMMIT');

        if ((result.rowCount ?? 0) === 0) {
          console.warn(`[YjsDocManager] Note ${noteId} not found or deleted during persistence`);
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      managed.dirty = false;
      managed.lastPersistedAt = Date.now();

      console.log(`[YjsDocManager] Persisted ${noteId} (${state.byteLength} bytes)`);
    } catch (err) {
      console.error(`[YjsDocManager] Failed to persist ${noteId}:`, err);
      // Re-mark as dirty so it retries
      managed.dirty = true;
    }
  }

  /** Flush all dirty docs (for graceful shutdown) */
  async flushAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const noteId of this.docs.keys()) {
      const managed = this.docs.get(noteId);
      if (managed?.dirty) {
        promises.push(this.persistDoc(noteId));
      }
    }
    await Promise.allSettled(promises);
  }

  /** Shut down the manager */
  async shutdown(): Promise<void> {
    await this.flushAll();
    for (const managed of this.docs.values()) {
      if (managed.persistTimer) clearTimeout(managed.persistTimer);
      if (managed.maxFlushTimer) clearTimeout(managed.maxFlushTimer);
      if (managed.evictionTimer) clearTimeout(managed.evictionTimer);
      if (managed.embeddingTimer) clearTimeout(managed.embeddingTimer);
      managed.doc.destroy();
    }
    this.docs.clear();
    this.clientRooms.clear();
  }

  /** Load a Yjs doc from DB or create a new one */
  private async loadOrCreateDoc(noteId: string): Promise<ManagedDoc> {
    // Enforce max docs (LRU eviction of zero-client docs)
    if (this.docs.size >= YJS_MAX_DOCS) {
      this.evictLeastRecentlyUsed();
    }

    const result = await this.pool.query(
      `SELECT yjs_state, content FROM note WHERE id = $1 AND deleted_at IS NULL`,
      [noteId],
    );

    if (result.rowCount === 0) {
      throw new Error('Note not found');
    }

    const row = result.rows[0];
    const doc = new Y.Doc();

    if (row.yjs_state) {
      // Load existing Yjs state
      Y.applyUpdate(doc, new Uint8Array(row.yjs_state));
    }
    // If yjs_state is NULL, the doc starts empty — CollaborationPlugin will initialize it
    // from the note's content on the client side via initialEditorState

    return {
      doc,
      noteId,
      clients: new Map(),
      dirty: false,
      persistTimer: null,
      maxFlushTimer: null,
      evictionTimer: null,
      embeddingTimer: null,
      lastPersistedAt: Date.now(),
    };
  }

  /** Evict an idle doc from memory */
  private evictDoc(noteId: string): void {
    const managed = this.docs.get(noteId);
    if (!managed) return;

    // Never evict a doc with active connections
    if (managed.clients.size > 0) return;

    if (managed.persistTimer) clearTimeout(managed.persistTimer);
    if (managed.maxFlushTimer) clearTimeout(managed.maxFlushTimer);
    if (managed.evictionTimer) clearTimeout(managed.evictionTimer);
    if (managed.embeddingTimer) clearTimeout(managed.embeddingTimer);
    managed.doc.destroy();
    this.docs.delete(noteId);

    console.log(`[YjsDocManager] Evicted idle doc ${noteId}`);
  }

  /** Evict the least recently persisted zero-client doc */
  private evictLeastRecentlyUsed(): void {
    let oldestNoteId: string | null = null;
    let oldestTime = Infinity;

    for (const [noteId, managed] of this.docs) {
      if (managed.clients.size === 0 && managed.lastPersistedAt < oldestTime) {
        oldestTime = managed.lastPersistedAt;
        oldestNoteId = noteId;
      }
    }

    if (oldestNoteId) {
      this.evictDoc(oldestNoteId);
    }
  }
}
