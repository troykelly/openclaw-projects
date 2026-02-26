/**
 * Known Hosts Page (Epic #1667, #1696).
 *
 * Lists trusted host keys with revoke capability.
 * Wire host-key-dialog per Issue #1866.
 */
import * as React from 'react';
import { useState } from 'react';
import { Shield } from 'lucide-react';
import { KnownHostCard } from '@/ui/components/terminal/known-host-card';
import { HostKeyDialog } from '@/ui/components/terminal/host-key-dialog';
import {
  useTerminalKnownHosts,
  useDeleteTerminalKnownHost,
} from '@/ui/hooks/queries/use-terminal-known-hosts';
import type { TerminalKnownHost } from '@/ui/lib/api-types';

export function KnownHostsPage(): React.JSX.Element {
  const knownHostsQuery = useTerminalKnownHosts();
  const deleteKnownHost = useDeleteTerminalKnownHost();
  const [verifyHost, setVerifyHost] = useState<TerminalKnownHost | null>(null);

  const knownHosts = Array.isArray(knownHostsQuery.data?.known_hosts) ? knownHostsQuery.data.known_hosts : [];

  const handleDismiss = () => {
    setVerifyHost(null);
  };

  const handleRevokeFromDialog = () => {
    if (!verifyHost) return;
    deleteKnownHost.mutate(verifyHost.id, { onSuccess: () => setVerifyHost(null) });
  };

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
            <KnownHostCard
              key={kh.id}
              knownHost={kh}
              onDelete={(id) => deleteKnownHost.mutate(id)}
              onVerify={() => setVerifyHost(kh)}
            />
          ))}
        </div>
      )}

      {/* Host Key Verification Dialog (#1866) — shows key details with option to revoke */}
      {verifyHost && (
        <HostKeyDialog
          open={!!verifyHost}
          onOpenChange={(open) => { if (!open) setVerifyHost(null); }}
          host={verifyHost.host}
          port={verifyHost.port}
          keyType={verifyHost.key_type}
          fingerprint={verifyHost.key_fingerprint}
          onApprove={handleDismiss}
          onReject={handleRevokeFromDialog}
          isPending={deleteKnownHost.isPending}
        />
      )}
    </div>
  );
}
