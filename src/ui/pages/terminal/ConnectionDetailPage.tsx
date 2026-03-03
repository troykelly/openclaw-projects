/**
 * Connection Detail Page (Epic #1667, #1692).
 */

import { ArrowLeft, CheckCircle, Loader2, Play, Shield, Trash2, XCircle } from 'lucide-react';
import type * as React from 'react';
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ErrorBanner } from '@/ui/components/feedback/error-state';
import { ConnectionForm } from '@/ui/components/terminal/connection-form';
import { ConnectionStatusIndicator } from '@/ui/components/terminal/connection-status-indicator';
import { HostKeyDialog } from '@/ui/components/terminal/host-key-dialog';
import { KnownHostCard } from '@/ui/components/terminal/known-host-card';
import { ProxyChainDiagram } from '@/ui/components/terminal/proxy-chain-diagram';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import {
  type TestConnectionResponse,
  useDeleteTerminalConnection,
  useDeleteTerminalKnownHost,
  useTerminalConnection,
  useTerminalConnections,
  useTerminalKnownHosts,
  useTestTerminalConnection,
  useUpdateTerminalConnection,
} from '@/ui/hooks/queries/use-terminal-connections';
import { useTerminalCredentials } from '@/ui/hooks/queries/use-terminal-credentials';
import { useTerminalHealth } from '@/ui/hooks/queries/use-terminal-health';
import { useCreateTerminalSession } from '@/ui/hooks/queries/use-terminal-sessions';
import { ApiRequestError } from '@/ui/lib/api-client';
import type { TerminalConnection } from '@/ui/lib/api-types';

/** Extract a user-friendly error message from a mutation error. */
function formatMutationError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 502 || error.status === 503 || error.status === 504) {
      return 'Terminal worker unavailable. The backend service may be down or restarting.';
    }
    if (error.status >= 500) return fallback;
    if (error.status === 400) return 'Invalid request. Please check the connection configuration.';
    if (error.status === 404) return 'Connection not found.';
    return fallback;
  }
  return fallback;
}

/** Detect host-key verification failure from test response. */
function isHostKeyFailure(result: TestConnectionResponse): boolean {
  if (result.success) return false;
  // Prefer structured error_code from the backend (Issue #1983).
  if (result.error_code === 'HOST_KEY_VERIFICATION_FAILED') return true;
  // Fallback: heuristic string match for older workers that lack error_code.
  const msg = result.message.toLowerCase();
  return (msg.includes('host denied') || msg.includes('verification')) && !!result.host_key_fingerprint;
}

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
  const healthQuery = useTerminalHealth();
  const workerAvailable = healthQuery.data?.status === 'ok';

  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestConnectionResponse | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [hostKeyDialog, setHostKeyDialog] = useState<{
    fingerprint: string;
    keyType: string;
  } | null>(null);

  const connection = connectionQuery.data;
  const allConnections = Array.isArray(allConnectionsQuery.data?.connections) ? allConnectionsQuery.data.connections : [];
  const credentials = Array.isArray(credentialsQuery.data?.credentials) ? credentialsQuery.data.credentials.map((c) => ({ id: c.id, name: c.name })) : [];

  const knownHostsQuery = useTerminalKnownHosts(connection?.id);
  const knownHosts = Array.isArray(knownHostsQuery.data?.known_hosts) ? knownHostsQuery.data.known_hosts : [];
  const deleteKnownHost = useDeleteTerminalKnownHost();

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

  const handleTest = (trustHostKey = false, expectedFingerprint?: string) => {
    setTestError(null);
    if (!trustHostKey) setTestResult(null);

    testConnection.mutate(
      { id: connection.id, trustHostKey, expectedFingerprint },
      {
        onSuccess: (result) => {
          setTestResult(result);
          if (isHostKeyFailure(result)) {
            setHostKeyDialog({
              fingerprint: result.host_key_fingerprint,
              keyType: result.host_key_fingerprint.split(' ')[0] ?? 'unknown',
            });
          }
        },
        onError: (err) => setTestError(formatMutationError(err, 'Connection test failed')),
      },
    );
  };

  const handleHostKeyApprove = () => {
    const fp = hostKeyDialog?.fingerprint;
    setHostKeyDialog(null);
    handleTest(true, fp);
  };

  const handleUpdate = (data: Partial<TerminalConnection>) => {
    updateConnection.mutate(
      { id: connection.id, ...data },
      {
        onSuccess: () => setEditOpen(false),
      },
    );
  };

  const handleDelete = () => {
    deleteConnection.mutate(connection.id, {
      onSuccess: () => navigate('/terminal/connections'),
    });
  };

  const handleStartSession = () => {
    setSessionError(null);
    createSession.mutate(
      { connection_id: connection.id },
      {
        onSuccess: (session) => navigate(`/terminal/sessions/${session.id}`),
        onError: (err) => setSessionError(formatMutationError(err, 'Failed to start session')),
      },
    );
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
          <Button
            variant="outline"
            onClick={() => handleTest()}
            disabled={testConnection.isPending || !workerAvailable}
          >
            {testConnection.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
            Test
          </Button>
          <Button
            onClick={() => {
              setSessionError(null);
              handleStartSession();
            }}
            disabled={createSession.isPending || !workerAvailable}
          >
            {createSession.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Start Session
          </Button>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button variant="ghost" className="text-red-500" onClick={handleDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {testResult && !isHostKeyFailure(testResult) && (
        <div data-testid="test-result-banner" className={`flex items-center gap-2 rounded-md border p-3 text-sm ${testResult.success ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {testResult.success ? <CheckCircle className="size-4" /> : <XCircle className="size-4" />}
          <span>{testResult.success ? `Connection successful (${testResult.latency_ms}ms)` : testResult.message}</span>
        </div>
      )}

      {testError && (
        <ErrorBanner
          message={testError}
          onDismiss={() => setTestError(null)}
          onRetry={() => handleTest()}
        />
      )}

      {sessionError && <ErrorBanner message={sessionError} onDismiss={() => setSessionError(null)} onRetry={handleStartSession} />}

      {!workerAvailable && !healthQuery.isLoading && (
        <ErrorBanner message="Terminal worker is not available. Session and connection test features are disabled." onRetry={() => healthQuery.refetch()} />
      )}

      {connection.proxy_jump_id && <ProxyChainDiagram connection={connection} allConnections={allConnections} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Details</CardTitle>
          </CardHeader>
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
          <CardHeader>
            <CardTitle className="text-sm">Metadata</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {connection.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {connection.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Shield className="size-4" />
            Known Hosts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {knownHostsQuery.isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : knownHosts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No known hosts for this connection.</p>
          ) : (
            <div className="grid gap-3">
              {knownHosts.map((kh) => (
                <KnownHostCard
                  key={kh.id}
                  knownHost={kh}
                  onDelete={(khId) => deleteKnownHost.mutate(khId)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConnectionForm
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={handleUpdate}
        initial={connection}
        isPending={updateConnection.isPending}
        credentials={credentials}
      />

      {hostKeyDialog && (
        <HostKeyDialog
          open
          onOpenChange={(open) => { if (!open) setHostKeyDialog(null); }}
          host={connection.host ?? 'unknown'}
          port={connection.port}
          keyType={hostKeyDialog.keyType}
          fingerprint={hostKeyDialog.fingerprint}
          onApprove={handleHostKeyApprove}
          onReject={() => setHostKeyDialog(null)}
          isPending={testConnection.isPending}
        />
      )}
    </div>
  );
}
