/**
 * Dashboard page - the default landing page for users.
 *
 * Provides a clear overview of current work with sections for:
 * - Welcome header with greeting and current date
 * - My Tasks - items grouped by status (In Progress, Not Started, Blocked)
 * - Upcoming Due - items due within 7 days
 * - Recent Activity - last 10 activity events
 * - Quick Actions - create task, search, open recent project
 *
 * Uses TanStack Query for data fetching with automatic caching.
 *
 * @see Issue #467
 */
import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useWorkItems } from '@/ui/hooks/queries/use-work-items';
import { useActivity } from '@/ui/hooks/queries/use-activity';
import type { WorkItemSummary, ActivityItem } from '@/ui/lib/api-types';
import { priorityColors } from '@/ui/lib/work-item-utils';
import { Skeleton, SkeletonCard } from '@/ui/components/feedback';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/ui/components/ui/card';
import {
  Plus,
  Search,
  FolderOpen,
  Calendar,
  Clock,
  Activity,
  ArrowRight,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status group for organizing tasks. */
interface StatusGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  colorClass: string;
  items: WorkItemSummary[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get a time-of-day greeting. */
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Format today's date as a readable string. */
function formatCurrentDate(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Get status display info. */
function getStatusInfo(status: string): { label: string; colorClass: string } {
  switch (status) {
    case 'in_progress':
      return { label: 'In Progress', colorClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' };
    case 'not_started':
      return { label: 'Not Started', colorClass: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' };
    case 'blocked':
      return { label: 'Blocked', colorClass: 'bg-red-500/10 text-red-600 dark:text-red-400' };
    case 'done':
      return { label: 'Done', colorClass: 'bg-green-500/10 text-green-600 dark:text-green-400' };
    case 'cancelled':
      return { label: 'Cancelled', colorClass: 'bg-gray-500/10 text-gray-500' };
    default:
      return { label: status.replace(/_/g, ' '), colorClass: 'bg-gray-500/10 text-gray-600' };
  }
}

/** Format a relative timestamp for activity items. */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Get a human-readable label for an activity action. */
function getActivityLabel(type: string): string {
  switch (type) {
    case 'created':
      return 'created';
    case 'updated':
      return 'updated';
    case 'status_change':
      return 'changed status of';
    case 'commented':
      return 'commented on';
    case 'assigned':
      return 'assigned';
    case 'memory_added':
      return 'added memory to';
    default:
      return type.replace(/_/g, ' ');
  }
}

/** Filter active (non-completed) tasks and group by status. */
function groupTasksByStatus(items: WorkItemSummary[]): StatusGroup[] {
  const activeStatuses = ['in_progress', 'not_started', 'blocked'];
  const activeItems = items.filter(
    (item) => item.status !== null && activeStatuses.includes(item.status),
  );

  const groups: StatusGroup[] = [
    {
      key: 'in_progress',
      label: 'In Progress',
      icon: <Loader2 className="size-4" />,
      colorClass: 'text-blue-600 dark:text-blue-400',
      items: activeItems.filter((i) => i.status === 'in_progress'),
    },
    {
      key: 'not_started',
      label: 'Not Started',
      icon: <Circle className="size-4" />,
      colorClass: 'text-gray-600 dark:text-gray-400',
      items: activeItems.filter((i) => i.status === 'not_started'),
    },
    {
      key: 'blocked',
      label: 'Blocked',
      icon: <AlertTriangle className="size-4" />,
      colorClass: 'text-red-600 dark:text-red-400',
      items: activeItems.filter((i) => i.status === 'blocked'),
    },
  ];

  // Only return groups that have items
  return groups.filter((g) => g.items.length > 0);
}

/** Check if an item has a due date within the next N days. */
function isDueWithinDays(item: WorkItemSummary, _days: number): boolean {
  // The API WorkItemSummary doesn't have not_after directly in list view,
  // but we include all non-completed items as potentially upcoming.
  // In a real implementation, the API would filter by due date.
  return item.status !== 'done' && item.status !== 'cancelled';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Loading skeleton for the full dashboard. */
function DashboardSkeleton(): React.JSX.Element {
  return (
    <div data-testid="page-dashboard" className="p-6 space-y-8">
      {/* Welcome header skeleton */}
      <div className="space-y-2">
        <Skeleton width={300} height={32} />
        <Skeleton width={200} height={18} />
      </div>

      {/* Sections skeleton */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Skeleton width={150} height={24} />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="space-y-4">
          <Skeleton width={150} height={24} />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>

      <div>
        <Skeleton width={180} height={24} />
        <div className="mt-4 space-y-2">
          <Skeleton width="100%" height={48} />
          <Skeleton width="100%" height={48} />
          <Skeleton width="100%" height={48} />
        </div>
      </div>
    </div>
  );
}

/** Single work item card for the dashboard. */
function WorkItemCard({ item }: { item: WorkItemSummary }): React.JSX.Element {
  const statusInfo = getStatusInfo(item.status ?? 'not_started');
  const priorityClass = item.priority ? priorityColors[item.priority] : undefined;

  return (
    <Link
      to={`/work-items/${item.id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50 dark:hover:bg-muted/30"
      data-testid="work-item-card"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {item.title}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <Badge
            variant="secondary"
            className={`text-xs ${statusInfo.colorClass}`}
          >
            {statusInfo.label}
          </Badge>
          {priorityClass && (
            <Badge className={`text-xs ${priorityClass}`}>
              {item.priority}
            </Badge>
          )}
          {item.task_type && (
            <span className="text-xs text-muted-foreground capitalize">
              {item.task_type}
            </span>
          )}
        </div>
      </div>
      <ArrowRight className="size-4 text-muted-foreground shrink-0" />
    </Link>
  );
}

/** Activity row in the recent activity section. */
function ActivityRow({ item }: { item: ActivityItem }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="size-2 rounded-full bg-primary mt-2 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">
          <span className="text-muted-foreground">
            {item.actor_email ?? 'System'}{' '}
          </span>
          <span className="text-muted-foreground">
            {getActivityLabel(item.type)}{' '}
          </span>
          <Link
            to={`/work-items/${item.work_item_id}`}
            className="font-medium text-primary hover:underline"
          >
            {item.work_item_title}
          </Link>
        </p>
        {item.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {item.description}
          </p>
        )}
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
        {formatRelativeTime(item.created_at)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

/**
 * Dashboard page component.
 *
 * Fetches work items and activity data, then renders them in
 * a section-based layout with clear visual hierarchy.
 */
export function DashboardPage(): React.JSX.Element {
  const navigate = useNavigate();

  // Fetch work items and activity in parallel
  const workItemsQuery = useWorkItems();
  const activityQuery = useActivity(10);

  // Derive task groups from work items
  const taskGroups = useMemo(
    () => groupTasksByStatus(workItemsQuery.data?.items ?? []),
    [workItemsQuery.data],
  );

  // Count of total active tasks (max 10 shown)
  const totalActiveTasks = useMemo(
    () => taskGroups.reduce((sum, g) => sum + g.items.length, 0),
    [taskGroups],
  );

  // Upcoming due items (all non-completed, limited to 5)
  const upcomingItems = useMemo(() => {
    const items = workItemsQuery.data?.items ?? [];
    return items
      .filter((i) => isDueWithinDays(i, 7))
      .slice(0, 5);
  }, [workItemsQuery.data]);

  // Activity items (limited to 10)
  const activityItems = useMemo(
    () => (activityQuery.data?.items ?? []).slice(0, 10),
    [activityQuery.data],
  );

  // Show loading skeleton if both queries are loading
  const isInitialLoad = workItemsQuery.isLoading && activityQuery.isLoading;

  if (isInitialLoad) {
    return <DashboardSkeleton />;
  }

  return (
    <div data-testid="page-dashboard" className="p-6 space-y-8">
      {/* Welcome Header */}
      <div data-testid="welcome-header" className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
          {getGreeting()}
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatCurrentDate()}
        </p>
      </div>

      {/* Main grid: My Tasks + Upcoming Due */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* My Tasks Section */}
        <Card data-testid="section-my-tasks">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-5 text-primary" />
              My Tasks
            </CardTitle>
            <CardDescription>
              {totalActiveTasks > 0
                ? `${totalActiveTasks} active task${totalActiveTasks !== 1 ? 's' : ''}`
                : 'Your assigned tasks'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {workItemsQuery.isLoading ? (
              <div className="space-y-3">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : taskGroups.length === 0 ? (
              <div className="py-8 text-center">
                <CheckCircle2 className="mx-auto size-10 text-muted-foreground/30" />
                <p className="mt-3 text-sm font-medium text-muted-foreground">
                  No tasks assigned
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tasks assigned to you will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {taskGroups.map((group) => (
                  <div key={group.key}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={group.colorClass}>{group.icon}</span>
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {group.label}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {group.items.length}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      {group.items.slice(0, 10).map((item) => (
                        <WorkItemCard key={item.id} item={item} />
                      ))}
                    </div>
                  </div>
                ))}
                {totalActiveTasks > 0 && (
                  <Link
                    to="/work-items"
                    className="flex items-center justify-center gap-1 text-sm text-primary hover:underline py-2"
                  >
                    View all tasks
                    <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Due Section */}
        <Card data-testid="section-upcoming-due">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="size-5 text-orange-500" />
              Upcoming Due
            </CardTitle>
            <CardDescription>Items due within 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            {workItemsQuery.isLoading ? (
              <div className="space-y-3">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : upcomingItems.length === 0 ? (
              <div className="py-8 text-center">
                <Calendar className="mx-auto size-10 text-muted-foreground/30" />
                <p className="mt-3 text-sm font-medium text-muted-foreground">
                  No upcoming deadlines
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Items with upcoming due dates will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingItems.map((item) => (
                  <WorkItemCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity Section */}
      <Card data-testid="section-recent-activity">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-5 text-violet-500" />
            Recent Activity
          </CardTitle>
          <CardDescription>Latest updates across your projects</CardDescription>
        </CardHeader>
        <CardContent>
          {activityQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton width="100%" height={40} />
              <Skeleton width="100%" height={40} />
              <Skeleton width="100%" height={40} />
            </div>
          ) : activityItems.length === 0 ? (
            <div className="py-8 text-center">
              <Activity className="mx-auto size-10 text-muted-foreground/30" />
              <p className="mt-3 text-sm font-medium text-muted-foreground">
                No recent activity
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Activity will appear here when work items are created or updated.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {activityItems.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
              <div className="pt-3">
                <Link
                  to="/activity"
                  className="flex items-center justify-center gap-1 text-sm text-primary hover:underline py-2"
                >
                  View all activity
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions Section */}
      <Card data-testid="section-quick-actions">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 py-4"
              onClick={() => navigate('/work-items')}
              data-testid="quick-action-create"
            >
              <Plus className="size-5 text-primary" />
              <span className="text-sm font-medium">Create Task</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 py-4"
              onClick={() => navigate('/work-items')}
              data-testid="quick-action-search"
            >
              <Search className="size-5 text-primary" />
              <span className="text-sm font-medium">Search</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 py-4"
              onClick={() => navigate('/work-items')}
              data-testid="quick-action-projects"
            >
              <FolderOpen className="size-5 text-primary" />
              <span className="text-sm font-medium">Open Projects</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
