/**
 * Connection status indicator for WebSocket
 * Issue #404: Implement real-time updates via WebSocket
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import type { ConnectionStatus } from './types';

export interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
  showLabel?: boolean;
  compact?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<ConnectionStatus, { color: string; label: string; animate?: boolean }> = {
  connected: { color: 'bg-green-500', label: 'Connected' },
  disconnected: { color: 'bg-red-500', label: 'Disconnected' },
  connecting: { color: 'bg-yellow-500', label: 'Connecting', animate: true },
  reconnecting: { color: 'bg-yellow-500', label: 'Reconnecting', animate: true },
};

export function ConnectionStatusIndicator({ status, showLabel = false, compact = false, className }: ConnectionStatusIndicatorProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div data-testid="connection-status" data-status={status} className={cn('inline-flex items-center gap-2', className)}>
      <span data-testid="connection-indicator" className={cn('h-2 w-2 rounded-full', config.color, config.animate && 'animate-pulse')} />
      {showLabel && !compact && <span className="text-xs text-muted-foreground">{config.label}</span>}
    </div>
  );
}
