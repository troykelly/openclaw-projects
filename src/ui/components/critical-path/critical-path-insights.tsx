/**
 * Panel showing critical path summary and insights
 */
import * as React from 'react';
import { ClockIcon, AlertTriangleIcon, TrendingUpIcon } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import type { CriticalPathResult } from './critical-path-algorithm';

export interface CriticalPathInsightsProps {
  result: CriticalPathResult;
  taskNames: Record<string, string>;
  className?: string;
}

export function CriticalPathInsights({
  result,
  taskNames,
  className,
}: CriticalPathInsightsProps) {
  const { criticalPath, totalDuration, tasks } = result;

  // Find tasks with highest risk (converging dependencies)
  const convergingPoints = React.useMemo(() => {
    const dependencyCount = new Map<string, number>();
    for (const [taskId, timing] of tasks) {
      // Count how many tasks depend on this one
      let count = 0;
      for (const [, otherTiming] of tasks) {
        if (otherTiming.id !== taskId) {
          // Check if otherTiming.earlyStart depends on this task's finish
          if (otherTiming.earlyStart === timing.earlyFinish) {
            count++;
          }
        }
      }
      if (count > 1) {
        dependencyCount.set(taskId, count);
      }
    }
    return Array.from(dependencyCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [tasks]);

  // Calculate slack distribution
  const slackDistribution = React.useMemo(() => {
    const zeroSlack = Array.from(tasks.values()).filter(
      (t) => t.slack === 0
    ).length;
    const lowSlack = Array.from(tasks.values()).filter(
      (t) => t.slack > 0 && t.slack <= 2
    ).length;
    const highSlack = Array.from(tasks.values()).filter(
      (t) => t.slack > 2
    ).length;
    return { zeroSlack, lowSlack, highSlack };
  }, [tasks]);

  if (criticalPath.length === 0) {
    return (
      <div className={cn('p-4 text-center text-muted-foreground', className)}>
        <AlertTriangleIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No critical path identified.</p>
        <p className="text-sm mt-1">Add dependencies to calculate the critical path.</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <ClockIcon className="h-4 w-4" />
            <span className="text-sm">Total Duration</span>
          </div>
          <div className="text-2xl font-bold">{totalDuration} days</div>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUpIcon className="h-4 w-4" />
            <span className="text-sm">Critical Tasks</span>
          </div>
          <div className="text-2xl font-bold">{criticalPath.length} tasks</div>
        </div>
      </div>

      {/* Critical Path Tasks */}
      <div>
        <h4 className="text-sm font-medium mb-2">Critical Path</h4>
        <ScrollArea className="h-40 rounded-md border">
          <div className="p-3 space-y-2">
            {criticalPath.map((taskId, index) => {
              const timing = tasks.get(taskId);
              return (
                <div
                  key={taskId}
                  className="flex items-center gap-2 text-sm"
                >
                  <Badge
                    variant="outline"
                    className="border-destructive text-destructive shrink-0"
                  >
                    {index + 1}
                  </Badge>
                  <span className="flex-1 truncate">
                    {taskNames[taskId] || taskId}
                  </span>
                  {timing && (
                    <span className="text-muted-foreground shrink-0">
                      {timing.duration}d
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Slack Analysis */}
      <div>
        <h4 className="text-sm font-medium mb-2">Slack Analysis</h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Zero slack (critical)</span>
            <Badge variant="destructive">{slackDistribution.zeroSlack}</Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>Low slack (1-2 days)</span>
            <Badge variant="secondary">{slackDistribution.lowSlack}</Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>High slack (&gt;2 days)</span>
            <Badge variant="outline">{slackDistribution.highSlack}</Badge>
          </div>
        </div>
      </div>

      {/* Risk Points */}
      {convergingPoints.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <AlertTriangleIcon className="h-4 w-4 text-amber-500" />
            High-Risk Points
          </h4>
          <div className="space-y-2">
            {convergingPoints.map(([taskId, count]) => (
              <div
                key={taskId}
                className="flex items-center justify-between text-sm p-2 rounded bg-amber-50 dark:bg-amber-950"
              >
                <span className="truncate">{taskNames[taskId] || taskId}</span>
                <span className="text-muted-foreground shrink-0">
                  {count} tasks depend on this
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
