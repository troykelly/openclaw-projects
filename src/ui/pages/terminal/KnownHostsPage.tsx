/**
 * Known Hosts Page (Epic #1667, #1696).
 */
import * as React from 'react';
import { Shield } from 'lucide-react';
import { KnownHostCard } from '@/ui/components/terminal/known-host-card';
import { useTerminalKnownHosts, useDeleteTerminalKnownHost } from '@/ui/hooks/queries/use-terminal-known-hosts';

export function KnownHostsPage(): React.JSX.Element {
  const knownHostsQuery = useTerminalKnownHosts();
  const deleteKnownHost = useDeleteTerminalKnownHost();

  const knownHosts = Array.isArray(knownHostsQuery.data?.known_hosts) ? knownHostsQuery.data.known_hosts : [];

  return (
    <div data-testid="page-known-hosts" className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Known Hosts</h1>
        <p className="text-sm text-muted-foreground">Trusted SSH host keys</p>
      </div>

      {knownHosts.length === 0 ? (
        <div className="py-12 text-center">
          <Shield className="mx-auto size-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">No known hosts yet. Host keys will appear here when you connect to servers.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {knownHosts.map((kh) => (
            <KnownHostCard key={kh.id} knownHost={kh} onDelete={(id) => deleteKnownHost.mutate(id)} />
          ))}
        </div>
      )}
    </div>
  );
}
