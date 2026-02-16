/**
 * PostgreSQL LISTEN/NOTIFY client with auto-reconnect.
 * Part of Issue #1178.
 */

import { Client } from 'pg';
import type { ClientConfig } from 'pg';

interface NotifyListenerOptions {
  connectionConfig: ClientConfig;
  channels: string[];
  onNotification: () => void;
  onReconnect?: () => void;
}

/**
 * Wraps a pg.Client in LISTEN mode with automatic reconnection
 * and debounced notification delivery.
 */
export class NotifyListener {
  private readonly config: ClientConfig;
  private readonly channels: string[];
  private readonly onNotification: () => void;
  private readonly onReconnect?: () => void;

  private client: Client | null = null;
  private connected = false;
  private stopping = false;
  private reconnecting = false;
  private reconnectCount = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: NotifyListenerOptions) {
    this.config = options.connectionConfig;
    this.channels = options.channels;
    this.onNotification = options.onNotification;
    this.onReconnect = options.onReconnect;
  }

  /** Connect and LISTEN on all channels. */
  async start(): Promise<void> {
    this.stopping = false;
    await this.connect();
  }

  /** Disconnect gracefully. */
  async stop(): Promise<void> {
    this.stopping = true;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.client) {
      try {
        await this.client.end();
      } catch {
        // Best-effort close
      }
      this.client = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getReconnectCount(): number {
    return this.reconnectCount;
  }

  // ─── Internal ───

  private async connect(): Promise<void> {
    const client = new Client(this.config);
    this.client = client;

    client.on('error', (err) => {
      console.error('[Listener] Client error:', err.message);
      this.handleDisconnect();
    });

    client.on('end', () => {
      if (!this.stopping) {
        this.handleDisconnect();
      }
    });

    client.on('notification', () => {
      this.debouncedNotify();
    });

    try {
      await client.connect();
      for (const channel of this.channels) {
        // Channel names come from our own code, not user input -- safe to interpolate.
        await client.query(`LISTEN ${channel}`);
      }
      this.connected = true;
      console.log(`[Listener] Connected, listening on: ${this.channels.join(', ')}`);
    } catch (err) {
      console.error('[Listener] Initial connect failed:', (err as Error).message);
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  private handleDisconnect(): void {
    if (this.stopping) return;

    this.connected = false;
    this.client = null;
    console.warn('[Listener] Disconnected, scheduling reconnect');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnecting) return;
    this.reconnecting = true;

    // Jittered delay: 1-5 s
    const delayMs = 1000 + Math.floor(Math.random() * 4000);
    setTimeout(() => {
      if (this.stopping) { this.reconnecting = false; return; }
      this.reconnectCount++;
      console.log(`[Listener] Reconnecting (attempt #${this.reconnectCount})...`);
      this.connect().then(() => {
        this.reconnecting = false;
        if (this.connected && this.onReconnect) {
          this.onReconnect();
        } else if (!this.connected) {
          // connect() caught its own error and called scheduleReconnect(),
          // which no-op'd because reconnecting was still true. Retry now.
          this.scheduleReconnect();
        }
      }).catch((err) => {
        this.reconnecting = false;
        console.error('[Listener] Reconnect failed:', (err as Error).message);
        this.scheduleReconnect();
      });
    }, delayMs);
  }

  /** Debounce notification callbacks (100 ms). */
  private debouncedNotify(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.onNotification();
    }, 100);
  }
}
