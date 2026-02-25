/**
 * Connection Detail Page (Epic #1667, #1692).
 */
import * as React from 'react';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Badge } from '@/ui/components/ui/badge';
import { ArrowLeft, Play, Trash2, Loader2 } from 'lucide-react';
import { ConnectionStatusIndicator } from '@/ui/components/terminal/connection-status-indicator';
import { ConnectionForm } from '@/ui/components/terminal/connection-form';
import { ProxyChainDiagram } from '@/ui/components/terminal/proxy-chain-diagram';
import {
  useTerminalConnection,
  useTerminalConnections,
  useUpdateTerminalConnection,
  useDeleteTerminalConnection,
  useTestTerminalConnection,
} from '@/ui/hooks/queries/use-terminal-connections';
import { useTerminalCredentials } from '@/ui/hooks/queries/use-terminal-credentials';
import { useCreateTerminalSession } from '@/ui/hooks/queries/use-terminal-sessions';
import type { TerminalConnection } from '@/ui/lib/api-types';

export function ConnectionDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);

  const connectionQuery = useTerminalConnection(id ?? '');
  const allConnectionsQuery = useTerminalConnections();
  const credentialsQuery = useTerminalCredentials();
  const updateConnection = useUpdateTerminalConnection();
  const deleteConnection = useDeleteTerminalConnection();
  const testConnection = useTestTerminalConnection();
  const createSession = useCreateTerminalSession();

  const connection = connectionQuery.data;
  const allConnections = Array.isArray(allConnectionsQuery.data?.connections) ? allConnectionsQuery.data.connections : [];
  const credentials = Array.isArray(credentialsQuery.data?.credentials)
    ? credentialsQuery.data.credentials.map((c) => ({ id: c.id, name: c.name }))
    : [];

  if (connectionQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!connection) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Connection not found.</p>
      </div>
    );
  }

  const handleUpdate = (data: Partial<TerminalConnection>) => {
    updateConnection.mutate({ id: connection.id, ...data }, {
      onSuccess: () => setEditOpen(false),
    });
  };

  const handleDelete = () => {
    deleteConnection.mutate(connection.id, {
      onSuccess: () => navigate('/terminal/connections'),
    });
  };

  const handleStartSession = () => {
    createSession.mutate({ connection_id: connection.id }, {
      onSuccess: (session) => navigate(`/terminal/sessions/${session.id}`),
    });
  };

  return (
    <div data-testid="page-connection-detail" className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/terminal/connections')}>
          <ArrowLeft className="mr-1 size-4" /> Back
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            {connection.name}
            <ConnectionStatusIndicator connection={connection} />
          </h1>
          <p className="text-sm text-muted-foreground">
            {connection.is_local ? 'Local terminal' : `${connection.username ?? ''}@${connection.host}:${connection.port}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => testConnection.mutate(connection.id)} disabled={testConnection.isPending}>
            {testConnection.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
            Test
          </Button>
          <Button onClick={handleStartSession} disabled={createSession.isPending}>
            {createSession.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Start Session
          </Button>
          <Button variant="outline" onClick={() => setEditOpen(true)}>Edit</Button>
          <Button variant="ghost" className="text-red-500" onClick={handleDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {connection.proxy_jump_id && (
        <ProxyChainDiagram connection={connection} allConnections={allConnections} />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Auth Method</span>
              <span>{connection.auth_method ?? 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Host Key Policy</span>
              <span>{connection.host_key_policy}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Connect Timeout</span>
              <span>{connection.connect_timeout_s}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Keepalive</span>
              <span>{connection.keepalive_interval}s</span>
            </div>
            {connection.idle_timeout_s && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Idle Timeout</span>
                <span>{connection.idle_timeout_s}s</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Metadata</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {connection.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {connection.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                ))}
              </div>
            )}
            {connection.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{connection.notes}</p>}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span className="text-xs">{new Date(connection.created_at).toLocaleString()}</span>
            </div>
            {connection.last_connected_at && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Connected</span>
                <span className="text-xs">{new Date(connection.last_connected_at).toLocaleString()}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConnectionForm
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={handleUpdate}
        initial={connection}
        isPending={updateConnection.isPending}
        credentials={credentials}
      />
    </div>
  );
}
