/**
 * Agent status badge (Epic #2153, Issue #2160).
 *
 * Renders a colored dot with accessible text label indicating
 * whether an agent is online, busy, or offline. Returns null
 * for unknown status.
 */

import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export type AgentStatus = 'online' | 'busy' | 'offline' | 'unknown';

interface AgentStatusBadgeProps {
  status: AgentStatus;
}

const STATUS_CONFIG: Record<Exclude<AgentStatus, 'unknown'>, { label: string; dotClass: string }> = {
  online: {
    label: 'Online',
    dotClass: 'bg-green-500 dark:bg-green-400',
  },
  busy: {
    label: 'Busy',
    dotClass: 'bg-amber-500 dark:bg-amber-400',
  },
  offline: {
    label: 'Offline',
    dotClass: 'bg-gray-400 dark:bg-gray-500',
  },
};

export function AgentStatusBadge({ status }: AgentStatusBadgeProps): React.JSX.Element | null {
  const config = STATUS_CONFIG[status as Exclude<AgentStatus, 'unknown'>];
  if (!config) return null;

  return (
    <span
      role="status"
      aria-label={`Agent status: ${status}`}
      className="inline-flex items-center"
    >
      <span
        data-testid="agent-status-dot"
        title={config.label}
        className={cn('inline-block size-2 rounded-full', config.dotClass)}
      />
      <span className="sr-only">{config.label}</span>
    </span>
  );
}
