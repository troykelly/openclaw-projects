/**
 * Component for handling specific realtime events
 * Issue #404: Implement real-time updates via WebSocket
 */
import * as React from 'react';
import { useRealtime } from './realtime-context';
import type { RealtimeEvent, RealtimeEventType } from './types';

export interface RealtimeEventHandlerProps {
  eventType: RealtimeEventType;
  onEvent: (event: RealtimeEvent) => void;
  entityId?: string;
  children?: React.ReactNode;
}

export function RealtimeEventHandler({ eventType, onEvent, entityId, children }: RealtimeEventHandlerProps) {
  const realtime = React.useContext(
    React.createContext<{ addEventHandler?: typeof useRealtime extends () => infer R ? R['addEventHandler'] : never } | null>(null),
  );

  React.useEffect(() => {
    // If context is available, register handler
    if (realtime?.addEventHandler) {
      return realtime.addEventHandler(eventType, onEvent, entityId);
    }
    // Return no-op cleanup if not in provider
    return () => {};
  }, [realtime, eventType, onEvent, entityId]);

  return <>{children}</>;
}

/**
 * Hook to subscribe to specific events
 */
export function useRealtimeEvent(eventType: RealtimeEventType, handler: (event: RealtimeEvent) => void, entityId?: string) {
  // Try to get context, but don't throw if not available
  const context = React.useContext(
    React.createContext<{ addEventHandler?: typeof useRealtime extends () => infer R ? R['addEventHandler'] : never } | null>(null),
  );

  const handlerRef = React.useRef(handler);
  handlerRef.current = handler;

  React.useEffect(() => {
    if (context?.addEventHandler) {
      return context.addEventHandler(eventType, (event) => handlerRef.current(event), entityId);
    }
    return () => {};
  }, [context, eventType, entityId]);
}
