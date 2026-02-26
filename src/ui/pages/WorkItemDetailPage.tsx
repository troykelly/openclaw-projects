/**
 * Work item detail page.
 *
 * Displays full details for a single work item with a tabbed content layout.
 * Sections include Description, Checklist, Dependencies, Comments, Attachments,
 * Activity, Memory, Communications, and sidebar panels for Rollup, Recurrence,
 * Entity Links, Linked Contacts, and Participants.
 *
 * All metadata saves immediately via optimistic updates through TanStack Query mutations.
 *
 * @see Issue #469, #1707, #1708, #1710, #1712, #1714, #1715, #1717, #1718, #1720
 */
import React, { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { useWorkItem, workItemKeys } from '@/ui/hooks/queries/use-work-items';
import { useWorkItemMemories, memoryKeys } from '@/ui/hooks/queries/use-memories';
import { useWorkItemCommunications, communicationsKeys } from '@/ui/hooks/queries/use-communications';
import { useActivity } from '@/ui/hooks/queries/use-activity';
import { useWorkItemComments } from '@/ui/hooks/queries/use-comments';
import { useWorkItemAttachments } from '@/ui/hooks/queries/use-attachments';
import { useWorkItemRollup } from '@/ui/hooks/queries/use-rollup';
import { useRecurrenceRule, useRecurrenceInstances } from '@/ui/hooks/queries/use-recurrence';
import { useWorkItemContacts } from '@/ui/hooks/queries/use-work-item-contacts';
import { useUpdateWorkItem } from '@/ui/hooks/mutations/use-update-work-item';
import { useCreateMemory } from '@/ui/hooks/mutations/use-create-memory';
import { useUpdateMemory } from '@/ui/hooks/mutations/use-update-memory';
import { useAddComment, useEditComment, useDeleteComment, useAddReaction } from '@/ui/hooks/mutations/use-comments';
import { useAddDependency, useRemoveDependency } from '@/ui/hooks/mutations/use-dependencies';
import { useAddParticipant, useRemoveParticipant } from '@/ui/hooks/mutations/use-participants';
import { useDeleteAttachment } from '@/ui/hooks/mutations/use-attachments';
import { useSetRecurrence, useDeleteRecurrence } from '@/ui/hooks/mutations/use-recurrence';
import { useLinkContact, useUnlinkContact } from '@/ui/hooks/mutations/use-work-item-contacts';
import { useCreateWorkItem } from '@/ui/hooks/mutations/use-create-work-item';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { ItemHeader } from '@/ui/components/detail/item-header';
import { MetadataGrid } from '@/ui/components/detail/metadata-grid';
import { DescriptionEditor } from '@/ui/components/detail/description-editor';
import { TodoList } from '@/ui/components/detail/todo-list';
import { DependenciesSection } from '@/ui/components/detail/dependencies-section';
import type { WorkItemDetail as DetailComponentType, WorkItemStatus, WorkItemPriority, WorkItemKind, WorkItemDependency } from '@/ui/components/detail/types';
import { CommentsSection } from '@/ui/components/comments';
import { EntityLinkManager } from '@/ui/components/entity-links';
import { CloneDialog } from '@/ui/components/clone-dialog/clone-dialog';
import type { CloneOptions } from '@/ui/components/clone-dialog/types';
import { ItemMemories } from '@/ui/components/memory/item-memories';
import { MemoryEditor } from '@/ui/components/memory/memory-editor';
import type { MemoryItem, MemoryFormData } from '@/ui/components/memory/types';
import { ItemCommunications } from '@/ui/components/communications/item-communications';
import type { LinkedEmail, LinkedCalendarEvent } from '@/ui/components/communications/types';
import { DeleteConfirmDialog, UndoToast, useWorkItemDelete } from '@/ui/components/work-item-delete';
import { NamespaceBadge } from '@/ui/components/namespace';
import {
  ChevronRight, Calendar, Network, FileText, CheckSquare, GitBranch, Activity, Brain, Mail,
  Users, Clock, MessageSquare, Paperclip, Link2, Copy, BarChart3, Repeat, UserPlus, Plus, X,
  Download, Trash2,
} from 'lucide-react';

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

/** Format bytes into human-readable size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkItemDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const item_id = id ?? '';
  const queryClient = useQueryClient();
  const bootstrap = readBootstrap<AppBootstrap>();
  const participants = bootstrap?.participants ?? [];
  const currentUserEmail = bootstrap?.me?.email ?? '';

  // Data queries
  const { data: apiDetail, isLoading, error: itemError } = useWorkItem(item_id);
  const { data: memoriesData, isLoading: memoriesLoading } = useWorkItemMemories(item_id);
  const { data: commsData, isLoading: communicationsLoading } = useWorkItemCommunications(item_id);
  const { data: activityData, isLoading: activityLoading } = useActivity(50);
  const { data: commentsData, isLoading: commentsLoading } = useWorkItemComments(item_id);
  const { data: attachmentsData, isLoading: attachmentsLoading } = useWorkItemAttachments(item_id);
  const { data: rollupData } = useWorkItemRollup(item_id);
  const { data: recurrenceData } = useRecurrenceRule(item_id);
  const { data: instancesData } = useRecurrenceInstances(item_id);
  const { data: linkedContactsData } = useWorkItemContacts(item_id);

  // Mutations
  const updateMutation = useUpdateWorkItem();
  const createMemoryMutation = useCreateMemory();
  const updateMemoryMutation = useUpdateMemory();
  const addCommentMutation = useAddComment(item_id);
  const editCommentMutation = useEditComment(item_id);
  const deleteCommentMutation = useDeleteComment(item_id);
  const addReactionMutation = useAddReaction(item_id);
  const addDependencyMutation = useAddDependency(item_id);
  const removeDependencyMutation = useRemoveDependency(item_id);
  const addParticipantMutation = useAddParticipant(item_id);
  const removeParticipantMutation = useRemoveParticipant(item_id);
  const deleteAttachmentMutation = useDeleteAttachment(item_id);
  const setRecurrenceMutation = useSetRecurrence(item_id);
  const deleteRecurrenceMutation = useDeleteRecurrence(item_id);
  const linkContactMutation = useLinkContact(item_id);
  const unlinkContactMutation = useUnlinkContact(item_id);
  const createWorkItemMutation = useCreateWorkItem();

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

  // Clone state
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [isCloning, setIsCloning] = useState(false);

  // Add dependency dialog state
  const [addDepDialogOpen, setAddDepDialogOpen] = useState(false);
  const [addDepDirection, setAddDepDirection] = useState<'blocks' | 'blocked_by'>('blocks');
  const [addDepTargetId, setAddDepTargetId] = useState('');

  // Add participant dialog state
  const [addParticipantDialogOpen, setAddParticipantDialogOpen] = useState(false);
  const [addParticipantName, setAddParticipantName] = useState('');
  const [addParticipantRole, setAddParticipantRole] = useState('');

  // Recurrence dialog state
  const [recurrenceDialogOpen, setRecurrenceDialogOpen] = useState(false);
  const [recurrenceInput, setRecurrenceInput] = useState('');

  // Link contact dialog state
  const [linkContactDialogOpen, setLinkContactDialogOpen] = useState(false);
  const [linkContactId, setLinkContactId] = useState('');

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
          parent_id: apiDetail.parent_id || undefined,
          parentTitle: apiDetail.parent?.title,
          estimateMinutes: apiDetail.estimate_minutes || undefined,
          actualMinutes: apiDetail.actual_minutes || undefined,
          dueDate: apiDetail.not_after ? new Date(apiDetail.not_after) : undefined,
          startDate: apiDetail.not_before ? new Date(apiDetail.not_before) : undefined,
          created_at: new Date(apiDetail.created_at),
          updated_at: new Date(apiDetail.updated_at),
          namespace: apiDetail.namespace,
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
    linked_item_id: item_id,
    linked_item_title: workItem?.title || undefined,
    linked_item_kind: (workItem?.kind || 'issue') as 'issue',
    created_at: new Date(m.created_at),
    updated_at: new Date(m.updated_at),
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
  const itemActivity = (activityData?.items ?? []).filter((a) => a.work_item_id === item_id);

  // Comments data
  const comments = commentsData?.comments ?? [];

  // Attachments data
  const attachments = attachmentsData?.attachments ?? [];

  // Linked contacts
  const linkedContacts = linkedContactsData?.contacts ?? [];

  // Recurrence
  const recurrenceRule = recurrenceData?.rule_description ?? null;
  const recurrenceInstances = instancesData?.instances ?? [];

  // Handlers
  const handleUpdate = useCallback(
    (body: Record<string, unknown>) => {
      updateMutation.mutate({ id: item_id, body: body as Parameters<typeof updateMutation.mutate>[0]['body'] });
    },
    [item_id, updateMutation],
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
    if (workItem?.parent_id) {
      window.location.href = `/app/work-items/${workItem.parent_id}`;
    }
  };
  const handleDependencyClick = (dep: WorkItemDependency) => {
    window.location.href = `/app/work-items/${dep.id}`;
  };

  // Dependency handlers (#1712)
  const handleAddDependency = (direction: 'blocks' | 'blocked_by') => {
    setAddDepDirection(direction);
    setAddDepTargetId('');
    setAddDepDialogOpen(true);
  };

  const handleSubmitDependency = () => {
    if (!addDepTargetId.trim()) return;
    addDependencyMutation.mutate(
      { target_id: addDepTargetId.trim(), direction: addDepDirection },
      { onSuccess: () => setAddDepDialogOpen(false) },
    );
  };

  const handleRemoveDependency = (depId: string) => {
    removeDependencyMutation.mutate(depId);
  };

  // Participant handlers (#1714)
  const handleSubmitParticipant = () => {
    if (!addParticipantName.trim()) return;
    addParticipantMutation.mutate(
      { participant: addParticipantName.trim(), role: addParticipantRole.trim() || undefined },
      {
        onSuccess: () => {
          setAddParticipantDialogOpen(false);
          setAddParticipantName('');
          setAddParticipantRole('');
        },
      },
    );
  };

  // Comment handlers (#1707)
  const handleAddComment = (_workItemId: string, content: string) => {
    addCommentMutation.mutate({ content });
  };
  const handleEditComment = (commentId: string, content: string) => {
    editCommentMutation.mutate({ commentId, content });
  };
  const handleDeleteComment = (commentId: string) => {
    deleteCommentMutation.mutate(commentId);
  };
  const handleAddReply = (parentId: string, content: string) => {
    addCommentMutation.mutate({ content, parent_id: parentId });
  };
  const handleReact = (commentId: string, emoji: string) => {
    addReactionMutation.mutate({ commentId, emoji });
  };

  // Attachment handlers (#1708)
  const handleDeleteAttachment = (attachmentId: string) => {
    deleteAttachmentMutation.mutate(attachmentId);
  };

  // Clone handler (#1717)
  const handleClone = async (options: CloneOptions) => {
    if (!apiDetail) return;
    setIsCloning(true);
    try {
      const cloned = await createWorkItemMutation.mutateAsync({
        title: options.title,
        kind: apiDetail.kind,
        status: 'not_started',
        priority: apiDetail.priority,
        description: apiDetail.description ?? undefined,
        parent_id: apiDetail.parent_id ?? undefined,
      });
      setCloneDialogOpen(false);
      if (cloned?.id) {
        window.location.href = `/app/work-items/${cloned.id}`;
      }
    } finally {
      setIsCloning(false);
    }
  };

  // Recurrence handlers (#1710)
  const handleSetRecurrence = () => {
    if (!recurrenceInput.trim()) return;
    setRecurrenceMutation.mutate(
      { recurrence_natural: recurrenceInput.trim() },
      { onSuccess: () => { setRecurrenceDialogOpen(false); setRecurrenceInput(''); } },
    );
  };

  const handleDeleteRecurrence = () => {
    deleteRecurrenceMutation.mutate(undefined);
  };

  // Contact linking handlers (#1720)
  const handleLinkContact = () => {
    if (!linkContactId.trim()) return;
    linkContactMutation.mutate(
      linkContactId.trim(),
      { onSuccess: () => { setLinkContactDialogOpen(false); setLinkContactId(''); } },
    );
  };

  const handleUnlinkContact = (linkId: string) => {
    unlinkContactMutation.mutate(linkId);
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
      { work_item_id: item_id, body: { title: data.title, content: data.content, type: 'note' } },
      { onSuccess: () => setMemoryEditorOpen(false) },
    );
  };
  const handleUpdateMemory = (data: MemoryFormData) => {
    if (!editingMemory) return;
    updateMemoryMutation.mutate(
      { id: editingMemory.id, body: { title: data.title, content: data.content }, work_item_id: item_id },
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
      queryClient.invalidateQueries({ queryKey: memoryKeys.forWorkItem(item_id) });
    } catch {
      // Silently fail
    }
  };

  // Communication handlers
  const handleUnlinkEmail = async (email: LinkedEmail) => {
    if (!confirm('Unlink this email from the work item?')) return;
    try {
      await apiClient.delete(`/api/work-items/${item_id}/communications/${email.id}`);
      queryClient.invalidateQueries({ queryKey: communicationsKeys.forWorkItem(item_id) });
    } catch {
      // Silently fail
    }
  };
  const handleUnlinkEvent = async (event: LinkedCalendarEvent) => {
    if (!confirm('Unlink this event from the work item?')) return;
    try {
      await apiClient.delete(`/api/work-items/${item_id}/communications/${event.id}`);
      queryClient.invalidateQueries({ queryKey: communicationsKeys.forWorkItem(item_id) });
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
          <Button variant="outline" size="sm" onClick={() => setCloneDialogOpen(true)} data-testid="clone-button">
            <Copy className="mr-2 size-4" />
            Clone
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/work-items/${item_id}/timeline`}>
              <Calendar className="mr-2 size-4" />
              Timeline
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/work-items/${item_id}/graph`}>
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
              Created {formatRelativeTime(workItem.created_at)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              Updated {formatRelativeTime(workItem.updated_at)}
            </span>
            <NamespaceBadge namespace={workItem.namespace} />
            {updateMutation.isPending && (
              <Badge variant="outline" className="text-xs animate-pulse">
                Saving...
              </Badge>
            )}
          </div>

          {/* Rollup progress bar (#1718, fixed #1839) */}
          {rollupData && rollupData.total_estimate_minutes != null && rollupData.total_estimate_minutes > 0 && (
            <Card data-testid="rollup-progress">
              <CardContent className="pt-4">
                {(() => {
                  const estimated = rollupData.total_estimate_minutes ?? 0;
                  const actual = rollupData.total_actual_minutes ?? 0;
                  const progressPct = estimated > 0 ? Math.min(100, Math.round((actual / estimated) * 100)) : 0;
                  return (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium flex items-center gap-2">
                          <BarChart3 className="size-4 text-muted-foreground" />
                          Effort
                        </span>
                        <span className="text-sm font-medium">{progressPct}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                        <span>{actual} of {estimated} min logged</span>
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          )}

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
                  <TabsTrigger value="comments" className="gap-1.5">
                    <MessageSquare className="size-3.5" />
                    Comments
                    {comments.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                        {comments.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="attachments" className="gap-1.5">
                    <Paperclip className="size-3.5" />
                    Attachments
                    {attachments.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                        {attachments.length}
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

                {/* Dependencies Tab (#1712) */}
                <TabsContent value="dependencies" data-testid="tab-content-dependencies">
                  <Card>
                    <CardContent className="pt-4">
                      <DependenciesSection
                        dependencies={workItem.dependencies}
                        onDependencyClick={handleDependencyClick}
                        onAddDependency={handleAddDependency}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Comments Tab (#1707) */}
                <TabsContent value="comments" data-testid="tab-content-comments">
                  <Card>
                    <CardContent className="pt-4">
                      <CommentsSection
                        work_item_id={item_id}
                        comments={comments}
                        currentUserId={currentUserEmail}
                        onAddComment={handleAddComment}
                        onEditComment={handleEditComment}
                        onDeleteComment={handleDeleteComment}
                        onAddReply={handleAddReply}
                        onReact={handleReact}
                        loading={commentsLoading}
                        submitting={addCommentMutation.isPending}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Attachments Tab (#1708) */}
                <TabsContent value="attachments" data-testid="tab-content-attachments">
                  <Card>
                    <CardContent className="pt-4">
                      {attachmentsLoading ? (
                        <SkeletonList count={2} variant="row" />
                      ) : attachments.length === 0 ? (
                        <div className="py-8 text-center text-muted-foreground">
                          <Paperclip className="size-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No attachments</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {attachments.map((att) => (
                            <div key={att.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50">
                              <Paperclip className="size-4 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm truncate">{att.original_filename}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatBytes(att.size_bytes)} &middot; {att.content_type}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 shrink-0"
                                onClick={() => window.open(`/api/work-items/${item_id}/attachments/${att.id}/download`, '_blank')}
                              >
                                <Download className="size-3" />
                                <span className="sr-only">Download</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 shrink-0 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteAttachment(att.id)}
                              >
                                <Trash2 className="size-3" />
                                <span className="sr-only">Delete</span>
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
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
              {/* Recurrence panel (#1710) */}
              <Card data-testid="recurrence-section">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Repeat className="size-4 text-muted-foreground" />
                    Recurrence
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {recurrenceRule ? (
                    <div className="space-y-2">
                      <p className="text-sm">{recurrenceRule}</p>
                      {recurrenceInstances.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground font-medium">Recent instances</p>
                          {recurrenceInstances.slice(0, 3).map((inst) => (
                            <div key={inst.id} className="text-xs flex items-center justify-between">
                              <span className="truncate">{inst.title}</span>
                              <Badge variant="outline" className="text-xs ml-1 shrink-0">
                                {inst.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => { setRecurrenceInput(recurrenceRule); setRecurrenceDialogOpen(true); }}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleDeleteRecurrence}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">No recurrence set</p>
                      <Button variant="ghost" size="sm" onClick={() => setRecurrenceDialogOpen(true)}>
                        <Plus className="size-3 mr-1" />
                        Set recurrence
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Entity Links panel (#1715) */}
              <Card>
                <CardContent className="pt-4">
                  <EntityLinkManager
                    entity_type="todo"
                    entity_id={item_id}
                    direction="source"
                    onLinkClick={(type, id) => {
                      if (type === 'project' || type === 'todo') {
                        window.location.href = `/app/work-items/${id}`;
                      } else if (type === 'contact') {
                        window.location.href = `/app/contacts/${id}`;
                      }
                    }}
                  />
                </CardContent>
              </Card>

              {/* Linked Contacts panel (#1720) */}
              <Card data-testid="linked-contacts-section">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground" />
                    Linked Contacts
                    {linkedContacts.length > 0 && (
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        {linkedContacts.length}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {linkedContacts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No linked contacts</p>
                  ) : (
                    <ul className="space-y-2">
                      {linkedContacts.map((lc) => (
                        <li key={lc.id} className="flex items-center gap-2">
                          <div className="size-7 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                            <span className="text-xs font-medium text-primary">
                              {(lc.display_name ?? 'U')[0].toUpperCase()}
                            </span>
                          </div>
                          <a
                            href={`/app/contacts/${lc.contact_id}`}
                            className="text-sm hover:underline flex-1 truncate"
                          >
                            {lc.display_name ?? 'Unknown'}
                          </a>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 text-destructive hover:text-destructive"
                            onClick={() => handleUnlinkContact(lc.id)}
                          >
                            <X className="size-3" />
                            <span className="sr-only">Remove link</span>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setLinkContactDialogOpen(true)}
                  >
                    <Plus className="size-3 mr-1" />
                    Link contact
                  </Button>
                </CardContent>
              </Card>

              {/* Participants panel (#1714) */}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    data-testid="add-participant-button"
                    onClick={() => setAddParticipantDialogOpen(true)}
                  >
                    <UserPlus className="size-3 mr-1" />
                    Add participant
                  </Button>
                </CardContent>
              </Card>

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

      {/* Clone Dialog (#1717) */}
      {cloneDialogOpen && workItem && (
        <CloneDialog
          open={cloneDialogOpen}
          item={{
            id: workItem.id,
            title: workItem.title,
            kind: workItem.kind,
            hasChildren: workItem.dependencies.length > 0,
            hasTodos: workItem.todos.length > 0,
          }}
          onClone={handleClone}
          onCancel={() => setCloneDialogOpen(false)}
          isCloning={isCloning}
        />
      )}

      {/* Add Dependency Dialog (#1712) */}
      <Dialog open={addDepDialogOpen} onOpenChange={setAddDepDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Dependency</DialogTitle>
            <DialogDescription>
              {addDepDirection === 'blocked_by' ? 'This item is blocked by:' : 'This item blocks:'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="dep-target-id" className="text-sm font-medium">Work Item ID</label>
              <Input
                id="dep-target-id"
                placeholder="UUID of the work item"
                value={addDepTargetId}
                onChange={(e) => setAddDepTargetId(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDepDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmitDependency} disabled={!addDepTargetId.trim() || addDependencyMutation.isPending}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Participant Dialog (#1714) */}
      <Dialog open={addParticipantDialogOpen} onOpenChange={setAddParticipantDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Participant</DialogTitle>
            <DialogDescription>Add a participant to this work item.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="participant-name" className="text-sm font-medium">Name</label>
              <Input
                id="participant-name"
                placeholder="Participant name or email"
                value={addParticipantName}
                onChange={(e) => setAddParticipantName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="participant-role" className="text-sm font-medium">Role (optional)</label>
              <Input
                id="participant-role"
                placeholder="e.g. reviewer, assignee"
                value={addParticipantRole}
                onChange={(e) => setAddParticipantRole(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddParticipantDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmitParticipant} disabled={!addParticipantName.trim() || addParticipantMutation.isPending}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recurrence Dialog (#1710) */}
      <Dialog open={recurrenceDialogOpen} onOpenChange={setRecurrenceDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Recurrence</DialogTitle>
            <DialogDescription>Describe the recurrence pattern in natural language.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="recurrence-input" className="text-sm font-medium">Recurrence</label>
              <Input
                id="recurrence-input"
                placeholder="e.g. Every Monday, Every 2 weeks"
                value={recurrenceInput}
                onChange={(e) => setRecurrenceInput(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecurrenceDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSetRecurrence} disabled={!recurrenceInput.trim() || setRecurrenceMutation.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link Contact Dialog (#1720) */}
      <Dialog open={linkContactDialogOpen} onOpenChange={setLinkContactDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Link Contact</DialogTitle>
            <DialogDescription>Link a contact to this work item.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="link-contact-id" className="text-sm font-medium">Contact ID</label>
              <Input
                id="link-contact-id"
                placeholder="UUID of the contact"
                value={linkContactId}
                onChange={(e) => setLinkContactId(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkContactDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleLinkContact} disabled={!linkContactId.trim() || linkContactMutation.isPending}>
              Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
