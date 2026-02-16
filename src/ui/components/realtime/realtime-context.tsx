/**
 * Realtime context and provider for WebSocket connections
 * Issue #404: Implement real-time updates via WebSocket
 */
import * as React from 'react';
import {
  DEFAULT_RECONNECT_OPTIONS,
  type ConnectionStatus,
  type RealtimeContextValue,
  type RealtimeEvent,
  type RealtimeEventType,
  type ReconnectOptions,
  type Subscription,
  type WebSocketMessage,
} from './types';

/**
 * Callback type for subscribing to token refresh events.
 * The provider calls this with a callback that should be invoked when the
 * access token is refreshed. Returns an unsubscribe function for cleanup.
 */
export type OnTokenRefreshed = (callback: () => void) => () => void;

export interface RealtimeProviderProps {
  url: string;
  children: React.ReactNode;
  reconnectOptions?: Partial<ReconnectOptions>;
  onStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: Event) => void;
  /**
   * Returns the current access token for WebSocket authentication.
   * The token is appended as a `?token=` query parameter to the WebSocket URL.
   * Return null when no token is available (e.g. auth disabled).
   */
  getAccessToken?: () => string | null;
  /**
   * Subscribe to token refresh events. When the access token is refreshed,
   * the provider closes the current WebSocket and reconnects with the new token.
   */
  onTokenRefreshed?: OnTokenRefreshed;
}

const RealtimeContext = React.createContext<RealtimeContextValue | null>(null);

export function useRealtime(): RealtimeContextValue {
  const context = React.useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return context;
}

/**
 * Optional version of useRealtime that returns null when not inside a provider.
 * Use this when realtime functionality is optional and you need a graceful fallback.
 * (#692: Fixes Rules of Hooks violation - hooks must be called unconditionally)
 */
export function useRealtimeOptional(): RealtimeContextValue | null {
  return React.useContext(RealtimeContext);
}

interface EventHandler {
  eventType: RealtimeEventType;
  handler: (event: RealtimeEvent) => void;
  entityId?: string;
}

export function RealtimeProvider({ url, children, reconnectOptions: userReconnectOptions, onStatusChange, onError, getAccessToken, onTokenRefreshed }: RealtimeProviderProps) {
  const [status, setStatus] = React.useState<ConnectionStatus>('connecting');
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectAttemptRef = React.useRef(0);
  const reconnectTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const subscriptionsRef = React.useRef<Set<string>>(new Set());
  const eventHandlersRef = React.useRef<EventHandler[]>([]);

  // Use refs for callback props to keep the connect function stable
  const getAccessTokenRef = React.useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  const onErrorRef = React.useRef(onError);
  onErrorRef.current = onError;

  const onStatusChangeRef = React.useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // Memoize reconnect options to avoid re-creating connect on every render
  const reconnectOptionsRef = React.useRef({
    ...DEFAULT_RECONNECT_OPTIONS,
    ...userReconnectOptions,
  });
  reconnectOptionsRef.current = {
    ...DEFAULT_RECONNECT_OPTIONS,
    ...userReconnectOptions,
  };

  /**
   * Build the WebSocket URL, appending the access token as a query parameter
   * if one is available. Preserves any existing query parameters on the URL.
   */
  const buildWsUrl = React.useCallback((): string => {
    const token = getAccessTokenRef.current?.();
    if (!token) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${token}`;
  }, [url]);

  const updateStatus = React.useCallback(
    (newStatus: ConnectionStatus) => {
      setStatus(newStatus);
      onStatusChangeRef.current?.(newStatus);
    },
    [],
  );

  const connect = React.useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const ws = new WebSocket(buildWsUrl());

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        updateStatus('connected');

        // Resubscribe to all subscriptions
        subscriptionsRef.current.forEach((subKey) => {
          const [type, id] = subKey.split(':');
          const message: WebSocketMessage = {
            action: 'subscribe',
            subscription: { type: type as Subscription['type'], id },
          };
          ws.send(JSON.stringify(message));
        });
      };

      ws.onclose = (event) => {
        // Don't reconnect on normal closure or token-refresh closure
        // (4000 = closed by token refresh handler, which reconnects itself)
        if (event.code === 1000 || event.code === 4000) {
          updateStatus('disconnected');
          return;
        }

        // Attempt reconnect
        const opts = reconnectOptionsRef.current;
        if (reconnectAttemptRef.current < opts.maxAttempts) {
          updateStatus('reconnecting');
          const delay = Math.min(
            opts.initialDelay * Math.pow(opts.backoffMultiplier, reconnectAttemptRef.current),
            opts.maxDelay,
          );
          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else {
          updateStatus('disconnected');
        }
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          if (message.action === 'event' && message.event) {
            // Dispatch to handlers
            eventHandlersRef.current.forEach((handler) => {
              if (handler.eventType === message.event!.type) {
                // If entityId filter specified, check payload
                if (handler.entityId) {
                  const payload = message.event!.payload as { id?: string };
                  if (payload.id !== handler.entityId) {
                    return;
                  }
                }
                handler.handler(message.event!);
              }
            });
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onerror = (event) => {
        onErrorRef.current?.(event);
      };

      wsRef.current = ws;
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      updateStatus('disconnected');
    }
  }, [buildWsUrl, updateStatus]);

  // Connect on mount and clean up on unmount
  React.useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
    };
  }, [connect]);

  // Keep connect ref stable for use in token refresh callback
  const connectRef = React.useRef(connect);
  connectRef.current = connect;

  // Subscribe to token refresh events — reconnect with new token
  React.useEffect(() => {
    if (!onTokenRefreshed) return;

    const unsubscribe = onTokenRefreshed(() => {
      // Close existing connection with a custom code indicating token refresh
      if (wsRef.current) {
        wsRef.current.close(4000, 'Token refreshed');
        wsRef.current = null;
      }
      // Reset reconnect counter and reconnect immediately with new token
      reconnectAttemptRef.current = 0;
      connectRef.current();
    });

    return unsubscribe;
  }, [onTokenRefreshed]);

  const subscribe = React.useCallback((subscription: Subscription) => {
    const key = `${subscription.type}:${subscription.id || ''}`;
    subscriptionsRef.current.add(key);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: WebSocketMessage = {
        action: 'subscribe',
        subscription,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const unsubscribe = React.useCallback((subscription: Subscription) => {
    const key = `${subscription.type}:${subscription.id || ''}`;
    subscriptionsRef.current.delete(key);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: WebSocketMessage = {
        action: 'unsubscribe',
        subscription,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const addEventHandler = React.useCallback((eventType: RealtimeEventType, handler: (event: RealtimeEvent) => void, entityId?: string) => {
    const handlerObj: EventHandler = { eventType, handler, entityId };
    eventHandlersRef.current.push(handlerObj);

    // Return cleanup function
    return () => {
      eventHandlersRef.current = eventHandlersRef.current.filter((h) => h !== handlerObj);
    };
  }, []);

  const sendEvent = React.useCallback((event: RealtimeEvent) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: WebSocketMessage = {
        action: 'event',
        event,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const value: RealtimeContextValue = {
    status,
    subscribe,
    unsubscribe,
    addEventHandler,
    sendEvent,
  };

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
