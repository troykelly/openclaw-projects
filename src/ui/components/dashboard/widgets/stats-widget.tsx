/**
 * Statistics widget for dashboard
 * Issue #405: Implement custom dashboard builder
 */
import * as React from 'react';
import { CheckCircle, Clock, AlertTriangle, LayoutList } from 'lucide-react';
import { cn } from '@/ui/lib/utils';

export interface Stats {
  completedThisWeek: number;
  inProgress: number;
  overdue: number;
  total: number;
}

export interface StatsWidgetProps {
  stats: Stats;
  className?: string;
}

export function StatsWidget({ stats, className }: StatsWidgetProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-4', className)}>
      <StatCard icon={CheckCircle} label="Completed" value={stats.completedThisWeek} subLabel="this week" className="text-green-500" testId="stat-completed" />
      <StatCard icon={Clock} label="In Progress" value={stats.inProgress} className="text-blue-500" testId="stat-in-progress" />
      <StatCard icon={AlertTriangle} label="Overdue" value={stats.overdue} className="text-red-500" testId="stat-overdue" />
      <StatCard icon={LayoutList} label="Total" value={stats.total} className="text-muted-foreground" testId="stat-total" />
    </div>
  );
}

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: number;
  subLabel?: string;
  className?: string;
  testId: string;
}

function StatCard({ icon: Icon, label, value, subLabel, className, testId }: StatCardProps) {
  return (
    <div data-testid={testId} className={cn('flex items-center gap-3 p-3 rounded-lg bg-muted/50', className)}>
      <Icon className="h-5 w-5 shrink-0" />
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">
          {label}
          {subLabel && <span className="block">{subLabel}</span>}
        </div>
      </div>
    </div>
  );
}
