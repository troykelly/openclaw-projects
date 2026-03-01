/**
 * Chat message delivery status indicator (Epic #1940, Issue #1949).
 *
 * Shows: pending (spinner), delivered (check), failed (red + retry).
 */

import * as React from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import type { ChatMessageStatus as StatusType } from '@/ui/lib/api-types';

interface ChatMessageStatusProps {
  status: StatusType;
  onRetry?: () => void;
}

export function ChatMessageStatus({ status, onRetry }: ChatMessageStatusProps): React.JSX.Element {
  switch (status) {
    case 'pending':
    case 'streaming':
      return (
        <Loader2
          className="size-3 animate-spin text-muted-foreground"
          aria-label="Sending"
        />
      );
    case 'delivered':
      return (
        <Check
          className="size-3 text-muted-foreground"
          aria-label="Delivered"
        />
      );
    case 'failed':
      return (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            'inline-flex items-center gap-0.5 text-destructive',
            'hover:underline focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring rounded-xs',
          )}
          aria-label="Message failed, click to retry"
        >
          <AlertCircle className="size-3" aria-hidden="true" />
          <span className="text-[10px]">Retry</span>
        </button>
      );
    default:
      return <Check className="size-3 text-muted-foreground" aria-label="Sent" />;
  }
}
