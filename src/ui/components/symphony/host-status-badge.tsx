/**
 * HostStatusBadge — colored badge showing host health state.
 *
 * Maps health_status to a visual variant:
 *  - online: green/default
 *  - degraded: yellow/secondary
 *  - offline: red/destructive
 *
 * Issue #2207
 */
import React from 'react';
import { Badge } from '@/ui/components/ui/badge';

export interface HostStatusBadgeProps {
  status: string;
}

export function HostStatusBadge({ status }: HostStatusBadgeProps): React.JSX.Element {
  let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'outline';
  if (status === 'online') variant = 'default';
  else if (status === 'degraded') variant = 'secondary';
  else if (status === 'offline') variant = 'destructive';

  return (
    <Badge variant={variant} data-testid="host-status-badge">
      {status}
    </Badge>
  );
}
