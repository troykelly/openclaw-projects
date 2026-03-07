/**
 * Symphony Dashboard page — /app/symphony
 *
 * Primary view of what Symphony is doing right now:
 * - "Working on Now" section with active RunCards
 * - "Next Up" queue with reorderable items
 * - Global stats bar (active runs, budget, hosts, completed)
 * - Alert banner for actionable issues
 * - WebSocket for real-time updates
 *
 * Issue #2207
 */
import React from 'react';
import {
  Activity,
  Server,
  CheckCircle2,
  DollarSign,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Badge } from '@/ui/components/ui/badge';
import { RunCard, QueueItem, BudgetGauge, AlertBanner, buildAlerts } from '@/ui/components/symphony';
import {
  useSymphonyStatus,
  useSymphonyQueue,
  useSymphonyHosts,
} from '@/ui/hooks/queries/use-symphony.ts';
import { useSymphonyWebSocket } from '@/ui/hooks/use-symphony-websocket.ts';
import type { SymphonyRun } from '@/ui/lib/api-types.ts';

/** Status values considered "active". */
const ACTIVE_STATUSES = new Set([
  'claimed', 'provisioning', 'prompting', 'running',
  'awaiting_approval', 'verifying_result', 'merge_pending',
  'post_merge_verify', 'issue_closing',
]);

/** Status values considered "queued" (next up). */
const QUEUED_STATUSES = new Set(['unclaimed', 'retry_queued']);

/** Status values considered "completed" for today's count. */
const COMPLETED_STATUSES = new Set(['succeeded']);

export function SymphonyDashboardPage(): React.JSX.Element {
  const statusQuery = useSymphonyStatus();
  const queueQuery = useSymphonyQueue({ limit: 50 });
  const hostsQuery = useSymphonyHosts();
  const { status: wsStatus } = useSymphonyWebSocket({ enabled: true });

  const allRuns: SymphonyRun[] = Array.isArray(queueQuery.data?.data)
    ? queueQuery.data.data
    : [];

  const activeRuns = allRuns.filter((r) => ACTIVE_STATUSES.has(r.status));
  const queuedRuns = allRuns.filter((r) => QUEUED_STATUSES.has(r.status));
  const hosts = Array.isArray(hostsQuery.data?.data) ? hostsQuery.data.data : [];

  // Compute stats
  const statusCounts = statusQuery.data?.status_counts ?? {};
  const activeCount = activeRuns.length;
  const hostsOnline = hosts.filter((h) => h.health_status === 'online').length;
  const hostsDegraded = hosts.filter((h) => h.health_status === 'degraded').length;
  const hostsOffline = hosts.filter((h) => h.health_status === 'offline').length;
  const completedToday = statusCounts['succeeded'] ?? 0;

  // Budget calculation (placeholder — real data from config)
  const budgetSpent = allRuns.reduce((sum, r) => sum + (r.estimated_cost_usd ?? 0), 0);
  const budgetLimit = 50; // Default limit, would come from config
  const budgetPct = budgetLimit > 0 ? (budgetSpent / budgetLimit) * 100 : 0;

  // Build alerts
  const alerts = buildAlerts(allRuns, hosts, budgetPct);

  const isLoading = statusQuery.isLoading || queueQuery.isLoading || hostsQuery.isLoading;
  const isError = statusQuery.isError || queueQuery.isError || hostsQuery.isError;

  return (
    <div data-testid="page-symphony-dashboard" className="h-full flex flex-col p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Symphony</h1>
            <p className="text-sm text-muted-foreground">AI orchestration dashboard</p>
          </div>
        </div>
        <Badge
          variant={wsStatus === 'connected' ? 'default' : 'secondary'}
          className="gap-1"
          data-testid="ws-status"
        >
          {wsStatus === 'connected' ? (
            <Wifi className="size-3" />
          ) : (
            <WifiOff className="size-3" />
          )}
          {wsStatus === 'connected' ? 'Live' : wsStatus}
        </Badge>
      </div>

      {/* Alert banner */}
      <AlertBanner alerts={alerts} />

      {/* Global stats bar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="stats-bar">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Active Runs</div>
            <div className="text-2xl font-bold" data-testid="stat-active">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Budget Today</div>
            <BudgetGauge spent={budgetSpent} limit={budgetLimit} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Hosts</div>
            <div className="flex items-center gap-2">
              <Server className="size-4 text-muted-foreground" />
              <span className="text-2xl font-bold" data-testid="stat-hosts-online">{hostsOnline}</span>
              {hostsDegraded > 0 && (
                <Badge variant="secondary" className="text-xs">{hostsDegraded} degraded</Badge>
              )}
              {hostsOffline > 0 && (
                <Badge variant="destructive" className="text-xs">{hostsOffline} offline</Badge>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Completed Today</div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-green-500" />
              <span className="text-2xl font-bold" data-testid="stat-completed">{completedToday}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main content */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12" data-testid="loading-state">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : isError ? (
        <Card data-testid="error-state">
          <CardContent className="p-6 text-center text-destructive">
            Failed to load Symphony data. Please try again.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 flex-1 min-h-0">
          {/* Working on Now */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Activity className="size-5" />
              Working on Now
              <Badge variant="secondary" className="ml-auto">{activeRuns.length}</Badge>
            </h2>
            {activeRuns.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground" data-testid="no-active-runs">
                  No active runs. Queue items will start automatically.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3" data-testid="active-runs-list">
                {activeRuns.map((run, index) => (
                  <RunCard key={run.id} run={run} index={index} />
                ))}
              </div>
            )}
          </div>

          {/* Next Up Queue */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              Next Up
              <Badge variant="secondary" className="ml-auto">{queuedRuns.length}</Badge>
            </h2>
            {queuedRuns.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground" data-testid="no-queued-runs">
                  Queue is empty. Issues synced from GitHub will appear here.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2" data-testid="queue-list">
                {queuedRuns.map((run) => (
                  <QueueItem key={run.id} run={run} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
