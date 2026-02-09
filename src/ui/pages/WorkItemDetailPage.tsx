/**
 * Work item detail page.
 *
 * Displays full details for a single work item with a tabbed content layout.
 * Sections include Description, Checklist, Dependencies, Activity, Memory,
 * and Communications. All metadata saves immediately via optimistic updates
 * through TanStack Query mutations.
 *
 * @see Issue #469
 */
import React, { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { useWorkItem, workItemKeys } from '@/ui/hooks/queries/use-work-items';
import { useWorkItemMemories, memoryKeys } from '@/ui/hooks/queries/use-memories';
import { useWorkItemCommunications, communicationsKeys } from '@/ui/hooks/queries/use-communications';
import { useActivity } from '@/ui/hooks/queries/use-activity';
import { useUpdateWorkItem } from '@/ui/hooks/mutations/use-update-work-item';
import { useCreateMemory } from '@/ui/hooks/mutations/use-create-memory';
import { useUpdateMemory } from '@/ui/hooks/mutations/use-update-memory';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client';
import type { AppBootstrap } from '@/ui/lib/api-types';
import { mapApiPriority, mapPriorityToApi, readBootstrap } from '@/ui/lib/work-item-utils';
import { SkeletonCard, SkeletonList, ErrorState, Skeleton } from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/components/ui/tabs';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { ItemHeader } from '@/ui/components/detail/item-header';
import { MetadataGrid } from '@/ui/components/detail/metadata-grid';
import { DescriptionEditor } from '@/ui/components/detail/description-editor';
import { TodoList } from '@/ui/components/detail/todo-list';
import { DependenciesSection } from '@/ui/components/detail/dependencies-section';
import type { WorkItemDetail as DetailComponentType, WorkItemStatus, WorkItemPriority, WorkItemKind, WorkItemDependency } from '@/ui/components/detail/types';
import { ItemMemories } from '@/ui/components/memory/item-memories';
import { MemoryEditor } from '@/ui/components/memory/memory-editor';
import type { MemoryItem, MemoryFormData } from '@/ui/components/memory/types';
import { ItemCommunications } from '@/ui/components/communications/item-communications';
import type { LinkedEmail, LinkedCalendarEvent } from '@/ui/components/communications/types';
import { DeleteConfirmDialog, UndoToast, useWorkItemDelete } from '@/ui/components/work-item-delete';
import { ChevronRight, Calendar, Network, FileText, CheckSquare, GitBranch, Activity, Brain, Mail, Users, Clock } from 'lucide-react';

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

export function WorkItemDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const itemId = id ?? '';
  const queryClient = useQueryClient();
  const bootstrap = readBootstrap<AppBootstrap>();
  const participants = bootstrap?.participants ?? [];

  // Data queries
  const { data: apiDetail, isLoading, error: itemError } = useWorkItem(itemId);
  const { data: memoriesData, isLoading: memoriesLoading } = useWorkItemMemories(itemId);
  const { data: commsData, isLoading: communicationsLoading } = useWorkItemCommunications(itemId);
  const { data: activityData, isLoading: activityLoading } = useActivity(50);

  // Mutations
  const updateMutation = useUpdateWorkItem();
  const createMemoryMutation = useCreateMemory();
  const updateMemoryMutation = useUpdateMemory();

  // Memory editor state
  const [memoryEditorOpen, setMemoryEditorOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryItem | null>(null);

  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const {
    deleteItem: performDelete,
    isDeleting,
    undoState,
    dismissUndo,
  } = useWorkItemDelete({
    onDeleted: () => {
      window.location.href = '/app/work-items';
    },
  });

  // Map API detail to component format
  const workItem: DetailComponentType | null = apiDetail
    ? (() => {
        const deps: WorkItemDependency[] = [];
        if (apiDetail.dependencies?.blocks) {
          deps.push(
            ...apiDetail.dependencies.blocks.map((d) => ({
              id: d.id,
              title: d.title,
              kind: 'issue' as WorkItemKind,
              status: 'not_started' as WorkItemStatus,
              direction: 'blocks' as const,
            })),
          );
        }
        if (apiDetail.dependencies?.blocked_by) {
          deps.push(
            ...apiDetail.dependencies.blocked_by.map((d) => ({
              id: d.id,
              title: d.title,
              kind: 'issue' as WorkItemKind,
              status: 'not_started' as WorkItemStatus,
              direction: 'blocked_by' as const,
            })),
          );
        }
        return {
          id: apiDetail.id,
          title: apiDetail.title,
          kind: (apiDetail.kind as WorkItemKind) || 'issue',
          status: (apiDetail.status as WorkItemStatus) || 'not_started',
          priority: mapApiPriority(apiDetail.priority),
          description: apiDetail.description || undefined,
          parentId: apiDetail.parent_id || undefined,
          parentTitle: apiDetail.parent?.title,
          estimateMinutes: apiDetail.estimate_minutes || undefined,
          actualMinutes: apiDetail.actual_minutes || undefined,
          dueDate: apiDetail.not_after ? new Date(apiDetail.not_after) : undefined,
          startDate: apiDetail.not_before ? new Date(apiDetail.not_before) : undefined,
          createdAt: new Date(apiDetail.created_at),
          updatedAt: new Date(apiDetail.updated_at),
          todos: [],
          attachments: [],
          dependencies: deps,
        };
      })()
    : null;

  // Map memories
  const memories: MemoryItem[] = (memoriesData?.memories ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    content: m.content,
    linkedItemId: itemId,
    linkedItemTitle: workItem?.title || undefined,
    linkedItemKind: (workItem?.kind || 'issue') as 'issue',
    createdAt: new Date(m.created_at),
    updatedAt: new Date(m.updated_at),
  }));

  // Map communications
  const emails: LinkedEmail[] = (commsData?.emails ?? []).map((e) => ({
    id: e.id,
    subject: 'Email',
    from: { name: 'Unknown', email: '' },
    to: [],
    date: e.received_at ? new Date(e.received_at) : new Date(),
    snippet: e.body?.substring(0, 100) || '',
    body: e.body || undefined,
  }));

  const calendarEvents: LinkedCalendarEvent[] = (commsData?.calendar_events ?? []).map((e) => ({
    id: e.id,
    title: 'Calendar Event',
    startTime: e.received_at ? new Date(e.received_at) : new Date(),
    endTime: e.received_at ? new Date(e.received_at) : new Date(),
    attendees: [],
  }));

  // Filter activity for this work item
  const itemActivity = (activityData?.items ?? []).filter((a) => a.work_item_id === itemId);

  // Handlers
  const handleUpdate = useCallback(
    (body: Record<string, unknown>) => {
      updateMutation.mutate({ id: itemId, body: body as Parameters<typeof updateMutation.mutate>[0]['body'] });
    },
    [itemId, updateMutation],
  );

  const handleTitleChange = (title: string) => handleUpdate({ title });
  const handleDescriptionChange = (description: string) => handleUpdate({ description });
  const handleStatusChange = (status: WorkItemStatus) => handleUpdate({ status });
  const handlePriorityChange = (priority: WorkItemPriority) => handleUpdate({ priority: mapPriorityToApi(priority) });
  const handleDueDateChange = (date: string) => handleUpdate({ notAfter: date || null });
  const handleStartDateChange = (date: string) => handleUpdate({ notBefore: date || null });
  const handleEstimateChange = (minutes: string) => {
    const value = parseInt(minutes, 10);
    handleUpdate({ estimateMinutes: isNaN(value) ? null : value });
  };
  const handleActualChange = (minutes: string) => {
    const value = parseInt(minutes, 10);
    handleUpdate({ actualMinutes: isNaN(value) ? null : value });
  };
  const handleParentClick = () => {
    if (workItem?.parentId) {
      window.location.href = `/app/work-items/${workItem.parentId}`;
    }
  };
  const handleDependencyClick = (dep: WorkItemDependency) => {
    window.location.href = `/app/work-items/${dep.id}`;
  };

  // Memory handlers
  const handleAddMemory = () => {
    setEditingMemory(null);
    setMemoryEditorOpen(true);
  };
  const handleEditMemory = (memory: MemoryItem) => {
    setEditingMemory(memory);
    setMemoryEditorOpen(true);
  };
  const handleCreateMemory = (data: MemoryFormData) => {
    createMemoryMutation.mutate(
      { workItemId: itemId, body: { title: data.title, content: data.content, type: 'note' } },
      { onSuccess: () => setMemoryEditorOpen(false) },
    );
  };
  const handleUpdateMemory = (data: MemoryFormData) => {
    if (!editingMemory) return;
    updateMemoryMutation.mutate(
      { id: editingMemory.id, body: { title: data.title, content: data.content }, workItemId: itemId },
      {
        onSuccess: () => {
          setMemoryEditorOpen(false);
          setEditingMemory(null);
        },
      },
    );
  };
  const handleDeleteMemory = async (memory: MemoryItem) => {
    if (!confirm(`Delete memory "${memory.title}"?`)) return;
    try {
      await apiClient.delete(`/api/memories/${memory.id}`);
      queryClient.invalidateQueries({ queryKey: memoryKeys.forWorkItem(itemId) });
    } catch {
      // Silently fail
    }
  };

  // Communication handlers
  const handleUnlinkEmail = async (email: LinkedEmail) => {
    if (!confirm('Unlink this email from the work item?')) return;
    try {
      await apiClient.delete(`/api/work-items/${itemId}/communications/${email.id}`);
      queryClient.invalidateQueries({ queryKey: communicationsKeys.forWorkItem(itemId) });
    } catch {
      // Silently fail
    }
  };
  const handleUnlinkEvent = async (event: LinkedCalendarEvent) => {
    if (!confirm('Unlink this event from the work item?')) return;
    try {
      await apiClient.delete(`/api/work-items/${itemId}/communications/${event.id}`);
      queryClient.invalidateQueries({ queryKey: communicationsKeys.forWorkItem(itemId) });
    } catch {
      // Silently fail
    }
  };

  // Delete handler
  const handleDelete = () => setDeleteDialogOpen(true);
  const handleConfirmDelete = async () => {
    if (!workItem) return;
    await performDelete({ id: workItem.id, title: workItem.title });
    setDeleteDialogOpen(false);
  };

  // --- LOADING STATE ---
  if (isLoading) {
    return (
      <div data-testid="page-work-item-detail" className="flex flex-col h-full">
        <div className="p-4 border-b border-border flex items-center gap-4">
          <Skeleton width={80} height={32} />
          <div className="flex gap-2">
            <Skeleton width={100} height={32} />
            <Skeleton width={120} height={32} />
          </div>
        </div>
        <div className="flex-1 p-6">
          <div className="mx-auto max-w-5xl space-y-6">
            <SkeletonCard />
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <SkeletonCard />
              </div>
              <div>
                <Skeleton width="100%" height={200} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- ERROR STATE ---
  if (itemError || !workItem) {
    return (
      <div data-testid="page-work-item-detail" className="p-6">
        <ErrorState
          title="Work Item Not Found"
          message={itemError instanceof Error ? itemError.message : 'The requested work item could not be loaded.'}
          action={
            <Button variant="outline" asChild>
              <Link to="/work-items">Back to Work Items</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div data-testid="page-work-item-detail" className="flex flex-col h-full">
      {/* Navigation bar */}
      <div className="p-4 border-b border-border bg-background flex items-center gap-4 shrink-0">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/work-items">
            <ChevronRight className="mr-1 size-4 rotate-180" />
            Back
          </Link>
        </Button>
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/work-items/${itemId}/timeline`}>
              <Calendar className="mr-2 size-4" />
              Timeline
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/work-items/${itemId}/graph`}>
              <Network className="mr-2 size-4" />
              Dependencies
            </Link>
          </Button>
        </div>
      </div>

      {/* Main content area */}
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-5xl p-6 space-y-6">
          {/* Header section */}
          <ItemHeader
            title={workItem.title}
            kind={workItem.kind}
            status={workItem.status}
            parentTitle={workItem.parentTitle}
            onTitleChange={handleTitleChange}
            onParentClick={handleParentClick}
            onDelete={handleDelete}
          />

          {/* Timestamps */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              Created {formatRelativeTime(workItem.createdAt)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              Updated {formatRelativeTime(workItem.updatedAt)}
            </span>
            {updateMutation.isPending && (
              <Badge variant="outline" className="text-xs animate-pulse">
                Saving...
              </Badge>
            )}
          </div>

          {/* Main grid: content + sidebar */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left column - tabbed content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Metadata card */}
              <Card>
                <CardContent className="pt-4">
                  <MetadataGrid
                    status={workItem.status}
                    priority={workItem.priority}
                    assignee={workItem.assignee}
                    dueDate={workItem.dueDate}
                    startDate={workItem.startDate}
                    estimateMinutes={workItem.estimateMinutes}
                    actualMinutes={workItem.actualMinutes}
                    onStatusChange={handleStatusChange}
                    onPriorityChange={handlePriorityChange}
                    onDueDateChange={handleDueDateChange}
                    onStartDateChange={handleStartDateChange}
                    onEstimateChange={handleEstimateChange}
                    onActualChange={handleActualChange}
                  />
                </CardContent>
              </Card>

              {/* Tabbed content sections */}
              <Tabs defaultValue="description">
                <TabsList variant="line" className="w-full justify-start">
                  <TabsTrigger value="description" className="gap-1.5">
                    <FileText className="size-3.5" />
                    Description
                  </TabsTrigger>
                  <TabsTrigger value="checklist" className="gap-1.5">
                    <CheckSquare className="size-3.5" />
                    Checklist
                    {workItem.todos.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                        {workItem.todos.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="dependencies" className="gap-1.5">
                    <GitBranch className="size-3.5" />
                    Dependencies
                    {workItem.dependencies.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                        {workItem.dependencies.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="activity" className="gap-1.5">
                    <Activity className="size-3.5" />
                    Activity
                  </TabsTrigger>
                </TabsList>

                {/* Description Tab */}
                <TabsContent value="description" data-testid="tab-content-description">
                  <Card>
                    <CardContent className="pt-4">
                      <DescriptionEditor description={workItem.description} onDescriptionChange={handleDescriptionChange} />
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Checklist Tab */}
                <TabsContent value="checklist" data-testid="tab-content-checklist">
                  <Card>
                    <CardContent className="pt-4">
                      <TodoList todos={workItem.todos} />
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Dependencies Tab */}
                <TabsContent value="dependencies" data-testid="tab-content-dependencies">
                  <Card>
                    <CardContent className="pt-4">
                      <DependenciesSection dependencies={workItem.dependencies} onDependencyClick={handleDependencyClick} />
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Activity Tab */}
                <TabsContent value="activity" data-testid="tab-content-activity">
                  <Card>
                    <CardContent className="pt-4">
                      {activityLoading ? (
                        <SkeletonList count={3} variant="row" />
                      ) : itemActivity.length === 0 ? (
                        <div className="py-8 text-center text-muted-foreground">
                          <Activity className="size-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No activity recorded yet</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {itemActivity.map((act) => (
                            <div key={act.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                              <div
                                className={`size-7 rounded-full flex items-center justify-center shrink-0 ${
                                  act.actor_email?.includes('agent')
                                    ? 'bg-violet-500/10 text-violet-500 dark:bg-violet-500/20'
                                    : 'bg-primary/10 text-primary dark:bg-primary/20'
                                }`}
                              >
                                <span className="text-xs font-medium">{(act.actor_email ?? 'S').charAt(0).toUpperCase()}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm">
                                  <span className="font-medium text-foreground">{act.actor_email || 'System'}</span>{' '}
                                  <span className="text-muted-foreground">{act.description}</span>
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">{formatRelativeTime(new Date(act.created_at))}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>

            {/* Right column - sidebar panels */}
            <div className="space-y-6">
              {/* Memories panel */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Brain className="size-4 text-muted-foreground" />
                    Memories
                    {memories.length > 0 && (
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        {memories.length}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {memoriesLoading ? (
                    <Skeleton width="100%" height={80} />
                  ) : (
                    <ItemMemories memories={memories} onAddMemory={handleAddMemory} onEditMemory={handleEditMemory} onDeleteMemory={handleDeleteMemory} />
                  )}
                </CardContent>
              </Card>

              {/* Communications panel */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Mail className="size-4 text-muted-foreground" />
                    Communications
                    {emails.length + calendarEvents.length > 0 && (
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        {emails.length + calendarEvents.length}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {communicationsLoading ? (
                    <Skeleton width="100%" height={80} />
                  ) : (
                    <ItemCommunications emails={emails} calendarEvents={calendarEvents} onUnlinkEmail={handleUnlinkEmail} onUnlinkEvent={handleUnlinkEvent} />
                  )}
                </CardContent>
              </Card>

              {/* Participants panel */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground" />
                    Participants
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {participants.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No participants assigned</p>
                  ) : (
                    <ul className="space-y-2">
                      {participants.map((p, idx) => (
                        <li key={idx} className="flex items-center gap-2">
                          <div className="size-7 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                            <span className="text-xs font-medium text-primary">{(p.participant ?? 'U')[0].toUpperCase()}</span>
                          </div>
                          <span className="text-sm">{p.participant ?? 'Unknown'}</span>
                          {p.role && (
                            <Badge variant="outline" className="text-xs">
                              {p.role}
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Memory Editor Dialog */}
      <MemoryEditor
        memory={editingMemory || undefined}
        open={memoryEditorOpen}
        onOpenChange={setMemoryEditorOpen}
        onSubmit={editingMemory ? handleUpdateMemory : handleCreateMemory}
      />

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        item={workItem ? { id: workItem.id, title: workItem.title, kind: workItem.kind, childCount: 0 } : undefined}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />
      {undoState && <UndoToast visible={!!undoState} itemTitle={undoState.itemTitle} onUndo={undoState.onUndo} onDismiss={dismissUndo} />}
    </div>
  );
}
