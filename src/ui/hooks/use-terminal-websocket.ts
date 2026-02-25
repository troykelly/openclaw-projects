/**
 * WebSocket hook for terminal I/O (Epic #1667, #1694).
 *
 * Manages the WebSocket lifecycle for attaching to a terminal session:
 * connect, send input, receive output, reconnect with exponential backoff.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/ui/lib/api-config.ts';
import { getAccessToken } from '@/ui/lib/auth-manager.ts';

export type TerminalWsStatus = 'connecting' | 'connected' | 'disconnected' | 'terminated' | 'error';

export interface UseTerminalWebSocketOptions {
  sessionId: string;
  onData: (data: string) => void;
  onStatusChange?: (status: TerminalWsStatus) => void;
  enabled?: boolean;
}

interface UseTerminalWebSocketReturn {
  status: TerminalWsStatus;
  send: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  disconnect: () => void;
  reconnect: () => void;
}

const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;

/**
 * Hook that manages a WebSocket connection to a terminal session.
 * Includes automatic reconnection with exponential backoff.
 */
export function useTerminalWebSocket({
  sessionId,
  onData,
  onStatusChange,
  enabled = true,
}: UseTerminalWebSocketOptions): UseTerminalWebSocketReturn {
  const [status, setStatus] = useState<TerminalWsStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const manualDisconnectRef = useRef(false);
  const onDataRef = useRef(onData);
  const onStatusChangeRef = useRef(onStatusChange);

  // Keep refs up-to-date without re-triggering effects
  onDataRef.current = onData;
  onStatusChangeRef.current = onStatusChange;

  const updateStatus = useCallback((newStatus: TerminalWsStatus) => {
    setStatus(newStatus);
    onStatusChangeRef.current?.(newStatus);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const baseUrl = getApiBaseUrl();
    const wsProtocol = baseUrl.startsWith('https') ? 'wss' : 'ws';
    const wsBase = baseUrl.replace(/^https?/, wsProtocol);
    const token = getAccessToken();
    const url = `${wsBase}/api/terminal/sessions/${sessionId}/attach${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    updateStatus('connecting');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      updateStatus('connected');
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        onDataRef.current(event.data);
      }
    };

    ws.onclose = (event) => {
      wsRef.current = null;

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
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      updateStatus('error');
    };
  }, [sessionId, updateStatus]);

  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
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
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    connect();
  }, [connect]);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    manualDisconnectRef.current = false;
    connect();

    return () => {
      manualDisconnectRef.current = true;
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

  return { status, send, resize, disconnect, reconnect };
}
