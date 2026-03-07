/**
 * Symphony Host Health Page.
 *
 * Displays per-host status cards with health indicators, capacity,
 * disk usage, container inventory, cleanup items, drain/activate
 * controls, and circuit breaker state.
 *
 * @see Issue #2210 (Epic #2186)
 */
import React from 'react';
import {
  Server,
  HardDrive,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Pause,
  Play,
  Box,
} from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Progress } from '@/ui/components/ui/progress';
import {
  useSymphonyHosts,
  useDrainSymphonyHost,
  useActivateSymphonyHost,
} from '@/ui/hooks/queries/use-symphony-hosts';
import type {
  SymphonyHost,
  SymphonyHostStatus,
  SymphonyContainerInfo,
} from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadgeVariant(status: SymphonyHostStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'online': return 'default';
    case 'degraded': return 'secondary';
    case 'offline': return 'destructive';
    default: return 'outline';
  }
}

function statusIcon(status: SymphonyHostStatus): React.ReactNode {
  switch (status) {
    case 'online':
      return <CheckCircle2 className="size-4 text-green-500" />;
    case 'degraded':
      return <AlertTriangle className="size-4 text-yellow-500" />;
    case 'offline':
      return <XCircle className="size-4 text-red-500" />;
    default:
      return <Activity className="size-4 text-muted-foreground" />;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

/** Safely extract error message from an unknown error. */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'An unexpected error occurred';
}

function circuitBreakerVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (state) {
    case 'closed': return 'default';
    case 'half_open': return 'secondary';
    case 'open': return 'destructive';
    default: return 'outline';
  }
}

// ---------------------------------------------------------------------------
// Host Card
// ---------------------------------------------------------------------------

function HostCard({ host }: { host: SymphonyHost }): React.JSX.Element {
  const drainMutation = useDrainSymphonyHost();
  const activateMutation = useActivateSymphonyHost();

  const diskPercent =
    host.disk_usage_bytes != null && host.disk_total_bytes != null && host.disk_total_bytes > 0
      ? Math.round((host.disk_usage_bytes / host.disk_total_bytes) * 100)
      : null;

  return (
    <Card data-testid={`host-card-${host.id}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="size-5 text-primary" />
            <CardTitle className="text-lg">
              {host.connection_name ?? host.id.slice(0, 8)}
            </CardTitle>
          </div>
          <Badge
            data-testid="host-status-badge"
            variant={statusBadgeVariant(host.status)}
          >
            {statusIcon(host.status)}
            <span className="ml-1">{host.status}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sessions / Capacity */}
        <div data-testid="host-sessions" className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Sessions</span>
          <span className="text-sm font-medium">
            {host.active_sessions} / {host.max_concurrent_sessions}
          </span>
        </div>
        <Progress value={host.max_concurrent_sessions > 0 ? (host.active_sessions / host.max_concurrent_sessions) * 100 : 0} />

        {/* Disk Usage */}
        <div data-testid="host-disk-usage">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <HardDrive className="size-3" />
              Disk
            </span>
            {diskPercent != null ? (
              <span className="text-sm font-medium">
                {formatBytes(host.disk_usage_bytes!)} / {formatBytes(host.disk_total_bytes!)} ({diskPercent}%)
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">N/A</span>
            )}
          </div>
          {diskPercent != null && <Progress value={diskPercent} />}
        </div>

        {/* Circuit Breaker */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Circuit Breaker</span>
          <Badge
            data-testid="circuit-breaker-state"
            variant={circuitBreakerVariant(host.circuit_breaker_state)}
          >
            {host.circuit_breaker_state}
            {host.circuit_breaker_failures > 0 && (
              <span className="ml-1">({host.circuit_breaker_failures})</span>
            )}
          </Badge>
        </div>

        {/* Containers */}
        {host.containers.length > 0 && (
          <div>
            <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
              <Box className="size-3" />
              Containers ({host.containers.length})
            </p>
            <div className="space-y-1">
              {host.containers.map((c) => (
                <div
                  key={c.id}
                  data-testid={`container-${c.id}`}
                  className="flex items-center justify-between text-xs p-1.5 rounded-sm bg-muted/50"
                >
                  <span className="font-mono">{c.name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                    {c.ttl_remaining_s != null && (
                      <span className="text-muted-foreground">
                        TTL: {Math.round(c.ttl_remaining_s / 60)}m
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cleanup Items */}
        {host.cleanup_items.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">
              {host.cleanup_items.length} cleanup item(s) pending
            </p>
          </div>
        )}

        {/* Drain/Activate Controls */}
        <div className="flex gap-2 pt-2">
          {!host.is_draining ? (
            <Button
              variant="outline"
              size="sm"
              data-testid="drain-host-button"
              onClick={() => drainMutation.mutate(host.id)}
              disabled={drainMutation.isPending}
            >
              <Pause className="mr-1 size-3" />
              Drain
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              data-testid="activate-host-button"
              onClick={() => activateMutation.mutate(host.id)}
              disabled={activateMutation.isPending}
            >
              <Play className="mr-1 size-3" />
              Activate
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function HostHealthPage(): React.JSX.Element {
  const { data, isLoading, error } = useSymphonyHosts();

  if (isLoading) {
    return (
      <div data-testid="page-symphony-hosts" className="flex items-center justify-center p-12">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="page-symphony-hosts" className="p-6">
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Error loading hosts: {getErrorMessage(error)}
          </CardContent>
        </Card>
      </div>
    );
  }

  const hosts = Array.isArray(data?.hosts) ? data.hosts : [];

  return (
    <div data-testid="page-symphony-hosts" className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Server className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Host Health</h1>
          <p className="text-sm text-muted-foreground">
            Monitor Symphony orchestration hosts
          </p>
        </div>
      </div>

      {/* Host Grid */}
      {hosts.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No hosts configured. Add hosts in the project settings.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {hosts.map((host) => (
            <HostCard key={host.id} host={host} />
          ))}
        </div>
      )}
    </div>
  );
}
