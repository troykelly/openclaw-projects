/**
 * Activity feed page.
 *
 * Displays a chronological feed of recent work item activity, including
 * creates, updates, status changes, and comments. Uses TanStack Query
 * for data fetching with automatic caching and refetch.
 */
import React from 'react';
import { Link } from 'react-router';
import { useActivity } from '@/ui/hooks/queries/use-activity';
import type { ActivityItem } from '@/ui/lib/api-types';
import {
  Skeleton,
  SkeletonList,
  ErrorState,
  EmptyState,
} from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent } from '@/ui/components/ui/card';
import { ScrollArea } from '@/ui/components/ui/scroll-area';

/** Map an API activity item to a display-ready format. */
function mapActivityItem(item: ActivityItem) {
  return {
    id: item.id,
    actorType: item.actor_email?.includes('agent')
      ? ('agent' as const)
      : ('human' as const),
    actorName: item.actor_email || 'System',
    action: (item.type === 'status_change' ? 'status_changed' : item.type) as string,
    entityId: item.work_item_id,
    entityTitle: item.work_item_title,
    detail: item.description,
    timestamp: new Date(item.created_at),
  };
}

/** Render action verb for display. */
function actionLabel(action: string): string {
  switch (action) {
    case 'created':
      return 'created';
    case 'updated':
      return 'updated';
    case 'status_changed':
      return 'changed status of';
    case 'commented':
      return 'commented on';
    case 'assigned':
      return 'assigned';
    default:
      return action;
  }
}

export function ActivityPage(): React.JSX.Element {
  const { data, isLoading, error, refetch } = useActivity(50);

  if (isLoading) {
    return (
      <div data-testid="page-activity" className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton width={200} height={32} />
        </div>
        <SkeletonList count={5} variant="row" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="page-activity" className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load activity"
          description={error instanceof Error ? error.message : 'Unknown error'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div data-testid="page-activity" className="p-6">
        <h1 className="text-2xl font-semibold text-foreground mb-4">Activity Feed</h1>
        <Card>
          <CardContent className="p-8">
            <EmptyState
              variant="no-data"
              title="No activity yet"
              description="Activity will appear here when work items are created or updated."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const activityItems = items.map(mapActivityItem);

  return (
    <div data-testid="page-activity" className="p-6 h-full flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Activity Feed</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Recent updates across all work items
        </p>
      </div>

      <Card className="flex-1">
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-200px)]">
            <div className="divide-y">
              {activityItems.map((item) => (
                <div
                  key={item.id}
                  className="p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`size-8 rounded-full flex items-center justify-center shrink-0 ${
                        item.actorType === 'agent'
                          ? 'bg-violet-500/10 text-violet-500'
                          : 'bg-primary/10 text-primary'
                      }`}
                    >
                      <span className="text-xs font-medium">
                        {item.actorName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-foreground">
                          {item.actorName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {actionLabel(item.action)}
                        </span>
                      </div>
                      <Link
                        to={`/work-items/${item.entityId}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {item.entityTitle}
                      </Link>
                      {item.detail && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {item.detail}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        {item.timestamp.toLocaleDateString()} at{' '}
                        {item.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
