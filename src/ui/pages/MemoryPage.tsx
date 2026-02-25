/**
 * Memory/Knowledge page.
 *
 * Displays a searchable, filterable list of memories with type badges,
 * content previews, tags, linked work item info, and dates. Supports:
 * - Searching memories by title and content
 * - Filtering by memory type (preference, fact, decision, context)
 * - Inline expansion for full content viewing
 * - Create/Edit memory via dialog with markdown editor
 * - Delete memory with confirmation
 * - Bulk operations: select, bulk delete, bulk update type (#1750)
 * - Contact/relationship scoping in create form (#1751)
 * - Loading, error, and empty states
 * - Dark mode and mobile responsive
 *
 * Uses TanStack Query hooks for data fetching and mutations.
 */

import {
  Brain,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  Folder,
  Layers,
  Lightbulb,
  Link2,
  MoreVertical,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
} from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { EmptyState, ErrorState, Skeleton, SkeletonList } from '@/ui/components/feedback';
import { BulkMemoryActionBar } from '@/ui/components/memory/bulk-action-bar';
import { ContactPicker } from '@/ui/components/memory/contact-picker';
import type { ContactOption } from '@/ui/components/memory/contact-picker';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent } from '@/ui/components/ui/card';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { Input } from '@/ui/components/ui/input';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Textarea } from '@/ui/components/ui/textarea';
import { useContacts } from '@/ui/hooks/queries/use-contacts';
import { useMemories } from '@/ui/hooks/queries/use-memories';
import { useProjects } from '@/ui/hooks/queries/use-projects';
import { apiClient } from '@/ui/lib/api-client';
import type { CreateMemoryBody, Memory, UpdateMemoryBody } from '@/ui/lib/api-types';

/** Memory type for filtering. */
type MemoryType = 'preference' | 'fact' | 'decision' | 'context';

/** All valid memory types. */
const _MEMORY_TYPES: MemoryType[] = ['preference', 'fact', 'decision', 'context'];

/** Get icon for a memory type. */
function getTypeIcon(type: string | undefined): React.ReactNode {
  switch (type) {
    case 'preference':
      return <Lightbulb className="size-4" />;
    case 'fact':
      return <FileText className="size-4" />;
    case 'decision':
      return <CheckCircle className="size-4" />;
    case 'context':
      return <Layers className="size-4" />;
    default:
      return <Brain className="size-4" />;
  }
}

/** Get display label for a memory type. */
function getTypeLabel(type: string | undefined): string {
  switch (type) {
    case 'preference':
      return 'Preference';
    case 'fact':
      return 'Fact';
    case 'decision':
      return 'Decision';
    case 'context':
      return 'Context';
    default:
      return 'Memory';
  }
}

/** Get badge variant color for a memory type. */
function getTypeBadgeClass(type: string | undefined): string {
  switch (type) {
    case 'preference':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20';
    case 'fact':
      return 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20';
    case 'decision':
      return 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20';
    case 'context':
      return 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20';
    default:
      return '';
  }
}

/** Format a date string for display. */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function MemoryPage(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [contactFilter, setContactFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Memory | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Bulk selection state (#1750)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useMemories();
  const { data: projectsData } = useProjects();
  const { data: contactsData } = useContacts();

  /** Contact options for the picker (#1751). */
  const contactOptions: ContactOption[] = useMemo(() => {
    if (!contactsData?.contacts) return [];
    return contactsData.contacts.map((c) => ({
      id: c.id,
      display_name: c.display_name ?? '',
    }));
  }, [contactsData?.contacts]);

  /** Map of contact IDs to display names for showing on cards (#1751). */
  const contactNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (contactsData?.contacts) {
      for (const c of contactsData.contacts) {
        map.set(c.id, c.display_name ?? '');
      }
    }
    return map;
  }, [contactsData?.contacts]);

  /** Map of project IDs to their titles for display. */
  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (projectsData?.items) {
      for (const p of projectsData.items) {
        map.set(p.id, p.title);
      }
    }
    return map;
  }, [projectsData?.items]);

  /** Filter and search memories. */
  const filteredMemories = useMemo(() => {
    if (!data?.memories) return [];
    let result = data.memories;

    // Filter by type
    if (typeFilter !== 'all') {
      result = result.filter((m) => m.type === typeFilter);
    }

    // Filter by project scope
    if (projectFilter === 'global') {
      result = result.filter((m) => !m.project_id);
    } else if (projectFilter !== 'all') {
      result = result.filter((m) => m.project_id === projectFilter);
    }

    // Filter by contact scope (#1751)
    if (contactFilter !== 'all') {
      result = result.filter((m) => (m as Memory & { contact_id?: string }).contact_id === contactFilter);
    }

    // Search by title and content
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter((m) => m.title.toLowerCase().includes(query) || m.content.toLowerCase().includes(query));
    }

    return result;
  }, [data?.memories, typeFilter, projectFilter, contactFilter, search]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // Bulk selection handlers (#1750)
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsSubmitting(true);
    try {
      // Delete each selected memory
      await Promise.all(
        Array.from(selectedIds).map((id) => apiClient.delete(`/api/memories/${id}`)),
      );
      setSelectedIds(new Set());
      setBulkDeleteConfirmOpen(false);
      refetch();
    } catch (err) {
      console.error('Failed to bulk delete memories:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIds, refetch]);

  const handleBulkUpdateType = useCallback(
    async (newType: string) => {
      if (selectedIds.size === 0) return;
      setIsSubmitting(true);
      try {
        await apiClient.patch('/api/memories/bulk', {
          ids: Array.from(selectedIds),
          updates: { type: newType },
        });
        setSelectedIds(new Set());
        refetch();
      } catch (err) {
        console.error('Failed to bulk update memories:', err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [selectedIds, refetch],
  );

  const handleCreate = useCallback(
    async (body: CreateMemoryBody) => {
      setIsSubmitting(true);
      try {
        // Create as a standalone memory (not attached to a work item)
        await apiClient.post('/api/memory', body);
        setFormOpen(false);
        setEditingMemory(null);
        refetch();
      } catch (err) {
        console.error('Failed to create memory:', err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [refetch],
  );

  const handleUpdate = useCallback(
    async (body: UpdateMemoryBody) => {
      if (!editingMemory) return;
      setIsSubmitting(true);
      try {
        await apiClient.patch(`/api/memories/${editingMemory.id}`, body);
        setFormOpen(false);
        setEditingMemory(null);
        refetch();
      } catch (err) {
        console.error('Failed to update memory:', err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [editingMemory, refetch],
  );

  const handleDelete = useCallback(
    async (memory: Memory) => {
      try {
        await apiClient.delete(`/api/memories/${memory.id}`);
        setDeleteTarget(null);
        if (expandedId === memory.id) {
          setExpandedId(null);
        }
        refetch();
      } catch (err) {
        console.error('Failed to delete memory:', err);
      }
    },
    [expandedId, refetch],
  );

  const handleEdit = useCallback((memory: Memory) => {
    setEditingMemory(memory);
    setFormOpen(true);
  }, []);

  const handleAddNew = useCallback(() => {
    setEditingMemory(null);
    setFormOpen(true);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div data-testid="page-memory" className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton width={200} height={32} />
          <Skeleton width={140} height={36} />
        </div>
        <div className="mb-4 flex gap-3">
          <Skeleton width="100%" height={40} className="max-w-md" />
          <Skeleton width={150} height={40} />
        </div>
        <SkeletonList count={6} variant="card" />
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div data-testid="page-memory" className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load memories"
          description={error instanceof Error ? error.message : 'Unknown error'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const total = data?.total ?? 0;

  return (
    <div data-testid="page-memory" className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Memory</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} memor{total !== 1 ? 'ies' : 'y'}
            {(typeFilter !== 'all' || projectFilter !== 'all' || contactFilter !== 'all') && ` (${filteredMemories.length} shown)`}
          </p>
        </div>
        <Button onClick={handleAddNew} data-testid="add-memory-button">
          <Plus className="mr-2 size-4" />
          Add Memory
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search memories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="memory-search-input"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]" data-testid="type-filter">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="preference">Preferences</SelectItem>
            <SelectItem value="fact">Facts</SelectItem>
            <SelectItem value="decision">Decisions</SelectItem>
            <SelectItem value="context">Context</SelectItem>
          </SelectContent>
        </Select>

        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-[180px]" data-testid="project-filter">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            <SelectItem value="global">Global only</SelectItem>
            {projectsData?.items?.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Contact filter (#1751) */}
        <Select value={contactFilter} onValueChange={setContactFilter}>
          <SelectTrigger className="w-[180px]" data-testid="contact-filter">
            <SelectValue placeholder="All contacts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All contacts</SelectItem>
            {contactOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Memory List */}
      {filteredMemories.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              variant="documents"
              title={search || typeFilter !== 'all' || projectFilter !== 'all' || contactFilter !== 'all' ? 'No memories found' : 'No memories yet'}
              description={
                search || typeFilter !== 'all' || projectFilter !== 'all' || contactFilter !== 'all'
                  ? 'Try adjusting your search or filter criteria.'
                  : 'Store knowledge, preferences, decisions, and context for AI agents.'
              }
              onAction={!search && typeFilter === 'all' && projectFilter === 'all' && contactFilter === 'all' ? handleAddNew : undefined}
              actionLabel="Create Memory"
            />
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-3" data-testid="memory-list">
            {filteredMemories.map((memory) => {
              const isExpanded = expandedId === memory.id;
              const isSelected = selectedIds.has(memory.id);
              const preview = memory.content.length > 200 ? `${memory.content.slice(0, 200)}...` : memory.content;
              const memoryContactId = (memory as Memory & { contact_id?: string }).contact_id;

              return (
                <Card key={memory.id} data-testid="memory-card" className={`group transition-colors hover:bg-accent/30 ${isSelected ? 'ring-2 ring-primary' : ''}`}>
                  <CardContent className="p-4">
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-2">
                      {/* Selection checkbox (#1750) */}
                      <div className="pt-0.5 pr-2">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(memory.id)}
                          data-testid="memory-select-checkbox"
                          aria-label={`Select ${memory.title}`}
                        />
                      </div>

                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleToggleExpand(memory.id)}>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {memory.type && (
                            <Badge variant="outline" className={`text-xs gap-1 ${getTypeBadgeClass(memory.type)}`} data-testid="memory-type-badge">
                              {getTypeIcon(memory.type)}
                              {getTypeLabel(memory.type)}
                            </Badge>
                          )}
                          {memory.project_id && projectNameMap.has(memory.project_id) && (
                            <Badge variant="outline" className="text-xs gap-1" data-testid="memory-project-badge">
                              <Folder className="size-3" />
                              {projectNameMap.get(memory.project_id)}
                            </Badge>
                          )}
                          {/* Contact scope badge (#1751) */}
                          {memoryContactId && contactNameMap.has(memoryContactId) && (
                            <Badge variant="outline" className="text-xs gap-1" data-testid="memory-contact-badge">
                              <User className="size-3" />
                              {contactNameMap.get(memoryContactId)}
                            </Badge>
                          )}
                        </div>
                        <h3 className="font-medium text-foreground leading-tight">{memory.title}</h3>
                      </div>

                      {/* Actions dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100 shrink-0" data-testid="memory-actions">
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(memory)}>
                            <Pencil className="mr-2 size-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(memory)}>
                            <Trash2 className="mr-2 size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Content preview / expanded */}
                    <div className="mt-2 cursor-pointer ml-8" onClick={() => handleToggleExpand(memory.id)}>
                      {isExpanded ? (
                        <div className="text-sm text-foreground whitespace-pre-wrap" data-testid="memory-full-content">
                          {memory.content}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground line-clamp-2">{preview}</p>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="mt-3 ml-8 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-3">
                        {memory.work_item_id && (
                          <span className="flex items-center gap-1">
                            <Link2 className="size-3" />
                            Linked
                          </span>
                        )}
                        {(memory.attachment_count ?? 0) > 0 && (
                          <span className="flex items-center gap-1" data-testid="memory-attachment-count">
                            <Paperclip className="size-3" />
                            {memory.attachment_count}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="size-3" />
                          {formatDate(memory.updated_at)}
                        </span>
                      </div>

                      <button
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => handleToggleExpand(memory.id)}
                        data-testid="memory-expand-toggle"
                      >
                        {isExpanded ? (
                          <>
                            Collapse <ChevronUp className="size-3" />
                          </>
                        ) : (
                          <>
                            Expand <ChevronDown className="size-3" />
                          </>
                        )}
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Bulk action bar (#1750) */}
      <BulkMemoryActionBar
        selectedCount={selectedIds.size}
        onDelete={() => setBulkDeleteConfirmOpen(true)}
        onUpdateType={handleBulkUpdateType}
        onClearSelection={clearSelection}
      />

      {/* Bulk delete confirmation (#1750) */}
      <Dialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-sm" data-testid="bulk-delete-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Delete Memories</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedIds.size} memor{selectedIds.size !== 1 ? 'ies' : 'y'}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={isSubmitting} data-testid="confirm-bulk-delete">
              Delete {selectedIds.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Memory Dialog */}
      <MemoryFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingMemory(null);
        }}
        memory={editingMemory}
        isSubmitting={isSubmitting}
        contactOptions={contactOptions}
        onSubmit={(data) => {
          if (editingMemory) {
            handleUpdate(data);
          } else {
            handleCreate(data as CreateMemoryBody);
          }
        }}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm" data-testid="delete-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Delete Memory</DialogTitle>
            <DialogDescription>Are you sure you want to delete &quot;{deleteTarget?.title}&quot;? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleteTarget && handleDelete(deleteTarget)} data-testid="confirm-delete-button">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemoryFormDialog - extracted for readability
// ---------------------------------------------------------------------------

interface MemoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memory: Memory | null;
  isSubmitting: boolean;
  contactOptions: ContactOption[];
  onSubmit: (data: CreateMemoryBody | UpdateMemoryBody) => void;
}

function MemoryFormDialog({ open, onOpenChange, memory, isSubmitting, contactOptions, onSubmit }: MemoryFormDialogProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<string>('fact');
  const [contactId, setContactId] = useState<string | null>(null);

  // Reset form when dialog opens/closes or memory changes
  React.useEffect(() => {
    if (open) {
      setTitle(memory?.title ?? '');
      setContent(memory?.content ?? '');
      setType(memory?.type ?? 'fact');
      setContactId(null);
    }
  }, [open, memory]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (memory) {
      // Update: only send changed fields
      onSubmit({
        title: title.trim(),
        content: content.trim(),
      });
    } else {
      // Create: send all fields including optional contact_id (#1751)
      const body: CreateMemoryBody = {
        title: title.trim(),
        content: content.trim(),
        type: type,
      };
      if (contactId) {
        body.contact_id = contactId;
      }
      onSubmit(body);
    }
  };

  const isValid = title.trim().length > 0 && content.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="memory-form-dialog">
        <DialogHeader>
          <DialogTitle>{memory ? 'Edit Memory' : 'Create Memory'}</DialogTitle>
          <DialogDescription>{memory ? 'Update the memory details below.' : 'Store knowledge, preferences, decisions, or context.'}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="memory-title" className="text-sm font-medium">
              Title <span className="text-destructive">*</span>
            </label>
            <Input
              id="memory-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Memory title"
              required
              data-testid="memory-title-input"
            />
          </div>

          {!memory && (
            <div className="space-y-2">
              <label htmlFor="memory-type" className="text-sm font-medium">
                Type
              </label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="memory-type-select">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="preference">Preference</SelectItem>
                  <SelectItem value="fact">Fact</SelectItem>
                  <SelectItem value="decision">Decision</SelectItem>
                  <SelectItem value="context">Context</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Contact picker (#1751) - only for create */}
          {!memory && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Link to Contact</label>
              <ContactPicker
                contacts={contactOptions}
                selectedContactId={contactId}
                onSelect={setContactId}
              />
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="memory-content" className="text-sm font-medium">
              Content <span className="text-destructive">*</span>
            </label>
            <Textarea
              id="memory-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write memory content here... (Markdown supported)"
              className="min-h-[200px] font-mono text-sm"
              required
              data-testid="memory-content-input"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || isSubmitting} data-testid="memory-form-submit">
              {memory ? 'Save Changes' : 'Create Memory'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
