/**
 * Session status overlay (Epic #1667, #1694).
 *
 * Shows connecting/disconnected/terminated overlays on the terminal.
 */
import * as React from 'react';
import { Button } from '@/ui/components/ui/button';
import { Loader2, WifiOff, XCircle, RefreshCw } from 'lucide-react';
import type { TerminalWsStatus } from '@/ui/hooks/use-terminal-websocket';

interface SessionStatusOverlayProps {
  status: TerminalWsStatus;
  onReconnect?: () => void;
}

export function SessionStatusOverlay({ status, onReconnect }: SessionStatusOverlayProps): React.JSX.Element | null {
  if (status === 'connected') return null;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10"
      data-testid="session-status-overlay"
    >
      <div className="text-center space-y-3">
        {status === 'connecting' && (
          <>
            <Loader2 className="mx-auto size-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Connecting to session...</p>
          </>
        )}
        {status === 'disconnected' && (
          <>
            <WifiOff className="mx-auto size-8 text-orange-500" />
            <p className="text-sm font-medium">Disconnected</p>
            <p className="text-xs text-muted-foreground">The connection was lost. Reconnecting automatically...</p>
            {onReconnect && (
              <Button size="sm" variant="outline" onClick={onReconnect}>
                <RefreshCw className="mr-2 size-3" />
                Reconnect Now
              </Button>
            )}
          </>
        )}
        {status === 'terminated' && (
          <>
            <XCircle className="mx-auto size-8 text-gray-500" />
            <p className="text-sm font-medium">Session Terminated</p>
            <p className="text-xs text-muted-foreground">This terminal session has ended.</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="mx-auto size-8 text-red-500" />
            <p className="text-sm font-medium">Connection Error</p>
            <p className="text-xs text-muted-foreground">Failed to connect to the terminal.</p>
            {onReconnect && (
              <Button size="sm" variant="outline" onClick={onReconnect}>
                <RefreshCw className="mr-2 size-3" />
                Retry
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
