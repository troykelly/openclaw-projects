/**
 * Chat connection status banner (Epic #1940, Issue #1953).
 *
 * Shows a banner at the top of the chat panel when the WebSocket
 * connection is not fully connected. Auto-hides when connected.
 */

import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export type ChatConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'degraded';

interface ChatConnectionBannerProps {
  status: ChatConnectionStatus;
  onRetry?: () => void;
  /** When false, shows degraded banner even if browser WS is connected (Issue #2159). */
  gatewayConnected?: boolean;
}

const STATUS_CONFIG: Record<
  Exclude<ChatConnectionStatus, 'connected'>,
  { label: string; className: string }
> = {
  connecting: {
    label: 'Connecting...',
    className: 'bg-muted text-muted-foreground',
  },
  reconnecting: {
    label: 'Reconnecting...',
    className: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200',
  },
  disconnected: {
    label: 'Disconnected',
    className: 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200',
  },
  degraded: {
    label: 'Connection issues',
    className: 'bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-200',
  },
};

export function ChatConnectionBanner({ status, onRetry, gatewayConnected }: ChatConnectionBannerProps): React.JSX.Element | null {
  // When browser WS is connected but gateway WS is down, show degraded state
  const isGatewayDegraded = status === 'connected' && gatewayConnected === false;
  const effectiveStatus: ChatConnectionStatus = isGatewayDegraded ? 'degraded' : status;

  if (effectiveStatus === 'connected') return null;

  const config = STATUS_CONFIG[effectiveStatus];
  const label = isGatewayDegraded
    ? 'Agent connection degraded \u2014 using fallback mode'
    : config.label;

  return (
    <div
      data-testid="connection-banner"
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium',
        config.className,
      )}
    >
      {/* Spinner for connecting/reconnecting */}
      {(effectiveStatus === 'connecting' || effectiveStatus === 'reconnecting') && (
        <span
          className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}

      <span>{label}</span>

      {/* Retry button for disconnected/degraded */}
      {onRetry && (effectiveStatus === 'disconnected' || effectiveStatus === 'degraded') && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 underline underline-offset-2 hover:no-underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}
