/**
 * GatewayConnectionService — persistent WebSocket connection to OpenClaw gateway.
 *
 * Issue #2154: Implements the foundational connection service with:
 * - connect.challenge → connect handshake
 * - Exponential backoff with jitter on reconnect
 * - Tick heartbeat monitoring
 * - Request/response multiplexing
 * - Event handler dispatch
 *
 * Token is sent in the `connect` request body ONLY — never in the URL.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { validateSsrf } from '../webhooks/ssrf.ts';
import { gwConnectAttempts, gwReconnects, gwAuthFailures, gwEventsReceived, gwUnknownFrames } from './metrics.ts';

// ── Protocol constants ───────────────────────────────────────────────────

/** Current OpenClaw gateway protocol version. */
const GATEWAY_PROTOCOL_VERSION = 3;

/** Package version for the connect handshake client metadata. */
const PKG_VERSION: string = (() => {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

// ── Types ────────────────────────────────────────────────────────────────

export interface GatewayReqFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

export interface GatewayResFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message: string };
}

export interface GatewayEventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
}

export type GatewayFrame = GatewayReqFrame | GatewayResFrame | GatewayEventFrame;

export type GatewayEventHandler = (frame: GatewayEventFrame) => void;

export interface GatewayStatus {
  connected: boolean;
  configured: boolean;
  gateway_url: string | null;
  connected_at: string | null;
  last_tick_at: string | null;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  /** Timeout timer for per-request timeouts (#2188). */
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

/** Options for individual gateway requests. */
export interface GatewayRequestOptions {
  /** Per-request timeout in milliseconds (default: 30000). */
  timeoutMs?: number;
}

// ── Constants ────────────────────────────────────────────────────────────

const LOG_PREFIX = '[GatewayWS]';
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const INITIAL_JITTER_MS = 500;
const MAX_JITTER_MS = 5000;
const DEFAULT_CHALLENGE_TIMEOUT_MS = 5000;
const CONNECT_RESPONSE_TIMEOUT_MS = 10000;
const DEFAULT_TICK_INTERVAL_MS = 30000;
/** Default per-request timeout in milliseconds (#2188). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

// ── Service ──────────────────────────────────────────────────────────────

export class GatewayConnectionService {
  private ws: WebSocket | null = null;
  private env: Record<string, string | undefined>;
  private wsUrl: string | null = null;
  private gatewayHost: string | null = null;
  private token: string | null = null;
  private connected = false;
  private configured = false;
  private shutdownRequested = false;
  private initializing = false;
  private initializePromise: Promise<void> | null = null;

  // Backoff state
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Tick monitoring
  private tickIntervalMs = DEFAULT_TICK_INTERVAL_MS;
  private tickTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // Challenge timeout
  private challengeTimer: ReturnType<typeof setTimeout> | null = null;
  private connectResponseTimer: ReturnType<typeof setTimeout> | null = null;
  private challengeReceived = false;
  /** Configurable challenge timeout via OPENCLAW_GATEWAY_WS_HANDSHAKE_TIMEOUT_MS (#2188). */
  private challengeTimeoutMs = DEFAULT_CHALLENGE_TIMEOUT_MS;

  // Init promise resolution — called when connect handshake completes
  private resolveInit: (() => void) | null = null;

  // Status tracking
  private connectedAt: Date | null = null;
  private lastTickAt: Date | null = null;

  // Event handlers
  private eventHandlers: GatewayEventHandler[] = [];

  // Lifecycle callbacks (#2157, #2158)
  private disconnectCallbacks: Array<() => void> = [];
  private connectedCallbacks: Array<() => void> = [];

  // Pending requests
  private pendingRequests = new Map<string, PendingRequest>();

  constructor(env?: Record<string, string | undefined>) {
    this.env = env ?? process.env;
  }

  // ── Public API ─────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Idempotent: if already initializing or connected, return existing promise
    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this._doInitialize().catch((err) => {
      // Clear so retry is possible on next initialize() call
      this.initializePromise = null;
      throw err;
    });
    return this.initializePromise;
  }

  async shutdown(): Promise<void> {
    this.shutdownRequested = true;

    // Cancel pending timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.tickTimeoutTimer) {
      clearTimeout(this.tickTimeoutTimer);
      this.tickTimeoutTimer = null;
    }
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }
    if (this.connectResponseTimer) {
      clearTimeout(this.connectResponseTimer);
      this.connectResponseTimer = null;
    }

    // Reject all pending requests
    this._rejectPendingRequests(new Error('Gateway connection shutdown'));

    // Close WS regardless of readyState (handles CONNECTING state too)
    if (this.ws) {
      try { this.ws.close(1000); } catch { /* ignore close errors during shutdown */ }
    }

    this.connected = false;
    this.ws = null;
    this.initializePromise = null;
  }

  async request<T = unknown>(method: string, params: unknown, opts?: GatewayRequestOptions): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.connected) {
      throw new Error('Gateway WebSocket is not connected');
    }

    const id = randomUUID();
    const frame: GatewayReqFrame = { type: 'req', id, method, params };
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return new Promise<T>((resolve, reject) => {
      // Per-request timeout (#2188): reject and clean up if no response within timeoutMs
      const timeoutTimer = setTimeout(() => {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          pending.reject(new Error(
            `Gateway request timeout after ${timeoutMs}ms for method '${method}'`,
          ));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutTimer,
      });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  onEvent(handler: GatewayEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /** Register a callback invoked when the connection drops. (#2157, #2158) */
  onDisconnect(callback: () => void): void {
    this.disconnectCallbacks.push(callback);
  }

  /** Register a callback invoked when the connection is (re)established. (#2157) */
  onConnected(callback: () => void): void {
    this.connectedCallbacks.push(callback);
  }

  getStatus(): GatewayStatus {
    return {
      connected: this.connected,
      configured: this.configured,
      gateway_url: this.gatewayHost,
      connected_at: this.connectedAt?.toISOString() ?? null,
      last_tick_at: this.lastTickAt?.toISOString() ?? null,
    };
  }

  // ── Private ────────────────────────────────────────────────────────

  private async _doInitialize(): Promise<void> {
    const gatewayUrl = this.env.OPENCLAW_GATEWAY_URL;

    // If no gateway URL, just skip (not an error)
    if (!gatewayUrl) {
      return;
    }

    // Check if explicitly disabled
    const wsEnabled = this.env.OPENCLAW_GATEWAY_WS_ENABLED;
    if (wsEnabled === 'false') {
      return;
    }

    // Mark as configured — the URL is set and we intend to connect.
    // Even if validation fails below, the gateway IS configured (just blocked).
    this.configured = true;
    this.gatewayHost = this._extractHost(gatewayUrl);

    // Validate URL scheme — permanent error, cannot be fixed by env var
    const wsUrl = this._deriveWsUrl(gatewayUrl);

    // Validate SSRF — recoverable: operator can set OPENCLAW_GATEWAY_ALLOW_PRIVATE=true
    const allowPrivate = this.env.OPENCLAW_GATEWAY_ALLOW_PRIVATE === 'true';
    const ssrfResult = validateSsrf(gatewayUrl);
    if (ssrfResult) {
      if (!allowPrivate) {
        console.error(
          `${LOG_PREFIX} SSRF validation failed for gateway URL: ${ssrfResult}` +
          ` — set OPENCLAW_GATEWAY_ALLOW_PRIVATE=true to allow private/internal hosts. Retrying...`,
        );
        this._scheduleReconnect();
        return;
      }
      console.warn(`${LOG_PREFIX} SSRF validation bypassed (OPENCLAW_GATEWAY_ALLOW_PRIVATE=true): ${ssrfResult}`);
    }

    // Resolve token — recoverable: operator can set the env var
    const token = this.env.OPENCLAW_GATEWAY_TOKEN || this.env.OPENCLAW_HOOK_TOKEN;
    if (!token) {
      console.error(
        `${LOG_PREFIX} Gateway WS enabled but no authentication token configured.` +
        ` Set OPENCLAW_GATEWAY_TOKEN or OPENCLAW_HOOK_TOKEN. Retrying...`,
      );
      this._scheduleReconnect();
      return;
    }

    this.wsUrl = wsUrl;
    this.token = token;

    // Read configurable handshake timeout (#2188)
    const handshakeTimeoutEnv = this.env.OPENCLAW_GATEWAY_WS_HANDSHAKE_TIMEOUT_MS;
    if (handshakeTimeoutEnv) {
      const parsed = parseInt(handshakeTimeoutEnv, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        this.challengeTimeoutMs = parsed;
      }
    }

    // Connect
    return this._connect();
  }

  private _deriveWsUrl(httpUrl: string): string {
    let parsed: URL;
    try {
      parsed = new URL(httpUrl);
    } catch {
      throw new Error(`Invalid gateway URL scheme: ${httpUrl}`);
    }

    const protocol = parsed.protocol;
    if (protocol === 'https:' || protocol === 'wss:') {
      parsed.protocol = 'wss:';
    } else if (protocol === 'http:' || protocol === 'ws:') {
      parsed.protocol = 'ws:';
    } else {
      throw new Error(`Invalid gateway URL scheme: ${protocol}. Only http(s) and ws(s) are supported.`);
    }

    return parsed.toString();
  }

  private _extractHost(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.host; // host includes port if non-default
    } catch {
      return url;
    }
  }

  private _connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.shutdownRequested) {
        resolve();
        return;
      }

      const url = this.wsUrl!;
      gwConnectAttempts.inc();
      console.log(`${LOG_PREFIX} connecting to ${this.gatewayHost}`);

      // Token MUST NOT be in the URL
      const ws = new WebSocket(url);
      this.ws = ws;
      this.challengeReceived = false;

      let resolved = false;

      const resolveOnce = () => {
        if (!resolved) {
          resolved = true;
          this.resolveInit = null;
          resolve();
        }
      };

      this.resolveInit = resolveOnce;

      const rejectOnce = (err: Error) => {
        if (!resolved) {
          resolved = true;
          this.resolveInit = null;
          reject(err);
        }
      };

      ws.on('open', () => {
        // Start challenge timeout: configurable via OPENCLAW_GATEWAY_WS_HANDSHAKE_TIMEOUT_MS (#2188)
        this.challengeTimer = setTimeout(() => {
          if (!this.challengeReceived && ws.readyState === WebSocket.OPEN) {
            console.warn(`${LOG_PREFIX} no challenge received within ${this.challengeTimeoutMs}ms, closing`);
            ws.close(4001);
          }
        }, this.challengeTimeoutMs);
      });

      ws.on('message', (data) => {
        this._handleMessage(data.toString());
      });

      ws.on('close', (code) => {
        console.log(`${LOG_PREFIX} disconnected (code ${code})`);
        this._onDisconnect();
        // Init resolves only after validated connect response (#2188).
        // If WS closes before handshake, resolve the promise (to avoid hanging)
        // but the connected flag remains false, correctly reflecting the state.
        resolveOnce();
      });

      ws.on('error', (err) => {
        console.error(`${LOG_PREFIX} WebSocket error:`, err.message);
        // Errors are followed by close events, so no need to handle reconnect here
      });
    });
  }

  private _handleMessage(raw: string): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw);
    } catch {
      console.warn(`${LOG_PREFIX} received non-JSON message, ignoring`);
      return;
    }

    const type = frame.type as string;

    if (type === 'event') {
      this._handleEvent(frame as unknown as GatewayEventFrame);
    } else if (type === 'res') {
      this._handleResponse(frame as unknown as GatewayResFrame);
    } else {
      // Unknown frame types: log warning and increment counter (#2188)
      gwUnknownFrames.inc();
      console.warn(`${LOG_PREFIX} unknown frame type '${type}', ignoring`);
    }
  }

  private _handleEvent(frame: GatewayEventFrame): void {
    gwEventsReceived.inc();
    const eventName = frame.event;

    if (eventName === 'connect.challenge') {
      this.challengeReceived = true;
      if (this.challengeTimer) {
        clearTimeout(this.challengeTimer);
        this.challengeTimer = null;
      }
      this._sendConnectRequest(frame.payload);
      return;
    }

    if (eventName === 'tick') {
      this.lastTickAt = new Date();
      this._resetTickTimeout();
      return;
    }

    // Dispatch to registered handlers
    for (const handler of this.eventHandlers) {
      try {
        handler(frame);
      } catch (err) {
        console.error(`${LOG_PREFIX} event handler error:`, err);
      }
    }
  }

  private _handleResponse(frame: GatewayResFrame): void {
    const pending = this.pendingRequests.get(frame.id);
    if (!pending) return;

    this.pendingRequests.delete(frame.id);
    // Clear per-request timeout timer (#2188)
    if (pending.timeoutTimer) {
      clearTimeout(pending.timeoutTimer);
    }

    if (frame.ok) {
      pending.resolve(frame.payload);
    } else {
      pending.reject(new Error(frame.error?.message ?? 'Unknown gateway error'));
    }
  }

  private _sendConnectRequest(challengePayload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const id = randomUUID();
    const frame: GatewayReqFrame = {
      type: 'req',
      id,
      method: 'connect',
      params: {
        minProtocol: GATEWAY_PROTOCOL_VERSION,
        maxProtocol: GATEWAY_PROTOCOL_VERSION,
        client: {
          id: 'node-host',
          version: PKG_VERSION,
          platform: 'node',
          mode: 'backend',
        },
        auth: { token: this.token },
      },
    };

    // Register pending request for the connect response
    this.pendingRequests.set(id, {
      resolve: (payload: unknown) => {
        if (this.connectResponseTimer) {
          clearTimeout(this.connectResponseTimer);
          this.connectResponseTimer = null;
        }
        this._onConnected(payload);
      },
      reject: (err) => {
        if (this.connectResponseTimer) {
          clearTimeout(this.connectResponseTimer);
          this.connectResponseTimer = null;
        }
        gwAuthFailures.inc();
        console.error(`${LOG_PREFIX} connect rejected:`, err.message);
        this.ws?.close(4002);
      },
    });

    // Timeout if connect response never arrives
    this.connectResponseTimer = setTimeout(() => {
      if (this.pendingRequests.has(id)) {
        this.pendingRequests.delete(id);
        console.warn(`${LOG_PREFIX} connect response timeout (${CONNECT_RESPONSE_TIMEOUT_MS}ms), closing`);
        this.ws?.close(4004);
      }
    }, CONNECT_RESPONSE_TIMEOUT_MS);

    this.ws.send(JSON.stringify(frame));
  }

  private _onConnected(payload: unknown): void {
    this.connected = true;
    this.connectedAt = new Date();
    this.reconnectAttempt = 0;
    console.log(`${LOG_PREFIX} connected`);

    // Extract tick interval from payload if available
    if (payload && typeof payload === 'object' && 'tick_interval_ms' in payload) {
      this.tickIntervalMs = (payload as { tick_interval_ms: number }).tick_interval_ms;
    }

    // Start tick monitoring
    this._resetTickTimeout();

    // Resolve the init/reconnect promise
    if (this.resolveInit) {
      this.resolveInit();
    }

    // Notify connected callbacks (#2157)
    for (const cb of this.connectedCallbacks) {
      try { cb(); } catch (err) { console.error(`${LOG_PREFIX} onConnected callback error:`, err); }
    }
  }

  private _onDisconnect(): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.connectedAt = wasConnected ? this.connectedAt : null;

    // Clear tick timeout
    if (this.tickTimeoutTimer) {
      clearTimeout(this.tickTimeoutTimer);
      this.tickTimeoutTimer = null;
    }
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }

    // Reject pending requests
    this._rejectPendingRequests(new Error('Gateway WebSocket disconnected'));

    // Notify disconnect callbacks (#2157, #2158)
    if (wasConnected) {
      for (const cb of this.disconnectCallbacks) {
        try { cb(); } catch (err) { console.error(`${LOG_PREFIX} onDisconnect callback error:`, err); }
      }
    }

    // Schedule reconnect (unless shutdown was requested)
    if (!this.shutdownRequested) {
      this._scheduleReconnect();
    }
  }

  private _scheduleReconnect(): void {
    const backoff = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, this.reconnectAttempt),
      MAX_BACKOFF_MS,
    );
    const jitter = this.reconnectAttempt === 0
      ? (Math.random() * 2 - 1) * INITIAL_JITTER_MS
      : (Math.random() * 2 - 1) * MAX_JITTER_MS;
    const delay = Math.max(100, Math.round(backoff + jitter));

    this.reconnectAttempt++;
    gwReconnects.inc();
    console.log(`${LOG_PREFIX} reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shutdownRequested) return;
      // Re-run full init to re-check env vars (SSRF bypass, token) on each retry
      this.initializePromise = null;
      this._doInitialize().catch((err) => {
        console.error(`${LOG_PREFIX} reconnect failed:`, err.message);
      });
    }, delay);
  }

  private _resetTickTimeout(): void {
    if (this.tickTimeoutTimer) {
      clearTimeout(this.tickTimeoutTimer);
    }

    // If no tick received in 2x the tick interval, close WS to trigger reconnect
    this.tickTimeoutTimer = setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.warn(`${LOG_PREFIX} tick timeout (${this.tickIntervalMs * 2}ms), closing connection`);
        this.ws.close(4003);
      }
    }, this.tickIntervalMs * 2);
  }

  private _rejectPendingRequests(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      // Clean up per-request timeout timers (#2188)
      if (pending.timeoutTimer) {
        clearTimeout(pending.timeoutTimer);
      }
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
