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

export function ChatConnectionBanner({ status, onRetry }: ChatConnectionBannerProps): React.JSX.Element | null {
  if (status === 'connected') return null;

  const config = STATUS_CONFIG[status];

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
      {(status === 'connecting' || status === 'reconnecting') && (
        <span
          className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}

      <span>{config.label}</span>

      {/* Retry button for disconnected/degraded */}
      {onRetry && (status === 'disconnected' || status === 'degraded') && (
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
