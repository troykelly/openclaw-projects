import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Bell } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { ActivityCard } from './activity-card';
import { ActivityFilterBar } from './activity-filter';
import type { ActivityItem, ActivityFilter, TimeGroup } from './types';

function groupByTime(items: ActivityItem[]): TimeGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const thisWeekStart = new Date(today.getTime() - today.getDay() * 86400000);
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const groups: Record<string, ActivityItem[]> = {
    Today: [],
    Yesterday: [],
    'This week': [],
    'This month': [],
    Earlier: [],
  };

  for (const item of items) {
    const itemDate = new Date(item.timestamp);
    const itemDay = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate());

    if (itemDay.getTime() >= today.getTime()) {
      groups['Today'].push(item);
    } else if (itemDay.getTime() >= yesterday.getTime()) {
      groups['Yesterday'].push(item);
    } else if (itemDay.getTime() >= thisWeekStart.getTime()) {
      groups['This week'].push(item);
    } else if (itemDay.getTime() >= thisMonthStart.getTime()) {
      groups['This month'].push(item);
    } else {
      groups['Earlier'].push(item);
    }
  }

  return Object.entries(groups)
    .filter(([_, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function filterItems(items: ActivityItem[], filter: ActivityFilter): ActivityItem[] {
  return items.filter((item) => {
    if (filter.actorType && item.actorType !== filter.actorType) return false;
    if (filter.actionType && item.action !== filter.actionType) return false;
    if (filter.entityType && item.entityType !== filter.entityType) return false;
    if (filter.projectId && item.parentEntityId !== filter.projectId) return false;

    if (filter.timeRange && filter.timeRange !== 'all') {
      const now = new Date();
      const itemDate = new Date(item.timestamp);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      switch (filter.timeRange) {
        case 'today':
          if (itemDate < today) return false;
          break;
        case 'yesterday':
          const yesterday = new Date(today.getTime() - 86400000);
          if (itemDate < yesterday || itemDate >= today) return false;
          break;
        case 'this_week':
          const weekStart = new Date(today.getTime() - today.getDay() * 86400000);
          if (itemDate < weekStart) return false;
          break;
        case 'this_month':
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          if (itemDate < monthStart) return false;
          break;
      }
    }

    return true;
  });
}

export interface ActivityFeedProps {
  items: ActivityItem[];
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onItemClick?: (item: ActivityItem) => void;
  onMarkAllRead?: () => void;
  className?: string;
}

export function ActivityFeed({
  items,
  loading = false,
  hasMore = false,
  onLoadMore,
  onItemClick,
  onMarkAllRead,
  className,
}: ActivityFeedProps) {
  const [filter, setFilter] = useState<ActivityFilter>({});

  const filteredItems = useMemo(() => filterItems(items, filter), [items, filter]);
  const groupedItems = useMemo(() => groupByTime(filteredItems), [filteredItems]);
  const unreadCount = useMemo(
    () => items.filter((item) => !item.read).length,
    [items]
  );

  const handleLoadMore = useCallback(() => {
    if (!loading && hasMore) {
      onLoadMore?.();
    }
  }, [loading, hasMore, onLoadMore]);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <Bell className="size-5" />
          <h2 className="text-lg font-semibold">Activity</h2>
          {unreadCount > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && onMarkAllRead && (
          <Button variant="ghost" size="sm" onClick={onMarkAllRead}>
            Mark all read
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="border-b p-4">
        <ActivityFilterBar filter={filter} onFilterChange={setFilter} />
      </div>

      {/* Feed */}
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-4">
          {groupedItems.map((group) => (
            <div key={group.label}>
              <h3 className="mb-3 text-sm font-medium text-muted-foreground">
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <ActivityCard
                    key={item.id}
                    item={item}
                    onClick={onItemClick}
                  />
                ))}
              </div>
            </div>
          ))}

          {filteredItems.length === 0 && !loading && (
            <div className="py-12 text-center">
              <Bell className="mx-auto size-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground">No activity to show</p>
            </div>
          )}

          {loading && (
            <div className="py-8 text-center text-muted-foreground">
              Loading...
            </div>
          )}

          {hasMore && !loading && (
            <div className="py-4 text-center">
              <Button variant="outline" onClick={handleLoadMore}>
                Load more
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
