/**
 * Terminal Dashboard Page (Epic #1667, #1691).
 *
 * Landing page for terminal management with stats, session list,
 * tunnels summary, and quick connect.
 */
import * as React from 'react';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/components/ui/card';
import { Button } from '@/ui/components/ui/button';
import { Server, Key, ArrowRight, ArrowLeftRight } from 'lucide-react';
import { TerminalDashboardStatsCards } from '@/ui/components/terminal/terminal-dashboard-stats';
import { SessionCard } from '@/ui/components/terminal/session-card';
import { QuickConnectDialog } from '@/ui/components/terminal/quick-connect-dialog';
import { TerminalEmptyState } from '@/ui/components/terminal/terminal-empty-state';
import { useTerminalSessions, useTerminalStats } from '@/ui/hooks/queries/use-terminal-sessions';
import { useTerminalConnections } from '@/ui/hooks/queries/use-terminal-connections';
import { useTerminalTunnels } from '@/ui/hooks/queries/use-terminal-tunnels';

export function TerminalDashboardPage(): React.JSX.Element {
  const statsQuery = useTerminalStats();
  const sessionsQuery = useTerminalSessions();
  const connectionsQuery = useTerminalConnections();
  const tunnelsQuery = useTerminalTunnels();

  const sessions = Array.isArray(sessionsQuery.data?.sessions) ? sessionsQuery.data.sessions : [];
  const connections = Array.isArray(connectionsQuery.data?.connections) ? connectionsQuery.data.connections : [];
  const tunnels = Array.isArray(tunnelsQuery.data?.tunnels) ? tunnelsQuery.data.tunnels : [];
  const activeTunnels = tunnels.filter((t) => t.status === 'active');

  const hasData = connections.length > 0 || sessions.length > 0;
  const isInitialLoad = sessionsQuery.isLoading && connectionsQuery.isLoading;

  if (!isInitialLoad && !hasData) {
    return (
      <div data-testid="page-terminal-dashboard" className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Terminal</h1>
          <p className="text-sm text-muted-foreground">Manage SSH connections and terminal sessions</p>
        </div>
        <TerminalEmptyState />
      </div>
    );
  }

  return (
    <div data-testid="page-terminal-dashboard" className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Terminal</h1>
          <p className="text-sm text-muted-foreground">Manage SSH connections and terminal sessions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/terminal/connections">
              <Server className="mr-2 size-4" />
              Connections
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/terminal/credentials">
              <Key className="mr-2 size-4" />
              Credentials
            </Link>
          </Button>
          <QuickConnectDialog />
        </div>
      </div>

      {/* Stats */}
      <TerminalDashboardStatsCards stats={statsQuery.data} isLoading={statsQuery.isLoading} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sessions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Sessions</CardTitle>
            <CardDescription>{sessions.length} session{sessions.length !== 1 ? 's' : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No sessions yet.</p>
            ) : (
              <div className="space-y-2">
                {sessions.slice(0, 5).map((session) => (
                  <SessionCard key={session.id} session={session} />
                ))}
                {sessions.length > 5 && (
                  <Link to="/terminal/sessions" className="flex items-center justify-center gap-1 text-sm text-primary hover:underline py-2">
                    View all sessions <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active Tunnels */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight className="size-4 text-purple-500" />
              Active Tunnels
            </CardTitle>
            <CardDescription>{activeTunnels.length} active tunnel{activeTunnels.length !== 1 ? 's' : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            {activeTunnels.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No active tunnels.</p>
            ) : (
              <div className="space-y-2">
                {activeTunnels.slice(0, 5).map((tunnel) => (
                  <div key={tunnel.id} className="flex items-center justify-between rounded-lg border border-border p-2 text-xs">
                    <span className="font-mono">{tunnel.bind_host}:{tunnel.bind_port}</span>
                    <span className="text-muted-foreground">{tunnel.direction}</span>
                    <span className="font-mono">{tunnel.target_host}:{tunnel.target_port}</span>
                  </div>
                ))}
                {activeTunnels.length > 5 && (
                  <Link to="/terminal/tunnels" className="flex items-center justify-center gap-1 text-sm text-primary hover:underline py-2">
                    View all tunnels <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
