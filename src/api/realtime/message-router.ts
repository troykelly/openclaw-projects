/**
 * Typed WebSocket message dispatch.
 * Routes binary frames (Yjs protocol) and JSON text frames (control messages) to handlers.
 * Part of Issue #2256
 */

import type { WebSocketClient } from './types.ts';

type TextHandler = (client: WebSocketClient, parsed: { type: string; [key: string]: unknown }) => void;
type BinaryHandler = (client: WebSocketClient, data: Buffer) => void;

export class MessageRouter {
  private textHandlers: Array<{ prefix: string; handler: TextHandler }> = [];
  private binaryHandler: BinaryHandler | null = null;

  /** Register a handler for JSON text frames whose `type` field starts with `prefix` */
  onText(prefix: string, handler: TextHandler): void {
    this.textHandlers.push({ prefix, handler });
  }

  /** Register a handler for binary WebSocket frames */
  onBinary(handler: BinaryHandler): void {
    this.binaryHandler = handler;
  }

  /** Dispatch a WebSocket message to the appropriate handler */
  dispatch(client: WebSocketClient, data: Buffer | string, isBinary: boolean): void {
    if (isBinary) {
      if (this.binaryHandler) {
        this.binaryHandler(client, Buffer.isBuffer(data) ? data : Buffer.from(data));
      }
      return;
    }

    // Text frame — parse as JSON
    let parsed: { type: string; [key: string]: unknown };
    try {
      parsed = JSON.parse(typeof data === 'string' ? data : data.toString());
    } catch (err) {
      console.debug(`[MessageRouter] Malformed JSON from client ${client.client_id}:`, err instanceof Error ? err.message : err);
      return;
    }

    // Support both `type` and legacy `event` field for backward compatibility.
    // The frontend realtime-context sends { event: 'connection:pong' } while
    // newer handlers use { type: 'yjs:join' }.
    const eventField = (parsed as Record<string, unknown>).event;
    const msgType = typeof parsed.type === 'string'
      ? parsed.type
      : typeof eventField === 'string'
        ? eventField
        : null;

    if (msgType === null) return;

    // Normalize to `type` field for handlers
    parsed.type = msgType;

    for (const { prefix, handler } of this.textHandlers) {
      if (msgType.startsWith(prefix)) {
        handler(client, parsed);
        return;
      }
    }
  }
}
