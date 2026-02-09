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

export interface RealtimeProviderProps {
  url: string;
  children: React.ReactNode;
  reconnectOptions?: Partial<ReconnectOptions>;
  onStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: Event) => void;
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

export function RealtimeProvider({ url, children, reconnectOptions: userReconnectOptions, onStatusChange, onError }: RealtimeProviderProps) {
  const reconnectOptions = {
    ...DEFAULT_RECONNECT_OPTIONS,
    ...userReconnectOptions,
  };

  const [status, setStatus] = React.useState<ConnectionStatus>('connecting');
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectAttemptRef = React.useRef(0);
  const reconnectTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const subscriptionsRef = React.useRef<Set<string>>(new Set());
  const eventHandlersRef = React.useRef<EventHandler[]>([]);

  const updateStatus = React.useCallback(
    (newStatus: ConnectionStatus) => {
      setStatus(newStatus);
      onStatusChange?.(newStatus);
    },
    [onStatusChange],
  );

  const connect = React.useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const ws = new WebSocket(url);

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
        // Don't reconnect on normal closure
        if (event.code === 1000) {
          updateStatus('disconnected');
          return;
        }

        // Attempt reconnect
        if (reconnectAttemptRef.current < reconnectOptions.maxAttempts) {
          updateStatus('reconnecting');
          const delay = Math.min(
            reconnectOptions.initialDelay * Math.pow(reconnectOptions.backoffMultiplier, reconnectAttemptRef.current),
            reconnectOptions.maxDelay,
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
        onError?.(event);
      };

      wsRef.current = ws;
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      updateStatus('disconnected');
    }
  }, [url, updateStatus, onError, reconnectOptions]);

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
