/**
 * Connections Management Page (Epic #1667, #1692).
 */

import { Plus, Search, Server, Upload } from 'lucide-react';
import type * as React from 'react';
import { useState } from 'react';
import { ErrorBanner } from '@/ui/components/feedback/error-state';
import { ConnectionCard } from '@/ui/components/terminal/connection-card';
import { ConnectionForm } from '@/ui/components/terminal/connection-form';
import { SshConfigImportDialog } from '@/ui/components/terminal/ssh-config-import-dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import {
  useCreateTerminalConnection,
  useDeleteTerminalConnection,
  useImportSshConfig,
  useTerminalConnections,
  useTestTerminalConnection,
} from '@/ui/hooks/queries/use-terminal-connections';
import { useTerminalCredentials } from '@/ui/hooks/queries/use-terminal-credentials';
import { useTerminalHealth } from '@/ui/hooks/queries/use-terminal-health';
import type { TerminalConnection } from '@/ui/lib/api-types';

export function ConnectionsPage(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const connectionsQuery = useTerminalConnections(search || undefined);
  const credentialsQuery = useTerminalCredentials();
  const createConnection = useCreateTerminalConnection();
  const deleteConnection = useDeleteTerminalConnection();
  const testConnection = useTestTerminalConnection();
  const importSshConfig = useImportSshConfig();
  const healthQuery = useTerminalHealth();
  const workerAvailable = healthQuery.data?.status === 'ok';

  const connections = Array.isArray(connectionsQuery.data?.connections) ? connectionsQuery.data.connections : [];
  const credentials = Array.isArray(credentialsQuery.data?.credentials) ? credentialsQuery.data.credentials.map((c) => ({ id: c.id, name: c.name })) : [];

  const handleCreate = (data: Partial<TerminalConnection>) => {
    createConnection.mutate(data, {
      onSuccess: () => setCreateOpen(false),
    });
  };

  const handleTest = (id: string) => {
    setTestingId(id);
    testConnection.mutate(id, {
      onSettled: () => setTestingId(null),
    });
  };

  const handleDelete = (id: string) => {
    deleteConnection.mutate(id);
  };

  const handleImport = (config: string) => {
    importSshConfig.mutate(config, {
      onSuccess: () => setImportOpen(false),
    });
  };

  return (
    <div data-testid="page-connections" className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Connections</h1>
          <p className="text-sm text-muted-foreground">Manage SSH connections</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 size-4" />
            Import SSH Config
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 size-4" />
            New Connection
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search connections..." className="pl-9" />
      </div>

      {!workerAvailable && !healthQuery.isLoading && (
        <ErrorBanner message="Terminal worker is not available. Connection testing is disabled." onRetry={() => healthQuery.refetch()} />
      )}

      {connections.length === 0 ? (
        <div className="py-12 text-center">
          <Server className="mx-auto size-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">{search ? 'No connections match your search.' : 'No connections yet.'}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {connections.map((conn) => (
            <ConnectionCard key={conn.id} connection={conn} onTest={handleTest} onDelete={handleDelete} isTesting={testingId === conn.id} />
          ))}
        </div>
      )}

      <ConnectionForm open={createOpen} onOpenChange={setCreateOpen} onSubmit={handleCreate} isPending={createConnection.isPending} credentials={credentials} />

      <SshConfigImportDialog open={importOpen} onOpenChange={setImportOpen} onImport={handleImport} isPending={importSshConfig.isPending} />
    </div>
  );
}
