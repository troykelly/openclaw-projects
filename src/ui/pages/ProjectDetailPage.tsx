/**
 * Project detail page with view switcher tabs.
 *
 * Displays a project header (title, description, metadata) with tabbed
 * sub-views: List, Board, Tree, and Calendar. Fetches the project
 * work item by ID, fetches its children for the sub-views, and supports
 * inline title editing with optimistic updates.
 *
 * @see Issue #468
 */

import { useQueryClient } from '@tanstack/react-query';
import { Brain, Calendar, ChevronRight, Clock, FolderKanban, GitBranch, LayoutGrid, List } from 'lucide-react';
import React, { useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorState, Skeleton, SkeletonTable } from '@/ui/components/feedback';
import { InlineEditableText } from '@/ui/components/inline-edit';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent } from '@/ui/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs';
import { useUpdateWorkItem } from '@/ui/hooks/mutations/use-update-work-item';
import { useProjectMemories } from '@/ui/hooks/queries/use-memories';
import { useWorkItem, useWorkItemTree } from '@/ui/hooks/queries/use-work-items';
import type { Memory, WorkItemTreeNode } from '@/ui/lib/api-types';
import { mapApiTreeToTreeItems, priorityColors } from '@/ui/lib/work-item-utils';
import { BoardView } from './project-views/BoardView';
import { CalendarView } from './project-views/CalendarView';
import { ListView } from './project-views/ListView';
import { TreeView } from './project-views/TreeView';

/** Format a relative time string from a Date. */
function formatRelativeTime(date: Date): string {
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

/** Format a date as a short human-readable string. */
function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Recursively collect all descendant tree nodes as a flat array.
 * Used for feeding the list/board/calendar sub-views with project children.
 */
function flattenTreeNode(node: WorkItemTreeNode): WorkItemTreeNode[] {
  const result: WorkItemTreeNode[] = [];
  for (const child of node.children) {
    result.push(child);
    if (child.children.length > 0) {
      result.push(...flattenTreeNode(child));
    }
  }
  return result;
}

/** Map status string from API to display label. */
const statusLabels: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  closed: 'Done',
  done: 'Done',
  not_started: 'Not Started',
  cancelled: 'Cancelled',
};

/** Status color classes. */
const statusColors: Record<string, string> = {
  open: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  in_progress: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  blocked: 'bg-red-500/10 text-red-600 dark:text-red-400',
  closed: 'bg-green-500/10 text-green-600 dark:text-green-400',
  done: 'bg-green-500/10 text-green-600 dark:text-green-400',
  not_started: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  cancelled: 'bg-gray-500/10 text-gray-500',
};

export function ProjectDetailPage(): React.JSX.Element {
  const { project_id, view } = useParams<{ project_id: string; view?: string }>();
  const item_id = project_id ?? '';
  const _queryClient = useQueryClient();

  // Determine the initial view from URL param
  const initialView = view ?? 'list';

  // Data fetching
  const { data: projectData, isLoading, error: projectError, refetch } = useWorkItem(item_id);
  const { data: treeData, isLoading: treeLoading } = useWorkItemTree();
  const updateMutation = useUpdateWorkItem();

  // Find project node in tree to get children
  const projectNode = React.useMemo(() => {
    if (!treeData) return null;
    const findNode = (nodes: WorkItemTreeNode[]): WorkItemTreeNode | null => {
      for (const node of nodes) {
        if (node.id === item_id) return node;
        const found = findNode(node.children);
        if (found) return found;
      }
      return null;
    };
    return findNode(treeData.items);
  }, [treeData, item_id]);

  // Flatten children for sub-views
  const projectChildren = React.useMemo(() => {
    if (!projectNode) return [];
    return flattenTreeNode(projectNode);
  }, [projectNode]);

  // Convert tree children to BacklogItem-like shape for board/list views
  const childrenAsItems = React.useMemo(
    () =>
      projectChildren.map((child) => ({
        id: child.id,
        title: child.title,
        description: null as string | null,
        status: child.status,
        priority: child.priority,
        task_type: null as string | null,
        kind: child.kind,
        estimate_minutes: null as number | null,
        created_at: '',
        not_before: null as string | null,
        not_after: null as string | null,
        children_count: child.children_count,
      })),
    [projectChildren],
  );

  // Map tree items for the tree view
  const treeItems = React.useMemo(() => {
    if (!projectNode) return [];
    return mapApiTreeToTreeItems(projectNode.children);
  }, [projectNode]);

  // Status counts for the progress bar
  const statusCounts = React.useMemo(() => {
    const counts = { done: 0, in_progress: 0, blocked: 0, open: 0, total: 0 };
    for (const item of projectChildren) {
      counts.total++;
      if (item.status === 'closed' || item.status === 'done') counts.done++;
      else if (item.status === 'in_progress') counts.in_progress++;
      else if (item.status === 'blocked') counts.blocked++;
      else counts.open++;
    }
    return counts;
  }, [projectChildren]);

  // Handlers
  const handleTitleChange = useCallback(
    async (title: string) => {
      updateMutation.mutate({ id: item_id, body: { title } });
    },
    [item_id, updateMutation],
  );

  // No-op: Radix Tabs handles tab switching internally with defaultValue
  // URL is updated for bookmarking via the route, but switching is internal

  // --- LOADING STATE ---
  if (isLoading) {
    return (
      <div data-testid="page-project-detail" className="flex flex-col h-full">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton width={32} height={32} />
            <Skeleton width={300} height={28} />
          </div>
          <Skeleton width="60%" height={16} />
          <div className="flex gap-2">
            <Skeleton width={80} height={24} />
            <Skeleton width={80} height={24} />
            <Skeleton width={80} height={24} />
          </div>
          <SkeletonTable rows={5} columns={5} />
        </div>
      </div>
    );
  }

  // --- ERROR STATE ---
  if (projectError || !projectData) {
    return (
      <div data-testid="page-project-detail" className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load project"
          description={projectError instanceof Error ? projectError.message : 'The requested project could not be loaded.'}
          onRetry={() => refetch()}
          action={
            <Button variant="outline" asChild>
              <Link to="/work-items">Back to Work Items</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const project = projectData;
  const progressPercent = statusCounts.total > 0 ? Math.round((statusCounts.done / statusCounts.total) * 100) : 0;

  return (
    <div data-testid="page-project-detail" className="flex flex-col h-full">
      {/* Navigation bar */}
      <div className="px-4 py-3 border-b border-border bg-background flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/work-items">
            <ChevronRight className="mr-1 size-4 rotate-180" />
            Back
          </Link>
        </Button>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3" />
          Updated {formatRelativeTime(new Date(project.updated_at))}
          {updateMutation.isPending && (
            <Badge variant="outline" className="text-xs animate-pulse ml-2">
              Saving...
            </Badge>
          )}
        </div>
      </div>

      {/* Project header */}
      <div className="px-6 pt-5 pb-4 border-b border-border bg-gradient-to-b from-muted/30 to-background">
        {/* Title row */}
        <div className="flex items-start gap-3 mb-3">
          <div className="mt-1 size-8 rounded-md bg-blue-500/10 flex items-center justify-center shrink-0">
            <FolderKanban className="size-4 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <InlineEditableText
              value={project.title}
              onSave={handleTitleChange}
              selectOnFocus
              className="text-xl font-bold text-foreground leading-snug"
              validate={(v) => v.trim().length > 0}
            />
            {project.description && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{project.description}</p>}
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Badge variant="outline" className="text-xs capitalize">
            {project.kind}
          </Badge>
          <Badge variant="secondary" className={`text-xs ${statusColors[project.status] ?? ''}`}>
            {statusLabels[project.status] ?? project.status}
          </Badge>
          {project.priority && <Badge className={`text-xs ${priorityColors[project.priority] ?? ''}`}>{project.priority}</Badge>}
          {project.not_before && <span className="text-xs text-muted-foreground">Start: {formatDate(project.not_before)}</span>}
          {project.not_after && <span className="text-xs text-muted-foreground">Due: {formatDate(project.not_after)}</span>}
        </div>

        {/* Progress bar */}
        {statusCounts.total > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {statusCounts.done} of {statusCounts.total} items done
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden flex" data-testid="progress-bar">
              {statusCounts.done > 0 && (
                <div
                  className="bg-green-500 transition-all"
                  style={{
                    width: `${(statusCounts.done / statusCounts.total) * 100}%`,
                  }}
                />
              )}
              {statusCounts.in_progress > 0 && (
                <div
                  className="bg-yellow-500 transition-all"
                  style={{
                    width: `${(statusCounts.in_progress / statusCounts.total) * 100}%`,
                  }}
                />
              )}
              {statusCounts.blocked > 0 && (
                <div
                  className="bg-red-500 transition-all"
                  style={{
                    width: `${(statusCounts.blocked / statusCounts.total) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* View switcher tabs */}
      <div className="flex-1 overflow-auto">
        <Tabs defaultValue={initialView} className="h-full">
          <div className="px-6 pt-3 border-b border-border bg-background">
            <TabsList variant="line" className="w-full justify-start">
              <TabsTrigger value="list" className="gap-1.5">
                <List className="size-3.5" />
                List
              </TabsTrigger>
              <TabsTrigger value="board" className="gap-1.5">
                <LayoutGrid className="size-3.5" />
                Board
              </TabsTrigger>
              <TabsTrigger value="tree" className="gap-1.5">
                <GitBranch className="size-3.5" />
                Tree
              </TabsTrigger>
              <TabsTrigger value="calendar" className="gap-1.5">
                <Calendar className="size-3.5" />
                Calendar
              </TabsTrigger>
              <TabsTrigger value="memories" className="gap-1.5">
                <Brain className="size-3.5" />
                Memories
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="list" data-testid="view-list" className="px-6 py-4">
            <ListView items={childrenAsItems} isLoading={treeLoading} project_id={item_id} />
          </TabsContent>

          <TabsContent value="board" data-testid="view-board" className="px-6 py-4">
            <BoardView items={childrenAsItems} isLoading={treeLoading} />
          </TabsContent>

          <TabsContent value="tree" data-testid="view-tree" className="px-6 py-4">
            <TreeView items={treeItems} isLoading={treeLoading} project_id={item_id} />
          </TabsContent>

          <TabsContent value="calendar" data-testid="view-calendar" className="px-6 py-4">
            <CalendarView items={childrenAsItems} isLoading={treeLoading} />
          </TabsContent>

          <TabsContent value="memories" data-testid="view-memories" className="px-6 py-4">
            <ProjectMemoriesView project_id={item_id} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectMemoriesView - inline component for the Memories tab
// ---------------------------------------------------------------------------

function ProjectMemoriesView({ project_id }: { project_id: string }): React.JSX.Element {
  const { data, isLoading, isError } = useProjectMemories(project_id);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} width="100%" height={72} />
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-destructive">Failed to load project memories.</p>;
  }

  const memories = data?.memories ?? [];

  if (memories.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Brain className="mx-auto size-8 mb-2 opacity-40" />
        <p className="text-sm">No memories scoped to this project yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {memories.map((memory: Memory) => (
        <Card key={memory.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {memory.type && (
                  <Badge variant="outline" className="text-xs mb-1 capitalize">
                    {memory.type}
                  </Badge>
                )}
                <h4 className="font-medium text-sm text-foreground">{memory.title}</h4>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{memory.content}</p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {new Date(memory.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
