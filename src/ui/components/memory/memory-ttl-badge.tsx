import * as React from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Badge } from '@/ui/components/ui/badge';

export interface MemoryTtlBadgeProps {
  expiresAt: string;
  className?: string;
}

/**
 * Compute human-readable time remaining and urgency level for a TTL.
 */
function getTimeRemaining(expiresAt: string): {
  label: string;
  urgency: 'expired' | 'critical' | 'warning' | 'safe';
} {
  const now = Date.now();
  const expiry = new Date(expiresAt).getTime();

  if (Number.isNaN(expiry)) {
    return { label: 'Invalid date', urgency: 'expired' };
  }

  const diffMs = expiry - now;

  if (diffMs <= 0) {
    const agoMs = Math.abs(diffMs);
    const agoHours = Math.floor(agoMs / (1000 * 60 * 60));
    const agoMins = Math.floor(agoMs / (1000 * 60));
    if (agoHours > 0) {
      return { label: `Expired ${agoHours}h ago`, urgency: 'expired' };
    }
    return { label: `Expired ${agoMins}m ago`, urgency: 'expired' };
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const days = Math.floor(hours / 24);

  if (hours < 1) {
    return { label: `Expires in ${minutes}m`, urgency: 'critical' };
  }
  if (hours < 24) {
    return { label: `Expires in ${hours}h`, urgency: 'warning' };
  }
  if (days < 7) {
    return { label: `Expires in ${days}d`, urgency: 'safe' };
  }
  return { label: `Expires in ${days}d`, urgency: 'safe' };
}

const urgencyStyles: Record<string, string> = {
  expired: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
  safe: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800',
};

export function MemoryTtlBadge({ expiresAt, className }: MemoryTtlBadgeProps) {
  const { label, urgency } = getTimeRemaining(expiresAt);
  const isExpired = urgency === 'expired';

  return (
    <Badge
      variant="outline"
      className={cn('gap-1 text-xs', urgencyStyles[urgency], className)}
      aria-label={isExpired ? `Memory expired: ${label}` : `Memory ${label}`}
    >
      <Clock className="size-3" />
      {label}
    </Badge>
  );
}
