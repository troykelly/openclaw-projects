/**
 * Terminal dashboard summary cards (Epic #1667, #1691).
 *
 * Displays active sessions, connections, tunnels, and error counts
 * as stat cards for the terminal dashboard page.
 */
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Monitor, Server, ArrowLeftRight, AlertCircle } from 'lucide-react';
import type { TerminalDashboardStats } from '@/ui/lib/api-types';

interface TerminalDashboardStatsProps {
  stats: TerminalDashboardStats | undefined;
  isLoading: boolean;
}

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
}

function StatCard({ title, value, icon, colorClass }: StatCardProps): React.JSX.Element {
  return (
    <Card data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={colorClass}>{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

export function TerminalDashboardStatsCards({ stats, isLoading }: TerminalDashboardStatsProps): React.JSX.Element {
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="terminal-stats-loading">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="terminal-stats">
      <StatCard
        title="Active Sessions"
        value={stats?.active_sessions ?? 0}
        icon={<Monitor className="size-4" />}
        colorClass="text-green-600 dark:text-green-400"
      />
      <StatCard
        title="Connections"
        value={stats?.total_connections ?? 0}
        icon={<Server className="size-4" />}
        colorClass="text-blue-600 dark:text-blue-400"
      />
      <StatCard
        title="Active Tunnels"
        value={stats?.active_tunnels ?? 0}
        icon={<ArrowLeftRight className="size-4" />}
        colorClass="text-purple-600 dark:text-purple-400"
      />
      <StatCard
        title="Recent Errors"
        value={stats?.recent_errors ?? 0}
        icon={<AlertCircle className="size-4" />}
        colorClass={stats?.recent_errors ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}
      />
    </div>
  );
}
