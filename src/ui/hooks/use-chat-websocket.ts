/**
 * WebSocket hook for chat streaming (Epic #1940, Issue #1951).
 *
 * Manages the dedicated chat WebSocket lifecycle:
 * 1. Obtain a one-time ticket via POST /api/chat/ws/ticket
 * 2. Connect to /api/chat/ws with ticket + session_id
 * 3. Receive stream events (chunk, completed, failed, started)
 * 4. Reconnect with exponential backoff on abnormal close
 * 5. Send typing indicators and read cursors
 *
 * Follows the same ref-based pattern as useTerminalWebSocket.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/ui/lib/api-client.ts';
import { getWsBaseUrl } from '@/ui/lib/api-config.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatWsStatus = 'connecting' | 'connected' | 'disconnected' | 'terminated' | 'error';

/** Events received from the chat WebSocket. */
export interface ChatWsEvent {
  type: string;
  session_id?: string;
  message_id?: string;
  connection_id?: string;
  chunk?: string;
  seq?: number;
  full_content?: string;
  error?: string;
  [key: string]: unknown;
}

export interface UseChatWebSocketOptions {
  sessionId: string;
  onEvent: (event: ChatWsEvent) => void;
  onStatusChange?: (status: ChatWsStatus) => void;
  enabled?: boolean;
}

interface UseChatWebSocketReturn {
  status: ChatWsStatus;
  sendTyping: (isTyping: boolean) => void;
  sendReadCursor: (lastReadMessageId: string) => void;
  disconnect: () => void;
  reconnect: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_RECONNECT_DELAY = 1_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that manages a dedicated WebSocket connection for chat streaming.
 * Uses one-time ticket authentication and exponential backoff reconnection.
 */
export function useChatWebSocket({
  sessionId,
  onEvent,
  onStatusChange,
  enabled = true,
}: UseChatWebSocketOptions): UseChatWebSocketReturn {
  const [status, setStatus] = useState<ChatWsStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const manualDisconnectRef = useRef(false);
  const connectingRef = useRef(false);

  // Keep callback refs up-to-date without re-triggering effects
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const updateStatus = useCallback((newStatus: ChatWsStatus) => {
    setStatus(newStatus);
    onStatusChangeRef.current?.(newStatus);
  }, []);

  const connect = useCallback(async () => {
    // Guard against concurrent connect attempts
    if (connectingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    connectingRef.current = true;
    updateStatus('connecting');

    try {
      // Step 1: Obtain a one-time ticket
      const ticketResponse = await apiClient.post<{ ticket: string; expires_in: number }>(
        '/api/chat/ws/ticket',
        { session_id: sessionId },
      );

      // Check if we were disconnected while waiting for ticket
      if (manualDisconnectRef.current) {
        connectingRef.current = false;
        return;
      }

      // Step 2: Build WebSocket URL
      const wsBase = getWsBaseUrl();
      const wsUrl = `${wsBase}/api/chat/ws?ticket=${encodeURIComponent(ticketResponse.ticket)}&session_id=${encodeURIComponent(sessionId)}`;

      // Step 3: Connect
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;

        try {
          const parsed = JSON.parse(event.data) as ChatWsEvent;

          // Handle internal protocol messages
          if (parsed.type === 'connection:established') {
            updateStatus('connected');
            connectingRef.current = false;
            return;
          }

          if (parsed.type === 'ping') {
            // Respond to server heartbeat
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'pong' }));
            }
            return;
          }

          // Dispatch all other events to the consumer
          onEventRef.current(parsed);
        } catch {
          // Malformed JSON — ignore
        }
      };

      ws.onclose = (event) => {
        wsRef.current = null;
        connectingRef.current = false;

        if (manualDisconnectRef.current) {
          updateStatus('disconnected');
          return;
        }

        // Code 1000 = normal close (session terminated)
        if (event.code === 1000) {
          updateStatus('terminated');
          return;
        }

        updateStatus('disconnected');

        // Schedule reconnection with exponential backoff
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
        reconnectTimeoutRef.current = setTimeout(() => {
          void connect();
        }, delay);
      };

      ws.onerror = () => {
        // onerror is always followed by onclose, so don't update status here
        // to avoid a double-update
      };
    } catch {
      // Ticket acquisition failed
      connectingRef.current = false;
      updateStatus('error');

      // Schedule reconnection
      if (!manualDisconnectRef.current) {
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
        reconnectTimeoutRef.current = setTimeout(() => {
          void connect();
        }, delay);
      }
    }
  }, [sessionId, updateStatus]);

  const sendTyping = useCallback((isTyping: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'typing', is_typing: isTyping }));
    }
  }, []);

  const sendReadCursor = useCallback((lastReadMessageId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'read_cursor', last_read_message_id: lastReadMessageId }));
    }
  }, []);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    connectingRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    updateStatus('disconnected');
  }, [updateStatus]);

  const reconnect = useCallback(() => {
    manualDisconnectRef.current = false;
    connectingRef.current = false;
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    void connect();
  }, [connect]);

  // Connect on mount (when enabled), clean up on unmount
  useEffect(() => {
    if (!enabled || !sessionId) return;

    manualDisconnectRef.current = false;
    void connect();

    return () => {
      manualDisconnectRef.current = true;
      connectingRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [sessionId, enabled, connect]);

  return { status, sendTyping, sendReadCursor, disconnect, reconnect };
}
