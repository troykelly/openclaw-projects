/**
 * Connection status indicator badge (Epic #1667, #1692).
 */
import * as React from 'react';
import { Badge } from '@/ui/components/ui/badge';
import type { TerminalConnection } from '@/ui/lib/api-types';

interface ConnectionStatusIndicatorProps {
  connection: TerminalConnection;
}

export function ConnectionStatusIndicator({ connection }: ConnectionStatusIndicatorProps): React.JSX.Element {
  if (connection.last_error) {
    return (
      <Badge variant="secondary" className="text-xs bg-red-500/10 text-red-600 dark:text-red-400" data-testid="connection-status-error">
        Error
      </Badge>
    );
  }

  if (connection.last_connected_at) {
    return (
      <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600 dark:text-green-400" data-testid="connection-status-ok">
        Connected
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="text-xs bg-gray-500/10 text-gray-600 dark:text-gray-400" data-testid="connection-status-unknown">
      Unknown
    </Badge>
  );
}
