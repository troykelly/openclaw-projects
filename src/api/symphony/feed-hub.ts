/**
 * Symphony WebSocket Feed Hub
 *
 * Manages authenticated WebSocket connections for real-time Symphony events.
 * JWT authentication with 5s timeout. Namespace-scoped event filtering.
 * Token refresh via client message. Heartbeat monitoring.
 *
 * Issue #2205 — WebSocket Feed (Authenticated, Namespace-Scoped)
 */

import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { Counter, Gauge } from '../../worker/metrics.ts';

// ── Types ────────────────────────────────────────────────────────────────

/** Symphony event types that flow over the feed. */
export type SymphonyFeedEventType =
  | 'symphony:run_state_changed'
  | 'symphony:stage_updated'
  | 'symphony:provisioning_progress'
  | 'symphony:run_failed'
  | 'symphony:run_succeeded'
  | 'symphony:queue_changed'
  | 'symphony:heartbeat';

/** Message sent from server to client. */
export interface SymphonyFeedEvent {
  type: SymphonyFeedEventType;
  data: unknown;
  timestamp: string;
  /** Namespace this event belongs to. */
  namespace: string;
}

/** Message sent from client to server. */
export interface SymphonyFeedClientMessage {
  type: 'auth' | 'auth_refresh' | 'pong' | 'subscribe' | 'unsubscribe';
  /** JWT token (for auth and auth_refresh messages). */
  token?: string;
  /** Namespace filter (for subscribe/unsubscribe). */
  namespace?: string;
}

/** Authenticated connection state. */
interface FeedConnection {
  id: string;
  socket: WebSocket;
  /** User email from JWT. Null until authenticated. */
  userEmail: string | null;
  /** Namespaces this user has access to. */
  allowedNamespaces: Set<string>;
  /** Timer for auth timeout (5s). */
  authTimer: ReturnType<typeof setTimeout> | null;
  /** When the connection was established. */
  connectedAt: Date;
  /** Last ping/pong time. */
  lastPong: Date;
  /** JWT expiration timestamp (seconds since epoch). */
  tokenExp: number | null;
  /** Mutex flag to serialize auth_refresh operations. */
  refreshing: boolean;
}

/** JWT verification function signature (injected for testability). */
export type JwtVerifier = (token: string) => Promise<{ sub: string; exp: number }>;

/** Namespace resolver: given an email, return allowed namespaces. */
export type NamespaceResolver = (email: string) => Promise<string[]>;

// ── Constants ────────────────────────────────────────────────────────────

/** Time to wait for client authentication after connection (ms). */
export const AUTH_TIMEOUT_MS = 5000;

/** Heartbeat interval (ms). */
const HEARTBEAT_INTERVAL_MS = 30000;

/** Stale connection threshold (ms). No pong in 2x heartbeat = stale. */
const STALE_THRESHOLD_MS = HEARTBEAT_INTERVAL_MS * 2;

const LOG_PREFIX = '[SymphonyFeed]';

// ── Metrics ──────────────────────────────────────────────────────────────

export const symphonyFeedConnections = new Gauge(
  'symphony_feed_connections',
  'Number of active Symphony feed WebSocket connections',
);

export const symphonyFeedAuthFailures = new Counter(
  'symphony_feed_auth_failures_total',
  'Total Symphony feed authentication failures',
);

export const symphonyFeedEventsEmitted = new Counter(
  'symphony_feed_events_emitted_total',
  'Total Symphony feed events emitted to clients',
);

export const symphonyFeedAuthTimeouts = new Counter(
  'symphony_feed_auth_timeouts_total',
  'Total Symphony feed auth timeouts (5s)',
);

// ── Hub ──────────────────────────────────────────────────────────────────

export class SymphonyFeedHub {
  private connections = new Map<string, FeedConnection>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private verifyJwt: JwtVerifier;
  private resolveNamespaces: NamespaceResolver;

  constructor(opts: {
    verifyJwt: JwtVerifier;
    resolveNamespaces: NamespaceResolver;
  }) {
    this.verifyJwt = opts.verifyJwt;
    this.resolveNamespaces = opts.resolveNamespaces;
  }

  /** Start heartbeat loop. */
  start(): void {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  /** Stop heartbeat and close all connections. */
  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const conn of this.connections.values()) {
      this.cleanupConnection(conn, 1001, 'Server shutdown');
    }
    this.connections.clear();
    symphonyFeedConnections.set(0);
  }

  /**
   * Handle a new WebSocket connection.
   *
   * Authentication flow:
   * 1. If Authorization header has a valid JWT, authenticate immediately.
   * 2. Otherwise, wait up to 5s for a { type: "auth", token: "..." } message.
   * 3. If no auth within 5s, disconnect with code 4001.
   */
  async handleConnection(
    socket: WebSocket,
    headerToken?: string,
  ): Promise<string> {
    const connId = randomUUID();
    const now = new Date();

    const conn: FeedConnection = {
      id: connId,
      socket,
      userEmail: null,
      allowedNamespaces: new Set(),
      authTimer: null,
      connectedAt: now,
      lastPong: now,
      tokenExp: null,
      refreshing: false,
    };

    this.connections.set(connId, conn);
    symphonyFeedConnections.set(this.connections.size);

    // Try header-based auth first
    if (headerToken) {
      const authResult = await this.authenticateConnection(conn, headerToken);
      if (!authResult) {
        this.cleanupConnection(conn, 4001, 'Authentication failed');
        return connId;
      }
    } else {
      // Start 5s auth timeout
      conn.authTimer = setTimeout(() => {
        if (!conn.userEmail) {
          symphonyFeedAuthTimeouts.inc();
          console.warn(`${LOG_PREFIX} Auth timeout for connection ${connId}`);
          this.cleanupConnection(conn, 4001, 'Authentication timeout');
        }
      }, AUTH_TIMEOUT_MS);
    }

    // Set up message handler
    socket.on('message', (data: Buffer | string) => {
      this.handleClientMessage(conn, data.toString());
    });

    socket.on('close', () => {
      this.removeConnection(connId);
    });

    socket.on('error', (err: Error) => {
      console.error(`${LOG_PREFIX} Connection ${connId} error:`, err.message);
      this.removeConnection(connId);
    });

    return connId;
  }

  /**
   * Emit a Symphony event to all authenticated connections with matching namespace.
   * Per-message namespace filtering per review finding (Codex).
   */
  emitEvent(event: SymphonyFeedEvent): number {
    let sent = 0;

    for (const conn of this.connections.values()) {
      // Skip unauthenticated connections
      if (!conn.userEmail) continue;

      // Per-message namespace filter
      if (!conn.allowedNamespaces.has(event.namespace)) continue;

      try {
        if (this.isSocketOpen(conn.socket)) {
          conn.socket.send(JSON.stringify(event));
          sent++;
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        console.error(`${LOG_PREFIX} Failed to send to ${conn.id}:`, e.message);
      }
    }

    if (sent > 0) {
      symphonyFeedEventsEmitted.inc({}, sent);
    }

    return sent;
  }

  /** Get number of active authenticated connections. */
  getAuthenticatedCount(): number {
    let count = 0;
    for (const conn of this.connections.values()) {
      if (conn.userEmail) count++;
    }
    return count;
  }

  /** Get total connection count. */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /** Get connection counts scoped to specific namespaces. */
  getNamespaceScopedCounts(namespaces: string[]): { total: number; authenticated: number } {
    const nsSet = new Set(namespaces);
    let total = 0;
    let authenticated = 0;
    for (const conn of this.connections.values()) {
      if ([...conn.allowedNamespaces].some((ns: string) => nsSet.has(ns))) {
        total++;
        if (conn.userEmail) authenticated++;
      }
    }
    return { total, authenticated };
  }

  /**
   * Refresh namespace permissions for a connection.
   * Called when namespace permissions might have changed.
   */
  async refreshNamespaces(connId: string): Promise<boolean> {
    const conn = this.connections.get(connId);
    if (!conn?.userEmail) return false;

    try {
      const namespaces = await this.resolveNamespaces(conn.userEmail);
      conn.allowedNamespaces = new Set(namespaces);
      return true;
    } catch {
      return false;
    }
  }

  // ── Private ────────────────────────────────────────────────────────

  private async handleClientMessage(conn: FeedConnection, raw: string): Promise<void> {
    let msg: SymphonyFeedClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      // Ignore malformed messages
      return;
    }

    switch (msg.type) {
      case 'auth':
        if (conn.userEmail) {
          // Already authenticated, ignore duplicate auth
          return;
        }
        if (!msg.token) {
          this.sendError(conn, 'auth_error', 'Missing token');
          return;
        }
        await this.authenticateConnection(conn, msg.token);
        break;

      case 'auth_refresh':
        // Re-authenticate with new token (review finding P4-3)
        if (!msg.token) {
          this.sendError(conn, 'auth_error', 'Missing token for refresh');
          return;
        }
        // If not yet authenticated, treat as initial auth (Codex review finding #3)
        if (!conn.userEmail) {
          await this.authenticateConnection(conn, msg.token);
          return;
        }
        // Serialize concurrent refreshes to prevent race conditions (Codex review finding #1)
        if (conn.refreshing) {
          this.sendError(conn, 'auth_error', 'Refresh already in progress');
          return;
        }
        conn.refreshing = true;
        try {
          await this.handleTokenRefresh(conn, msg.token);
        } finally {
          conn.refreshing = false;
        }
        break;

      case 'pong':
        conn.lastPong = new Date();
        break;

      default:
        // Unknown message type — ignore
        break;
    }
  }

  private async authenticateConnection(conn: FeedConnection, token: string): Promise<boolean> {
    try {
      const payload = await this.verifyJwt(token);
      conn.userEmail = payload.sub;
      conn.tokenExp = payload.exp;

      // Clear auth timeout
      if (conn.authTimer) {
        clearTimeout(conn.authTimer);
        conn.authTimer = null;
      }

      // Resolve namespaces
      const namespaces = await this.resolveNamespaces(payload.sub);
      conn.allowedNamespaces = new Set(namespaces);

      // Send auth success
      this.sendMessage(conn, {
        type: 'auth_success',
        data: {
          connection_id: conn.id,
          namespaces: Array.from(conn.allowedNamespaces),
          token_expires_at: new Date(payload.exp * 1000).toISOString(),
        },
      });

      console.log(`${LOG_PREFIX} Authenticated connection ${conn.id}`);
      return true;
    } catch (err) {
      symphonyFeedAuthFailures.inc();
      const e = err instanceof Error ? err : new Error(String(err));
      console.warn(`${LOG_PREFIX} Auth failed for ${conn.id}: ${e.message}`);

      this.sendError(conn, 'auth_failed', 'Invalid or expired token');
      this.cleanupConnection(conn, 4001, 'Authentication failed');
      return false;
    }
  }

  /**
   * Handle token refresh mid-connection (review finding P4-3).
   * Validates the new token and updates the connection's auth state.
   */
  private async handleTokenRefresh(conn: FeedConnection, token: string): Promise<void> {
    try {
      const payload = await this.verifyJwt(token);

      // Verify it's the same user
      if (conn.userEmail && payload.sub !== conn.userEmail) {
        this.sendError(conn, 'auth_error', 'Token subject mismatch');
        return;
      }

      conn.tokenExp = payload.exp;

      // Re-resolve namespaces (permissions may have changed)
      const namespaces = await this.resolveNamespaces(payload.sub);
      conn.allowedNamespaces = new Set(namespaces);

      this.sendMessage(conn, {
        type: 'auth_refreshed',
        data: {
          namespaces: Array.from(conn.allowedNamespaces),
          token_expires_at: new Date(payload.exp * 1000).toISOString(),
        },
      });

      console.log(`${LOG_PREFIX} Token refreshed for connection ${conn.id}`);
    } catch (err) {
      symphonyFeedAuthFailures.inc();
      const e = err instanceof Error ? err : new Error(String(err));
      console.warn(`${LOG_PREFIX} Token refresh failed for ${conn.id}: ${e.message}`);
      this.sendError(conn, 'auth_refresh_failed', 'Token refresh failed');

      // If the original token is also expired, disconnect
      if (conn.tokenExp && Date.now() / 1000 > conn.tokenExp) {
        this.sendMessage(conn, {
          type: 'auth_expired',
          data: { reason: 'Token expired and refresh failed' },
        });
        this.cleanupConnection(conn, 4001, 'Token expired');
      }
    }
  }

  private heartbeat(): void {
    const now = new Date();

    for (const [connId, conn] of this.connections.entries()) {
      // Check for stale connections
      const timeSinceLastPong = now.getTime() - conn.lastPong.getTime();
      if (timeSinceLastPong > STALE_THRESHOLD_MS) {
        console.log(`${LOG_PREFIX} Removing stale connection ${connId}`);
        this.cleanupConnection(conn, 1001, 'Connection timeout');
        continue;
      }

      // Check for expired tokens
      if (conn.tokenExp && now.getTime() / 1000 > conn.tokenExp) {
        // Token expired — send warning, then disconnect after grace period
        this.sendMessage(conn, {
          type: 'auth_expiring',
          data: {
            expires_in_seconds: 0,
            message: 'Token has expired. Send auth_refresh with new token.',
          },
        });

        // Give client 30s to refresh before disconnecting
        // (only if we haven't already warned)
        if (conn.tokenExp > 0) {
          conn.tokenExp = -1; // Mark as warned
          setTimeout(() => {
            const current = this.connections.get(connId);
            if (current && current.tokenExp === -1) {
              // Still not refreshed
              this.cleanupConnection(current, 4001, 'Token expired');
            }
          }, 30000);
        }
        continue;
      }

      // Send heartbeat ping
      if (conn.userEmail && this.isSocketOpen(conn.socket)) {
        this.sendMessage(conn, {
          type: 'symphony:heartbeat' as SymphonyFeedEventType,
          data: { timestamp: now.toISOString() },
        });
      }
    }
  }

  private removeConnection(connId: string): void {
    const conn = this.connections.get(connId);
    if (!conn) return;

    if (conn.authTimer) {
      clearTimeout(conn.authTimer);
      conn.authTimer = null;
    }

    this.connections.delete(connId);
    symphonyFeedConnections.set(this.connections.size);
  }

  private cleanupConnection(conn: FeedConnection, code: number, reason: string): void {
    if (conn.authTimer) {
      clearTimeout(conn.authTimer);
      conn.authTimer = null;
    }

    try {
      if (this.isSocketOpen(conn.socket)) {
        conn.socket.close(code, reason);
      }
    } catch {
      // Ignore close errors
    }

    this.connections.delete(conn.id);
    symphonyFeedConnections.set(this.connections.size);
  }

  private sendMessage(conn: FeedConnection, message: Record<string, unknown>): void {
    try {
      if (this.isSocketOpen(conn.socket)) {
        conn.socket.send(JSON.stringify(message));
      }
    } catch {
      // Ignore send errors — will be cleaned up by heartbeat
    }
  }

  private sendError(conn: FeedConnection, type: string, message: string): void {
    this.sendMessage(conn, { type, error: message });
  }

  private isSocketOpen(socket: WebSocket): boolean {
    // WebSocket.OPEN = 1
    return socket.readyState === 1;
  }
}
