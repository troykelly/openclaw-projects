/**
 * Tunnels Page (Epic #1667, #1696).
 */
import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import { Plus, ArrowLeftRight } from 'lucide-react';
import { TunnelCard } from '@/ui/components/terminal/tunnel-card';
import { TunnelForm } from '@/ui/components/terminal/tunnel-form';
import { useTerminalTunnels, useCreateTerminalTunnel, useDeleteTerminalTunnel } from '@/ui/hooks/queries/use-terminal-tunnels';
import { useTerminalConnections } from '@/ui/hooks/queries/use-terminal-connections';

export function TunnelsPage(): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false);

  const tunnelsQuery = useTerminalTunnels();
  const connectionsQuery = useTerminalConnections();
  const createTunnel = useCreateTerminalTunnel();
  const deleteTunnel = useDeleteTerminalTunnel();

  const tunnels = Array.isArray(tunnelsQuery.data?.tunnels) ? tunnelsQuery.data.tunnels : [];
  const connections = Array.isArray(connectionsQuery.data?.connections) ? connectionsQuery.data.connections : [];

  const handleCreate = (data: { connection_id: string; direction: string; bind_host?: string; bind_port: number; target_host?: string; target_port?: number }) => {
    createTunnel.mutate(data, { onSuccess: () => setCreateOpen(false) });
  };

  return (
    <div data-testid="page-tunnels" className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tunnels</h1>
          <p className="text-sm text-muted-foreground">Manage SSH tunnels</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 size-4" /> New Tunnel
        </Button>
      </div>

      {tunnels.length === 0 ? (
        <div className="py-12 text-center">
          <ArrowLeftRight className="mx-auto size-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">No tunnels yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tunnels.map((tunnel) => (
            <TunnelCard key={tunnel.id} tunnel={tunnel} onDelete={(id) => deleteTunnel.mutate(id)} />
          ))}
        </div>
      )}

      <TunnelForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        connections={connections}
        isPending={createTunnel.isPending}
      />
    </div>
  );
}
