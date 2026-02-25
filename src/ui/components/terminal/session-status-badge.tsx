/**
 * Session status badge (Epic #1667, #1691).
 *
 * Renders a colored badge for terminal session status values.
 */
import * as React from 'react';
import { Badge } from '@/ui/components/ui/badge';

interface SessionStatusBadgeProps {
  status: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  starting: { label: 'Starting', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  idle: { label: 'Idle', className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' },
  disconnected: { label: 'Disconnected', className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  terminated: { label: 'Terminated', className: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' },
  error: { label: 'Error', className: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  pending_host_verification: { label: 'Pending Verification', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
};

export function SessionStatusBadge({ status }: SessionStatusBadgeProps): React.JSX.Element {
  const config = statusConfig[status] ?? { label: status, className: 'bg-gray-500/10 text-gray-600' };

  return (
    <Badge variant="secondary" className={`text-xs ${config.className}`} data-testid="session-status-badge">
      {config.label}
    </Badge>
  );
}
