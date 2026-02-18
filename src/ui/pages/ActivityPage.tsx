/**
 * Activity feed page.
 *
 * Full-width timeline feed at /activity with type filters, day grouping,
 * distinctive type icons, and responsive layout. Uses TanStack Query
 * for data fetching with automatic caching and refetch.
 *
 * @see Issue #470
 */
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router';
import { useActivity } from '@/ui/hooks/queries/use-activity';
import type { ActivityItem } from '@/ui/lib/api-types';
import { Skeleton, SkeletonList, ErrorState, EmptyState } from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent } from '@/ui/components/ui/card';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Plus, ArrowUpCircle, MessageSquare, UserPlus, Brain, Mail, Bot, Settings, Activity, Filter, RefreshCw } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Activity type filter options. */
type ActivityFilter = 'all' | 'work_items' | 'communications' | 'agent' | 'system';

/** Mapped display-ready activity item. */
interface DisplayActivityItem {
  id: string;
  actor_type: 'agent' | 'human' | 'system';
  actorName: string;
  action: string;
  actionLabel: string;
  entity_id: string;
  entityTitle: string;
  detail: string;
  timestamp: Date;
  type: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map an API activity item to a display-ready format. */
function mapActivityItem(item: ActivityItem): DisplayActivityItem {
  const actor_type = !item.actor_email
    ? ('system' as const)
    : item.actor_email.includes('agent') || item.actor_email.includes('openclaw')
      ? ('agent' as const)
      : ('human' as const);

  const action = item.type === 'status_change' ? 'status_changed' : item.type;

  return {
    id: item.id,
    actor_type,
    actorName: item.actor_email || 'System',
    action,
    actionLabel: getActionLabel(action),
    entity_id: item.work_item_id,
    entityTitle: item.work_item_title,
    detail: item.description,
    timestamp: new Date(item.created_at),
    type: item.type,
  };
}

/** Get a human-readable label for an action type. */
function getActionLabel(action: string): string {
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
    case 'memory_added':
      return 'added memory to';
    case 'communication_linked':
      return 'linked communication to';
    default:
      return action.replace(/_/g, ' ');
  }
}

/** Get an icon component for an activity type. */
function getActivityIcon(type: string, actor_type: string): React.ReactNode {
  if (actor_type === 'agent') {
    return <Bot className="size-4" />;
  }

  switch (type) {
    case 'created':
      return <Plus className="size-4" />;
    case 'updated':
    case 'status_change':
    case 'status_changed':
      return <ArrowUpCircle className="size-4" />;
    case 'commented':
      return <MessageSquare className="size-4" />;
    case 'assigned':
      return <UserPlus className="size-4" />;
    case 'memory_added':
      return <Brain className="size-4" />;
    case 'communication_linked':
      return <Mail className="size-4" />;
    default:
      return <Activity className="size-4" />;
  }
}

/** Get the background color class for an activity icon. */
function getIconColor(type: string, actor_type: string): string {
  if (actor_type === 'agent') {
    return 'bg-violet-500/10 text-violet-500 dark:bg-violet-500/20';
  }
  if (actor_type === 'system') {
    return 'bg-gray-500/10 text-gray-500 dark:bg-gray-500/20';
  }

  switch (type) {
    case 'created':
      return 'bg-green-500/10 text-green-500 dark:bg-green-500/20';
    case 'updated':
    case 'status_change':
    case 'status_changed':
      return 'bg-blue-500/10 text-blue-500 dark:bg-blue-500/20';
    case 'commented':
      return 'bg-amber-500/10 text-amber-500 dark:bg-amber-500/20';
    case 'assigned':
      return 'bg-indigo-500/10 text-indigo-500 dark:bg-indigo-500/20';
    case 'memory_added':
      return 'bg-purple-500/10 text-purple-500 dark:bg-purple-500/20';
    case 'communication_linked':
      return 'bg-teal-500/10 text-teal-500 dark:bg-teal-500/20';
    default:
      return 'bg-primary/10 text-primary dark:bg-primary/20';
  }
}

/** Format a date for the day separator. */
function formatDayLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (itemDay.getTime() === today.getTime()) return 'Today';
  if (itemDay.getTime() === yesterday.getTime()) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** Format a relative or absolute time. */
function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Get a day key for grouping (YYYY-MM-DD). */
function getDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Filter buttons configuration. */
const FILTER_OPTIONS: Array<{ value: ActivityFilter; label: string; icon: React.ReactNode }> = [
  { value: 'all', label: 'All', icon: <Activity className="size-3.5" /> },
  { value: 'work_items', label: 'Work Items', icon: <ArrowUpCircle className="size-3.5" /> },
  { value: 'communications', label: 'Comms', icon: <Mail className="size-3.5" /> },
  { value: 'agent', label: 'Agent', icon: <Bot className="size-3.5" /> },
  { value: 'system', label: 'System', icon: <Settings className="size-3.5" /> },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityPage(): React.JSX.Element {
  const { data, isLoading, error, refetch } = useActivity(100);
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>('all');

  // Map and filter items
  const allItems = useMemo(() => (data?.items ?? []).map(mapActivityItem), [data]);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return allItems;

    return allItems.filter((item) => {
      switch (activeFilter) {
        case 'work_items':
          return ['created', 'updated', 'status_changed', 'assigned'].includes(item.action);
        case 'communications':
          return ['commented', 'communication_linked'].includes(item.action);
        case 'agent':
          return item.actor_type === 'agent';
        case 'system':
          return item.actor_type === 'system';
        default:
          return true;
      }
    });
  }, [allItems, activeFilter]);

  // Group items by day
  const groupedItems = useMemo(() => {
    const groups: Map<string, { label: string; items: DisplayActivityItem[] }> = new Map();

    for (const item of filteredItems) {
      const key = getDayKey(item.timestamp);
      if (!groups.has(key)) {
        groups.set(key, { label: formatDayLabel(item.timestamp), items: [] });
      }
      groups.get(key)!.items.push(item);
    }

    return Array.from(groups.entries()).map(([key, group]) => ({
      key,
      label: group.label,
      items: group.items,
    }));
  }, [filteredItems]);

  // --- LOADING STATE ---
  if (isLoading) {
    return (
      <div data-testid="page-activity" className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton width={200} height={32} />
        </div>
        <div className="mb-4 flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} width={80} height={32} />
          ))}
        </div>
        <SkeletonList count={8} variant="row" />
      </div>
    );
  }

  // --- ERROR STATE ---
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

  // --- EMPTY STATE ---
  if (items.length === 0) {
    return (
      <div data-testid="page-activity" className="p-6">
        <h1 className="text-2xl font-semibold text-foreground mb-4">Activity Feed</h1>
        <Card>
          <CardContent className="p-8">
            <EmptyState variant="no-data" title="No activity yet" description="Activity will appear here when work items are created or updated." />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="page-activity" className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Activity Feed</h1>
          <p className="text-sm text-muted-foreground mt-1">Recent updates across all work items</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Filter className="size-4 text-muted-foreground" />
        {FILTER_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={activeFilter === opt.value ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={() => setActiveFilter(opt.value)}
          >
            {opt.icon}
            {opt.label}
          </Button>
        ))}
        {activeFilter !== 'all' && (
          <Badge variant="secondary" className="text-xs">
            {filteredItems.length} of {allItems.length}
          </Badge>
        )}
      </div>

      {/* Timeline feed */}
      <Card className="flex-1">
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-280px)]">
            {filteredItems.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Filter className="size-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No activities match the selected filter</p>
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => setActiveFilter('all')}>
                  Show all activities
                </Button>
              </div>
            ) : (
              <div>
                {groupedItems.map((group) => (
                  <div key={group.key}>
                    {/* Day separator */}
                    <div data-testid="date-separator" className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm border-b border-border px-4 py-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{group.label}</span>
                      <Badge variant="outline" className="ml-2 text-xs">
                        {group.items.length}
                      </Badge>
                    </div>

                    {/* Activity rows */}
                    {group.items.map((item) => (
                      <div key={item.id} className="px-4 py-3 hover:bg-muted/50 dark:hover:bg-muted/30 transition-colors border-b border-border last:border-0">
                        <div className="flex items-start gap-3">
                          {/* Type icon */}
                          <div
                            data-testid="activity-type-icon"
                            className={`size-8 rounded-full flex items-center justify-center shrink-0 ${getIconColor(item.type, item.actor_type)}`}
                          >
                            {getActivityIcon(item.type, item.actor_type)}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-foreground">{item.actorName}</span>
                              <span className="text-xs text-muted-foreground">{item.actionLabel}</span>
                              <Link
                                to={`/work-items/${item.entity_id}`}
                                className="text-sm font-medium text-primary hover:underline truncate max-w-[200px] sm:max-w-none"
                              >
                                {item.entityTitle}
                              </Link>
                            </div>
                            {item.detail && <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{item.detail}</p>}
                          </div>

                          {/* Timestamp */}
                          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{formatTimestamp(item.timestamp)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
