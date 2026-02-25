/**
 * List of connections using a credential (Epic #1667, #1693).
 */
import * as React from 'react';
import { Link } from 'react-router';
import { Server } from 'lucide-react';
import type { TerminalConnection } from '@/ui/lib/api-types';

interface CredentialUsageListProps {
  connections: TerminalConnection[];
  credentialId: string;
}

export function CredentialUsageList({ connections, credentialId }: CredentialUsageListProps): React.JSX.Element {
  const using = connections.filter((c) => c.credential_id === credentialId);

  if (using.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="no-credential-usage">
        No connections use this credential.
      </p>
    );
  }

  return (
    <div className="space-y-1" data-testid="credential-usage-list">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Used by {using.length} connection{using.length !== 1 ? 's' : ''}
      </p>
      {using.map((conn) => (
        <Link
          key={conn.id}
          to={`/terminal/connections/${conn.id}`}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors"
        >
          <Server className="size-3 text-muted-foreground" />
          <span>{conn.name}</span>
        </Link>
      ))}
    </div>
  );
}
