/**
 * WebSocket hook for Symphony real-time feed (Epic #2186, Issue #2207).
 *
 * Connects to /api/symphony/feed for live run state changes, stage updates,
 * queue changes, and provisioning progress. Auto-reconnects with exponential
 * backoff. Authenticates via JWT token message after connection.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getApiBaseUrl } from '@/ui/lib/api-config.ts';
import { getAccessToken } from '@/ui/lib/auth-manager.ts';
import { symphonyKeys } from '@/ui/hooks/queries/use-symphony.ts';
import type { SymphonyFeedEvent } from '@/ui/lib/api-types.ts';

export type SymphonyWsStatus = 'connecting' | 'connected' | 'authenticating' | 'disconnected' | 'error';

export interface UseSymphonyWebSocketOptions {
  /** Whether the WebSocket should be connected. */
  enabled?: boolean;
  /** Called when a feed event is received. */
  onEvent?: (event: SymphonyFeedEvent) => void;
}

interface UseSymphonyWebSocketReturn {
  status: SymphonyWsStatus;
  disconnect: () => void;
  reconnect: () => void;
}

const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;

/**
 * Hook that manages a WebSocket connection to the Symphony feed.
 * Auto-invalidates TanStack Query caches on relevant events.
 */
export function useSymphonyWebSocket({
  enabled = true,
  onEvent,
}: UseSymphonyWebSocketOptions = {}): UseSymphonyWebSocketReturn {
  const [status, setStatus] = useState<SymphonyWsStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const manualDisconnectRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const queryClient = useQueryClient();

  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const baseUrl = getApiBaseUrl();
    const wsProtocol = baseUrl.startsWith('https') ? 'wss' : 'ws';
    const wsBase = baseUrl ? baseUrl.replace(/^https?/, wsProtocol) : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
    const url = `${wsBase}/symphony/feed`;

    setStatus('connecting');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('authenticating');
      // Send auth message with JWT
      const token = getAccessToken();
      if (token) {
        ws.send(JSON.stringify({ type: 'auth', token }));
      }
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;

      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;

        // Handle auth responses
        if (msg.type === 'auth_success') {
          reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
          setStatus('connected');
          return;
        }

        if (msg.type === 'auth_failed' || msg.type === 'auth_error') {
          setStatus('error');
          // Prevent reconnect loop on persistent auth failure
          manualDisconnectRef.current = true;
          if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
          }
          return;
        }

        // Handle heartbeat pong
        if (msg.type === 'symphony:heartbeat') {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'pong' }));
          }
          return;
        }

        // Handle auth expiring — try to refresh token
        if (msg.type === 'auth_expiring') {
          const token = getAccessToken();
          if (token && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'auth_refresh', token }));
          }
          return;
        }

        // Validate as Symphony feed event — must have type, timestamp, namespace
        if (
          typeof msg.type !== 'string' ||
          !msg.type.startsWith('symphony:') ||
          typeof msg.timestamp !== 'string' ||
          typeof msg.namespace !== 'string'
        ) {
          return;
        }

        const feedEvent = msg as unknown as SymphonyFeedEvent;
        onEventRef.current?.(feedEvent);

        // Invalidate relevant queries based on event type
        if (feedEvent.type.startsWith('symphony:run_')) {
          queryClient.invalidateQueries({ queryKey: symphonyKeys.status() });
          queryClient.invalidateQueries({ queryKey: symphonyKeys.queue() });
        } else if (feedEvent.type === 'symphony:queue_changed') {
          queryClient.invalidateQueries({ queryKey: symphonyKeys.queue() });
        } else if (feedEvent.type === 'symphony:stage_updated') {
          queryClient.invalidateQueries({ queryKey: symphonyKeys.status() });
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      wsRef.current = null;

      if (manualDisconnectRef.current) {
        setStatus('disconnected');
        return;
      }

      setStatus('disconnected');

      // Schedule reconnection with exponential backoff
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      setStatus('error');
    };
  }, [queryClient]);

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
    setStatus('disconnected');
  }, []);

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
    if (!enabled) return;

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
  }, [enabled, connect]);

  return { status, disconnect, reconnect };
}
