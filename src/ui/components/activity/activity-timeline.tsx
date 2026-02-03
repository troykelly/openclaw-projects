/**
 * Timeline component for displaying activities
 * Issue #396: Implement contact activity timeline
 */
import * as React from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';
import { ActivityCard } from './activity-card';
import type { Activity, ActivitySourceType } from './types';
import { groupActivitiesByDate } from './activity-utils';

export interface ActivityTimelineProps {
  activities: Activity[];
  onActivityClick?: (activityId: string, sourceType: ActivitySourceType, sourceId: string) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loading?: boolean;
  className?: string;
}

export function ActivityTimeline({
  activities,
  onActivityClick,
  hasMore,
  onLoadMore,
  loading,
  className,
}: ActivityTimelineProps) {
  const groups = React.useMemo(() => groupActivitiesByDate(activities), [activities]);

  if (activities.length === 0 && !loading) {
    return (
      <div className={cn('py-8 text-center text-muted-foreground', className)}>
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No activity yet</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {groups.map((group, groupIndex) => (
        <div key={group.label}>
          {/* Date header */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-medium">{group.label}</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Activities */}
          <div className="relative">
            {group.activities.map((activity, activityIndex) => (
              <div key={activity.id} className="relative">
                {/* Timeline connector */}
                {(activityIndex < group.activities.length - 1 || groupIndex < groups.length - 1) && (
                  <div
                    data-testid="timeline-connector"
                    className="absolute left-4 top-10 bottom-0 w-px bg-border"
                  />
                )}

                <ActivityCard
                  activity={activity}
                  onClick={onActivityClick}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Load more */}
      {hasMore && (
        <div className="text-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load More'}
          </Button>
        </div>
      )}
    </div>
  );
}
