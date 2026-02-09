/**
 * Statistics display for activities
 * Issue #396: Implement contact activity timeline
 */
import * as React from 'react';
import { Activity as ActivityIcon, Clock, TrendingUp } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import type { Activity } from './types';
import { calculateStats, getActivityLabel, FILTER_CATEGORIES } from './activity-utils';

export interface ActivityStatsProps {
  activities: Activity[];
  className?: string;
}

export function ActivityStats({ activities, className }: ActivityStatsProps) {
  const stats = React.useMemo(() => calculateStats(activities), [activities]);

  // Get category label for most common type
  const mostCommonLabel = React.useMemo(() => {
    if (!stats.mostCommonType) return null;

    for (const category of FILTER_CATEGORIES) {
      if (category.types.includes(stats.mostCommonType)) {
        return category.label;
      }
    }
    return getActivityLabel(stats.mostCommonType);
  }, [stats.mostCommonType]);

  return (
    <div className={cn('grid grid-cols-3 gap-4', className)}>
      {/* Total interactions */}
      <div className="text-center p-3 rounded-lg bg-muted/50">
        <div className="flex items-center justify-center mb-1">
          <ActivityIcon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="text-2xl font-semibold">{stats.total}</div>
        <div className="text-xs text-muted-foreground">Total Interactions</div>
      </div>

      {/* Most common type */}
      <div className="text-center p-3 rounded-lg bg-muted/50">
        <div className="flex items-center justify-center mb-1">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="text-lg font-semibold truncate">{mostCommonLabel || '-'}</div>
        <div className="text-xs text-muted-foreground">Most Common</div>
      </div>

      {/* Last interaction */}
      <div className="text-center p-3 rounded-lg bg-muted/50">
        <div className="flex items-center justify-center mb-1">
          <Clock className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="text-lg font-semibold truncate">
          {stats.lastInteraction
            ? stats.lastInteraction.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })
            : '-'}
        </div>
        <div className="text-xs text-muted-foreground">Last Interaction</div>
      </div>
    </div>
  );
}
