/**
 * Work item detail page.
 *
 * Displays full details for a single work item including description,
 * status, priority, dates, memories, communications, and participants.
 * Uses TanStack Query hooks for data fetching and mutations.
 */
import React, { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { useWorkItem, workItemKeys } from '@/ui/hooks/queries/use-work-items';
import { useWorkItemMemories, memoryKeys } from '@/ui/hooks/queries/use-memories';
import { useWorkItemCommunications, communicationsKeys } from '@/ui/hooks/queries/use-communications';
import { useUpdateWorkItem } from '@/ui/hooks/mutations/use-update-work-item';
import { useCreateMemory } from '@/ui/hooks/mutations/use-create-memory';
import { useUpdateMemory } from '@/ui/hooks/mutations/use-update-memory';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client';
import type { AppBootstrap } from '@/ui/lib/api-types';
import { mapApiPriority, mapPriorityToApi, readBootstrap } from '@/ui/lib/work-item-utils';
import { SkeletonCard, ErrorState, Skeleton } from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { ItemDetail } from '@/ui/components/detail/item-detail';
import type {
  WorkItemDetail as DetailComponentType,
  WorkItemStatus,
  WorkItemPriority,
  WorkItemKind,
  WorkItemDependency,
} from '@/ui/components/detail/types';
import { ItemMemories } from '@/ui/components/memory/item-memories';
import { MemoryEditor } from '@/ui/components/memory/memory-editor';
import type { MemoryItem, MemoryFormData } from '@/ui/components/memory/types';
import { ItemCommunications } from '@/ui/components/communications/item-communications';
import type { LinkedEmail, LinkedCalendarEvent } from '@/ui/components/communications/types';
import {
  DeleteConfirmDialog,
  UndoToast,
  useWorkItemDelete,
} from '@/ui/components/work-item-delete';
import { ChevronRight, Calendar, Network } from 'lucide-react';

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

  const calendarEvents: LinkedCalendarEvent[] = (commsData?.calendar_events ?? []).map(
    (e) => ({
      id: e.id,
      title: 'Calendar Event',
      startTime: e.received_at ? new Date(e.received_at) : new Date(),
      endTime: e.received_at ? new Date(e.received_at) : new Date(),
      attendees: [],
    }),
  );

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
  const handlePriorityChange = (priority: WorkItemPriority) =>
    handleUpdate({ priority: mapPriorityToApi(priority) });
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

  if (isLoading) {
    return (
      <div data-testid="page-work-item-detail" className="p-6">
        <SkeletonCard />
      </div>
    );
  }

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
      <div className="p-4 border-b flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/work-items">
            <ChevronRight className="mr-1 size-4 rotate-180" />
            Back
          </Link>
        </Button>
        <div className="flex gap-2">
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

      <ItemDetail
        item={workItem}
        onTitleChange={handleTitleChange}
        onDescriptionChange={handleDescriptionChange}
        onStatusChange={handleStatusChange}
        onPriorityChange={handlePriorityChange}
        onDueDateChange={handleDueDateChange}
        onStartDateChange={handleStartDateChange}
        onEstimateChange={handleEstimateChange}
        onActualChange={handleActualChange}
        onParentClick={handleParentClick}
        onDependencyClick={handleDependencyClick}
        onDelete={handleDelete}
        className="flex-1"
      />

      <div className="p-6 space-y-6 border-t">
        {/* Memories Section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Memories</CardTitle>
          </CardHeader>
          <CardContent>
            {memoriesLoading ? (
              <Skeleton width="100%" height={100} />
            ) : (
              <ItemMemories
                memories={memories}
                onAddMemory={handleAddMemory}
                onEditMemory={handleEditMemory}
                onDeleteMemory={handleDeleteMemory}
              />
            )}
          </CardContent>
        </Card>

        <MemoryEditor
          memory={editingMemory || undefined}
          open={memoryEditorOpen}
          onOpenChange={setMemoryEditorOpen}
          onSubmit={editingMemory ? handleUpdateMemory : handleCreateMemory}
        />

        {/* Communications Section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Communications</CardTitle>
          </CardHeader>
          <CardContent>
            {communicationsLoading ? (
              <Skeleton width="100%" height={100} />
            ) : (
              <ItemCommunications
                emails={emails}
                calendarEvents={calendarEvents}
                onUnlinkEmail={handleUnlinkEmail}
                onUnlinkEvent={handleUnlinkEvent}
              />
            )}
          </CardContent>
        </Card>

        {/* Participants Section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Participants</CardTitle>
          </CardHeader>
          <CardContent>
            {participants.length === 0 ? (
              <p className="text-muted-foreground">No participants assigned</p>
            ) : (
              <ul className="space-y-2">
                {participants.map((p, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-xs font-medium text-primary">
                        {(p.participant ?? 'U')[0].toUpperCase()}
                      </span>
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

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        item={
          workItem
            ? { id: workItem.id, title: workItem.title, kind: workItem.kind, childCount: 0 }
            : undefined
        }
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />
      {undoState && (
        <UndoToast
          visible={!!undoState}
          itemTitle={undoState.itemTitle}
          onUndo={undoState.onUndo}
          onDismiss={dismissUndo}
        />
      )}
    </div>
  );
}
