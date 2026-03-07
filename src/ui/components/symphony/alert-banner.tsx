/**
 * AlertBanner — surfaces actionable issues on the Symphony dashboard.
 *
 * Displays alerts for paused runs, degraded hosts, budget warnings,
 * and cleanup failures. Each alert has a one-click action button.
 * Alerts are ordered by severity (errors first).
 *
 * Issue #2207
 */
import React from 'react';
import { AlertTriangle, Pause, Server, DollarSign, Trash2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import type { SymphonyRun, SymphonyHost } from '@/ui/lib/api-types.ts';

export interface SymphonyAlert {
  id: string;
  severity: 'error' | 'warning' | 'info';
  icon: React.ReactNode;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface AlertBannerProps {
  alerts: SymphonyAlert[];
}

/** Build alerts from dashboard data. */
export function buildAlerts(
  runs: SymphonyRun[],
  hosts: SymphonyHost[],
  budgetPct: number,
): SymphonyAlert[] {
  const alerts: SymphonyAlert[] = [];

  // Paused runs
  const pausedRuns = runs.filter((r) => r.status === 'paused');
  if (pausedRuns.length > 0) {
    alerts.push({
      id: 'paused-runs',
      severity: 'warning',
      icon: <Pause className="size-4" />,
      message: `${pausedRuns.length} run${pausedRuns.length > 1 ? 's' : ''} paused and awaiting attention`,
    });
  }

  // Degraded hosts
  const degradedHosts = hosts.filter((h) => h.health_status === 'degraded');
  if (degradedHosts.length > 0) {
    alerts.push({
      id: 'degraded-hosts',
      severity: 'warning',
      icon: <Server className="size-4" />,
      message: `${degradedHosts.length} host${degradedHosts.length > 1 ? 's' : ''} degraded`,
    });
  }

  // Offline hosts
  const offlineHosts = hosts.filter((h) => h.health_status === 'offline');
  if (offlineHosts.length > 0) {
    alerts.push({
      id: 'offline-hosts',
      severity: 'error',
      icon: <Server className="size-4" />,
      message: `${offlineHosts.length} host${offlineHosts.length > 1 ? 's' : ''} offline`,
    });
  }

  // Budget warning
  if (budgetPct >= 90) {
    alerts.push({
      id: 'budget-warning',
      severity: budgetPct >= 100 ? 'error' : 'warning',
      icon: <DollarSign className="size-4" />,
      message: budgetPct >= 100 ? 'Daily budget exceeded' : `Budget at ${budgetPct.toFixed(0)}%`,
    });
  }

  // Cleanup failed
  const cleanupFailed = runs.filter((r) => r.status === 'cleanup_failed');
  if (cleanupFailed.length > 0) {
    alerts.push({
      id: 'cleanup-failed',
      severity: 'error',
      icon: <Trash2 className="size-4" />,
      message: `${cleanupFailed.length} run${cleanupFailed.length > 1 ? 's' : ''} failed cleanup`,
    });
  }

  // Sort by severity: errors first, then warnings, then info
  const severityOrder = { error: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

export function AlertBanner({ alerts }: AlertBannerProps): React.JSX.Element | null {
  if (alerts.length === 0) return null;

  return (
    <div data-testid="alert-banner" className="space-y-2">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          data-testid={`alert-${alert.id}`}
          className={`flex items-center gap-3 rounded-md border p-3 ${
            alert.severity === 'error'
              ? 'border-destructive/50 bg-destructive/10 text-destructive'
              : alert.severity === 'warning'
                ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                : 'border-border bg-muted/50 text-muted-foreground'
          }`}
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1 text-sm">{alert.message}</span>
          {alert.action && (
            <Button
              variant="outline"
              size="sm"
              onClick={alert.action.onClick}
              data-testid={`alert-action-${alert.id}`}
            >
              {alert.action.label}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
