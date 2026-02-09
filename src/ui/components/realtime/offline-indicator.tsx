/**
 * Offline indicator with pending changes
 * Issue #404: Implement real-time updates via WebSocket
 */
import * as React from 'react';
import { WifiOff, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';

export interface OfflineIndicatorProps {
  isOnline: boolean;
  pendingChanges: number;
  syncing?: boolean;
  onSync?: () => void;
  className?: string;
}

export function OfflineIndicator({ isOnline, pendingChanges, syncing = false, onSync, className }: OfflineIndicatorProps) {
  // Don't show if online and no pending changes
  if (isOnline && pendingChanges === 0) {
    return null;
  }

  return (
    <div
      data-testid="offline-indicator"
      className={cn(
        'fixed bottom-4 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-3 px-4 py-2 rounded-lg shadow-lg',
        !isOnline ? 'bg-red-500 text-white' : 'bg-yellow-500 text-yellow-900',
        className,
      )}
    >
      {!isOnline && (
        <>
          <WifiOff className="h-4 w-4" />
          <span className="text-sm font-medium">
            You are offline
            {pendingChanges > 0 && ` • ${pendingChanges} pending changes`}
          </span>
        </>
      )}

      {isOnline && pendingChanges > 0 && (
        <>
          {syncing ? <Loader2 data-testid="syncing-indicator" className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="text-sm font-medium">{syncing ? 'Syncing...' : `${pendingChanges} pending changes`}</span>
          {onSync && !syncing && (
            <Button variant="secondary" size="sm" onClick={onSync} className="h-7 ml-2">
              Sync now
            </Button>
          )}
        </>
      )}
    </div>
  );
}
