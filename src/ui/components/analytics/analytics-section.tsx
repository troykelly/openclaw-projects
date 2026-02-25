/**
 * Analytics section for the Dashboard page.
 *
 * Displays burndown chart, velocity bar chart, and project health cards
 * using lightweight SVG-based charts (no external chart library).
 *
 * @see Issue #1734
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Loader2, TrendingUp } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { apiClient } from '@/ui/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BurndownPoint {
  date: string;
  ideal: number;
  actual: number;
}

interface VelocityPeriod {
  period: string;
  completed: number;
}

interface ProjectHealth {
  project_id: string;
  project_title: string;
  health: 'healthy' | 'at_risk' | 'behind';
  completion_pct: number;
  open_items: number;
  blocked_items: number;
  overdue_items: number;
}

// ---------------------------------------------------------------------------
// SVG Charts
// ---------------------------------------------------------------------------

/** Simple SVG line chart for burndown data. */
function BurndownChart({ data }: { data: BurndownPoint[] }): React.JSX.Element {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No burndown data available.</p>;
  }

  const width = 400;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(...data.map((d) => Math.max(d.ideal, d.actual)), 1);
  const xStep = data.length > 1 ? chartW / (data.length - 1) : chartW;

  const toX = (i: number) => padding.left + i * xStep;
  const toY = (val: number) => padding.top + chartH - (val / maxVal) * chartH;

  const idealPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(d.ideal)}`).join(' ');
  const actualPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(d.actual)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" data-testid="burndown-chart">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
        <line
          key={pct}
          x1={padding.left}
          y1={toY(maxVal * pct)}
          x2={width - padding.right}
          y2={toY(maxVal * pct)}
          stroke="currentColor"
          strokeOpacity={0.1}
          strokeDasharray="4"
        />
      ))}

      {/* Ideal line */}
      <path d={idealPath} fill="none" stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 4" />

      {/* Actual line */}
      <path d={actualPath} fill="none" stroke="#3b82f6" strokeWidth={2.5} />

      {/* Dots on actual */}
      {data.map((d, i) => (
        <circle key={i} cx={toX(i)} cy={toY(d.actual)} r={3} fill="#3b82f6" />
      ))}

      {/* X axis labels (first and last date) */}
      <text x={padding.left} y={height - 5} fontSize={10} fill="currentColor" opacity={0.5}>
        {data[0].date.slice(5)}
      </text>
      <text x={width - padding.right} y={height - 5} fontSize={10} fill="currentColor" opacity={0.5} textAnchor="end">
        {data[data.length - 1].date.slice(5)}
      </text>

      {/* Legend */}
      <line x1={padding.left} y1={8} x2={padding.left + 20} y2={8} stroke="#94a3b8" strokeWidth={2} strokeDasharray="4" />
      <text x={padding.left + 24} y={12} fontSize={9} fill="currentColor" opacity={0.6}>
        Ideal
      </text>
      <line x1={padding.left + 60} y1={8} x2={padding.left + 80} y2={8} stroke="#3b82f6" strokeWidth={2} />
      <text x={padding.left + 84} y={12} fontSize={9} fill="currentColor" opacity={0.6}>
        Actual
      </text>
    </svg>
  );
}

/** Simple SVG bar chart for velocity data. */
function VelocityChart({ data }: { data: VelocityPeriod[] }): React.JSX.Element {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No velocity data available.</p>;
  }

  const width = 400;
  const height = 180;
  const padding = { top: 10, right: 10, bottom: 30, left: 35 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(...data.map((d) => d.completed), 1);
  const barW = Math.min(30, (chartW / data.length) * 0.6);
  const gap = (chartW - barW * data.length) / (data.length + 1);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" data-testid="velocity-chart">
      {/* Grid lines */}
      {[0, 0.5, 1].map((pct) => (
        <line
          key={pct}
          x1={padding.left}
          y1={padding.top + chartH * (1 - pct)}
          x2={width - padding.right}
          y2={padding.top + chartH * (1 - pct)}
          stroke="currentColor"
          strokeOpacity={0.1}
          strokeDasharray="4"
        />
      ))}

      {data.map((d, i) => {
        const barH = (d.completed / maxVal) * chartH;
        const x = padding.left + gap * (i + 1) + barW * i;
        const y = padding.top + chartH - barH;

        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx={3} fill="#8b5cf6" opacity={0.8} />
            {/* Value on top of bar */}
            <text x={x + barW / 2} y={y - 4} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.7}>
              {d.completed}
            </text>
            {/* Period label */}
            <text x={x + barW / 2} y={height - 8} fontSize={8} textAnchor="middle" fill="currentColor" opacity={0.5}>
              {d.period.length > 6 ? d.period.slice(5) : d.period}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Health Card
// ---------------------------------------------------------------------------

function HealthCard({ project }: { project: ProjectHealth }): React.JSX.Element {
  const healthConfig = {
    healthy: { color: 'text-green-600 dark:text-green-400', bg: 'bg-green-500/10', icon: CheckCircle2, label: 'Healthy' },
    at_risk: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', icon: AlertTriangle, label: 'At Risk' },
    behind: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', icon: AlertTriangle, label: 'Behind' },
  };

  const config = healthConfig[project.health] ?? healthConfig.healthy;
  const Icon = config.icon;

  return (
    <div className="rounded-lg border p-3" data-testid="health-card">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium truncate">{project.project_title}</p>
        <Badge variant="secondary" className={`text-xs ${config.color} ${config.bg}`}>
          <Icon className="mr-1 size-3" />
          {config.label}
        </Badge>
      </div>
      {/* Progress bar */}
      <div className="mb-2 h-2 rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, project.completion_pct)}%` }} />
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{project.completion_pct}% complete</span>
        <span>{project.open_items} open</span>
        {project.blocked_items > 0 && <span className="text-red-500">{project.blocked_items} blocked</span>}
        {project.overdue_items > 0 && <span className="text-amber-500">{project.overdue_items} overdue</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AnalyticsSection(): React.JSX.Element {
  const [burndown, setBurndown] = useState<BurndownPoint[]>([]);
  const [velocity, setVelocity] = useState<VelocityPeriod[]>([]);
  const [health, setHealth] = useState<ProjectHealth[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const results = await Promise.allSettled([
          apiClient.get<{ data: BurndownPoint[] }>('/api/analytics/burndown/default'),
          apiClient.get<{ data: VelocityPeriod[] }>('/api/analytics/velocity'),
          apiClient.get<{ projects: ProjectHealth[] }>('/api/analytics/project-health'),
        ]);

        if (!alive) return;

        if (results[0].status === 'fulfilled' && Array.isArray(results[0].value.data)) {
          setBurndown(results[0].value.data);
        }
        if (results[1].status === 'fulfilled' && Array.isArray(results[1].value.data)) {
          setVelocity(results[1].value.data);
        }
        if (results[2].status === 'fulfilled' && Array.isArray(results[2].value.projects)) {
          setHealth(results[2].value.projects);
        }

        // Only show error if all three failed
        const allFailed = results.every((r) => r.status === 'rejected');
        if (allFailed) {
          setError('Failed to load analytics data');
        }
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Failed to load analytics');
      } finally {
        if (alive) setIsLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  if (isLoading) {
    return (
      <Card data-testid="analytics-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="size-5 text-primary" />
            <CardTitle className="text-base">Analytics</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error && burndown.length === 0 && velocity.length === 0 && health.length === 0) {
    return (
      <Card data-testid="analytics-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="size-5 text-primary" />
            <CardTitle className="text-base">Analytics</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="analytics-section">
      {/* Burndown + Velocity row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Burndown chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-5 text-blue-500" />
              Burndown
            </CardTitle>
            <CardDescription>Items remaining over time</CardDescription>
          </CardHeader>
          <CardContent>
            <BurndownChart data={burndown} />
          </CardContent>
        </Card>

        {/* Velocity chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="size-5 text-violet-500" />
              Velocity
            </CardTitle>
            <CardDescription>Items completed per period</CardDescription>
          </CardHeader>
          <CardContent>
            <VelocityChart data={velocity} />
          </CardContent>
        </Card>
      </div>

      {/* Project Health */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-5 text-emerald-500" />
            Project Health
          </CardTitle>
          <CardDescription>Health indicators across projects</CardDescription>
        </CardHeader>
        <CardContent>
          {health.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No project health data available.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {health.map((project) => (
                <HealthCard key={project.project_id} project={project} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
