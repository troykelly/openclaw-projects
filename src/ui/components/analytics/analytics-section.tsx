/**
 * Analytics section for the Dashboard page.
 *
 * Displays velocity bar chart and project health cards
 * using lightweight SVG-based charts (no external chart library).
 *
 * @see Issue #1734
 * @see Issue #1839 — fixed to match actual API response shapes
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Loader2 } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { apiClient } from '@/ui/lib/api-client';

// ---------------------------------------------------------------------------
// Types — matching actual API response shapes
// ---------------------------------------------------------------------------

/** Raw velocity row from GET /api/analytics/velocity → { weeks: VelocityWeek[] } */
interface VelocityWeek {
  week_start: string;
  completed_count: number;
  estimated_minutes: number;
}

/**
 * Raw project health row from GET /api/analytics/project-health
 * → { projects: ApiProjectHealth[] }
 */
interface ApiProjectHealth {
  id: string;
  title: string;
  open_count: number;
  in_progress_count: number;
  closed_count: number;
  total_count: number;
}

/** Derived health status for display. */
interface ProjectHealthDisplay {
  id: string;
  title: string;
  health: 'healthy' | 'at_risk' | 'behind';
  completion_pct: number;
  open_count: number;
  in_progress_count: number;
  closed_count: number;
  total_count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive a health label from raw project counts. */
function deriveHealth(p: ApiProjectHealth): ProjectHealthDisplay {
  const total = p.total_count || 1; // avoid division by zero
  const completionPct = Math.round((p.closed_count / total) * 100);

  let health: ProjectHealthDisplay['health'] = 'healthy';
  if (p.open_count > p.closed_count && p.in_progress_count === 0) {
    health = 'behind';
  } else if (p.open_count > p.closed_count) {
    health = 'at_risk';
  }

  return {
    id: p.id,
    title: p.title,
    health,
    completion_pct: completionPct,
    open_count: p.open_count,
    in_progress_count: p.in_progress_count,
    closed_count: p.closed_count,
    total_count: p.total_count,
  };
}

// ---------------------------------------------------------------------------
// SVG Charts
// ---------------------------------------------------------------------------

/** Simple SVG bar chart for velocity data. */
function VelocityChart({ data }: { data: VelocityWeek[] }): React.JSX.Element {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No velocity data available.</p>;
  }

  const width = 400;
  const height = 180;
  const padding = { top: 10, right: 10, bottom: 30, left: 35 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(...data.map((d) => d.completed_count), 1);
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
        const barH = (d.completed_count / maxVal) * chartH;
        const x = padding.left + gap * (i + 1) + barW * i;
        const y = padding.top + chartH - barH;
        const label = d.week_start.slice(5); // "MM-DD"

        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx={3} fill="#8b5cf6" opacity={0.8} />
            {/* Value on top of bar */}
            <text x={x + barW / 2} y={y - 4} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.7}>
              {d.completed_count}
            </text>
            {/* Period label */}
            <text x={x + barW / 2} y={height - 8} fontSize={8} textAnchor="middle" fill="currentColor" opacity={0.5}>
              {label}
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

function HealthCard({ project }: { project: ProjectHealthDisplay }): React.JSX.Element {
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
        <p className="text-sm font-medium truncate">{project.title}</p>
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
        <span>{project.open_count} open</span>
        {project.in_progress_count > 0 && <span className="text-blue-500">{project.in_progress_count} in progress</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AnalyticsSection(): React.JSX.Element {
  const [velocity, setVelocity] = useState<VelocityWeek[]>([]);
  const [health, setHealth] = useState<ProjectHealthDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const results = await Promise.allSettled([
          apiClient.get<{ weeks: VelocityWeek[] }>('/api/analytics/velocity'),
          apiClient.get<{ projects: ApiProjectHealth[] }>('/api/analytics/project-health'),
        ]);

        if (!alive) return;

        if (results[0].status === 'fulfilled' && Array.isArray(results[0].value.weeks)) {
          // Reverse so oldest week is first (API returns DESC)
          setVelocity([...results[0].value.weeks].reverse());
        }
        if (results[1].status === 'fulfilled' && Array.isArray(results[1].value.projects)) {
          setHealth(results[1].value.projects.map(deriveHealth));
        }

        // Only show error if all failed
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

  if (error && velocity.length === 0 && health.length === 0) {
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
      {/* Velocity chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-5 text-violet-500" />
            Velocity
          </CardTitle>
          <CardDescription>Items completed per week</CardDescription>
        </CardHeader>
        <CardContent>
          <VelocityChart data={velocity} />
        </CardContent>
      </Card>

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
                <HealthCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
