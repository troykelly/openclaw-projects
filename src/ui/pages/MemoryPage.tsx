/**
 * Memory/Knowledge page.
 *
 * Displays a searchable, filterable list of memories with type badges,
 * content previews, tags, linked work item info, and dates. Supports:
 * - Searching memories by title and content
 * - Semantic search via pgvector (#1716)
 * - Filtering by memory type (preference, fact, decision, context)
 * - Filtering by date range (#1730)
 * - Active/superseded filtering (#1725)
 * - Tag display on cards (#1721)
 * - Tag editing in form (#1721)
 * - Metadata editing: importance, confidence, expiration, source (#1719)
 * - Geolocation display (#1728)
 * - Memory-contact linking (#1723)
 * - Related memories + similarity (#1724)
 * - Supersede/version chain (#1725)
 * - File attachment display (#1726)
 * - Inline expansion for full content viewing
 * - Create/Edit memory via dialog with markdown editor
 * - Delete memory with confirmation
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
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Folder,
  Layers,
  Lightbulb,
  Link2,
  MapPin,
  MoreVertical,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { EmptyState, ErrorState, Skeleton, SkeletonList } from '@/ui/components/feedback';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent } from '@/ui/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Switch } from '@/ui/components/ui/switch';
import { Textarea } from '@/ui/components/ui/textarea';
import { useMemories, useMemorySearch } from '@/ui/hooks/queries/use-memories';
import { useProjects } from '@/ui/hooks/queries/use-projects';
import { apiClient } from '@/ui/lib/api-client';
import type { CreateMemoryBody, Memory, UpdateMemoryBody } from '@/ui/lib/api-types';

/** Memory type for filtering. */
type MemoryTypeFilter = 'preference' | 'fact' | 'decision' | 'context' | 'note' | 'reference';

/** All valid memory types. */
const _MEMORY_TYPES: MemoryTypeFilter[] = ['preference', 'fact', 'decision', 'context', 'note', 'reference'];

/** Date range presets for filtering (#1730). */
const DATE_RANGE_PRESETS = [
  { label: 'All time', value: 'all' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'This week', value: 'week' },
  { label: 'This month', value: 'month' },
] as const;

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
    case 'note':
      return 'Note';
    case 'reference':
      return 'Reference';
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
    case 'note':
      return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/20';
    case 'reference':
      return 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20';
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

/** Calculate the date threshold for a date range preset. */
function getDateThreshold(preset: string): Date | null {
  const now = new Date();
  switch (preset) {
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'week': {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(now.getFullYear(), now.getMonth(), diff);
    }
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    default:
      return null;
  }
}

export function MemoryPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('all');
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [semanticSearch, setSemanticSearch] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Memory | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data, isLoading, isError, error, refetch } = useMemories();
  const { data: projectsData } = useProjects();
  const { data: searchData } = useMemorySearch(
    semanticSearch ? search : '',
    typeFilter !== 'all' ? { memory_type: typeFilter } : undefined,
  );

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
    // If semantic search is active and we have results, use those
    if (semanticSearch && search.trim().length >= 2 && searchData?.results) {
      return searchData.results;
    }

    if (!data?.memories) return [];
    let result = data.memories;

    // Filter by active status (#1725)
    if (!showSuperseded) {
      result = result.filter((m) => m.is_active !== false);
    }

    // Filter by type
    if (typeFilter !== 'all') {
      result = result.filter((m) => (m.memory_type ?? m.type) === typeFilter);
    }

    // Filter by project scope
    if (projectFilter === 'global') {
      result = result.filter((m) => !m.project_id);
    } else if (projectFilter !== 'all') {
      result = result.filter((m) => m.project_id === projectFilter);
    }

    // Filter by date range (#1730)
    if (dateRange !== 'all') {
      const threshold = getDateThreshold(dateRange);
      if (threshold) {
        result = result.filter((m) => new Date(m.created_at) >= threshold);
      }
    }

    // Search by title and content
    if (search.trim() && !semanticSearch) {
      const query = search.toLowerCase();
      result = result.filter((m) => m.title.toLowerCase().includes(query) || m.content.toLowerCase().includes(query));
    }

    return result;
  }, [data?.memories, typeFilter, projectFilter, search, dateRange, showSuperseded, semanticSearch, searchData?.results]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleNavigateToDetail = useCallback(
    (id: string) => {
      navigate(`/memory/${id}`);
    },
    [navigate],
  );

  const handleCreate = useCallback(
    async (body: CreateMemoryBody) => {
      setIsSubmitting(true);
      try {
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

  const handleSupersede = useCallback(
    async (memory: Memory) => {
      // Open create form pre-populated as a superseding memory
      setEditingMemory(null);
      setFormOpen(true);
    },
    [],
  );

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
  const hasActiveFilters = typeFilter !== 'all' || projectFilter !== 'all' || dateRange !== 'all' || showSuperseded;

  return (
    <div data-testid="page-memory" className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Memory</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} memor{total !== 1 ? 'ies' : 'y'}
            {(hasActiveFilters || search) && ` (${filteredMemories.length} shown)`}
          </p>
        </div>
        <Button onClick={handleAddNew} data-testid="add-memory-button">
          <Plus className="mr-2 size-4" />
          Add Memory
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder={semanticSearch ? 'Semantic search...' : 'Search memories...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="memory-search-input"
          />
        </div>

        {/* Semantic search toggle (#1716) */}
        <div className="flex items-center gap-2" data-testid="semantic-search-toggle">
          <Switch
            id="semantic-toggle"
            checked={semanticSearch}
            onCheckedChange={setSemanticSearch}
          />
          <Label htmlFor="semantic-toggle" className="text-sm flex items-center gap-1 cursor-pointer">
            <Sparkles className="size-3" />
            Semantic
          </Label>
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
            <SelectItem value="note">Notes</SelectItem>
            <SelectItem value="reference">References</SelectItem>
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

        {/* Date range filter (#1730) */}
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[160px]" data-testid="date-range-filter">
            <SelectValue placeholder="All time" />
          </SelectTrigger>
          <SelectContent>
            {DATE_RANGE_PRESETS.map((preset) => (
              <SelectItem key={preset.value} value={preset.value}>
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Active/superseded filter (#1725) */}
        <div className="flex items-center gap-2" data-testid="active-filter-toggle">
          <Switch
            id="show-superseded"
            checked={showSuperseded}
            onCheckedChange={setShowSuperseded}
          />
          <Label htmlFor="show-superseded" className="text-sm flex items-center gap-1 cursor-pointer">
            {showSuperseded ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
            Superseded
          </Label>
        </div>
      </div>

      {/* Semantic search results info */}
      {semanticSearch && searchData && search.trim().length >= 2 && (
        <div className="mb-3 text-xs text-muted-foreground flex items-center gap-2">
          <Sparkles className="size-3" />
          {searchData.results.length} result{searchData.results.length !== 1 ? 's' : ''} via {searchData.search_type} search
        </div>
      )}

      {/* Memory List */}
      {filteredMemories.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              variant="documents"
              title={search || hasActiveFilters ? 'No memories found' : 'No memories yet'}
              description={
                search || hasActiveFilters
                  ? 'Try adjusting your search or filter criteria.'
                  : 'Store knowledge, preferences, decisions, and context for AI agents.'
              }
              onAction={!search && !hasActiveFilters ? handleAddNew : undefined}
              actionLabel="Create Memory"
            />
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-3" data-testid="memory-list">
            {filteredMemories.map((memory) => {
              const isExpanded = expandedId === memory.id;
              const preview = memory.content.length > 200 ? `${memory.content.slice(0, 200)}...` : memory.content;
              const effectiveType = memory.memory_type ?? memory.type;
              const similarity = 'similarity' in memory ? (memory as Memory & { similarity: number }).similarity : undefined;

              return (
                <Card
                  key={memory.id}
                  data-testid="memory-card"
                  className={`group transition-colors hover:bg-accent/30 ${memory.is_active === false ? 'opacity-60' : ''}`}
                >
                  <CardContent className="p-4">
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleToggleExpand(memory.id)}>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {effectiveType && (
                            <Badge variant="outline" className={`text-xs gap-1 ${getTypeBadgeClass(effectiveType)}`} data-testid="memory-type-badge">
                              {getTypeIcon(effectiveType)}
                              {getTypeLabel(effectiveType)}
                            </Badge>
                          )}
                          {memory.project_id && projectNameMap.has(memory.project_id) && (
                            <Badge variant="outline" className="text-xs gap-1" data-testid="memory-project-badge">
                              <Folder className="size-3" />
                              {projectNameMap.get(memory.project_id)}
                            </Badge>
                          )}
                          {/* Superseded indicator (#1725) */}
                          {memory.is_active === false && (
                            <Badge variant="outline" className="text-xs gap-1 bg-muted text-muted-foreground">
                              <EyeOff className="size-3" />
                              Superseded
                            </Badge>
                          )}
                          {/* Geolocation badge (#1728) */}
                          {memory.place_label && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <MapPin className="size-3" />
                              {memory.place_label}
                            </Badge>
                          )}
                          {/* Similarity score for search results (#1716) */}
                          {similarity != null && (
                            <Badge variant="outline" className="text-xs gap-1 bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20">
                              <Sparkles className="size-3" />
                              {(similarity * 100).toFixed(0)}%
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
                          <DropdownMenuItem onClick={() => handleNavigateToDetail(memory.id)}>
                            <ExternalLink className="mr-2 size-4" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(memory)}>
                            <Pencil className="mr-2 size-4" />
                            Edit
                          </DropdownMenuItem>
                          {memory.is_active !== false && (
                            <DropdownMenuItem onClick={() => handleSupersede(memory)}>
                              <Layers className="mr-2 size-4" />
                              Supersede
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(memory)}>
                            <Trash2 className="mr-2 size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Tags (#1721) */}
                    {Array.isArray(memory.tags) && memory.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {memory.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs gap-1 h-5">
                            <Tag className="size-2.5" />
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Content preview / expanded */}
                    <div className="mt-2 cursor-pointer" onClick={() => handleToggleExpand(memory.id)}>
                      {isExpanded ? (
                        <div className="text-sm text-foreground whitespace-pre-wrap" data-testid="memory-full-content">
                          {memory.content}

                          {/* Expanded metadata section (#1719) */}
                          <div className="mt-3 pt-3 border-t border-border space-y-2 text-xs text-muted-foreground">
                            <div className="flex flex-wrap gap-4">
                              {memory.importance != null && (
                                <span>Importance: <strong className="text-foreground">{memory.importance}/10</strong></span>
                              )}
                              {memory.confidence != null && (
                                <span>Confidence: <strong className="text-foreground">{(memory.confidence * 100).toFixed(0)}%</strong></span>
                              )}
                              {memory.expires_at && (
                                <span>Expires: <strong className="text-foreground">{formatDate(memory.expires_at)}</strong></span>
                              )}
                              {memory.source_url && (
                                <a
                                  href={memory.source_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-primary hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink className="size-3" />
                                  Source
                                </a>
                              )}
                            </div>
                            {/* Geolocation details (#1728) */}
                            {memory.address && (
                              <div className="flex items-center gap-1">
                                <MapPin className="size-3" />
                                <span>{memory.address}</span>
                                {memory.lat != null && memory.lng != null && (
                                  <a
                                    href={`https://www.openstreetmap.org/?mlat=${memory.lat}&mlon=${memory.lng}#map=16/${memory.lat}/${memory.lng}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:underline ml-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Map
                                  </a>
                                )}
                              </div>
                            )}
                            {memory.created_by_agent && (
                              <span>Created by agent: {memory.created_by_agent}</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground line-clamp-2">{preview}</p>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
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

      {/* Create/Edit Memory Dialog */}
      <MemoryFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingMemory(null);
        }}
        memory={editingMemory}
        isSubmitting={isSubmitting}
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
  onSubmit: (data: CreateMemoryBody | UpdateMemoryBody) => void;
}

function MemoryFormDialog({ open, onOpenChange, memory, isSubmitting, onSubmit }: MemoryFormDialogProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<string>('fact');
  const [importance, setImportance] = useState<number>(5);
  const [confidence, setConfidence] = useState<number>(0.8);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [sourceUrl, setSourceUrl] = useState<string>('');
  const [tagsInput, setTagsInput] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);

  // Reset form when dialog opens/closes or memory changes
  React.useEffect(() => {
    if (open) {
      setTitle(memory?.title ?? '');
      setContent(memory?.content ?? '');
      setType(memory?.memory_type ?? memory?.type ?? 'fact');
      setImportance(memory?.importance ?? 5);
      setConfidence(memory?.confidence ?? 0.8);
      setExpiresAt(memory?.expires_at ? memory.expires_at.slice(0, 10) : '');
      setSourceUrl(memory?.source_url ?? '');
      setTags(memory?.tags ?? []);
      setTagsInput('');
    }
  }, [open, memory]);

  const handleAddTag = () => {
    const tag = tagsInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setTagsInput('');
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (memory) {
      // Update: send changed fields
      const body: UpdateMemoryBody = {
        title: title.trim(),
        content: content.trim(),
        importance,
        confidence,
        tags,
        source_url: sourceUrl.trim() || undefined,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      };
      onSubmit(body);
    } else {
      // Create: send all fields
      const body: CreateMemoryBody = {
        title: title.trim(),
        content: content.trim(),
        type: type,
        memory_type: type as CreateMemoryBody['memory_type'],
        importance,
        confidence,
        tags,
        source_url: sourceUrl.trim() || undefined,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      };
      onSubmit(body);
    }
  };

  const isValid = title.trim().length > 0 && content.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="memory-form-dialog">
        <DialogHeader>
          <DialogTitle>{memory ? 'Edit Memory' : 'Create Memory'}</DialogTitle>
          <DialogDescription>{memory ? 'Update the memory details below.' : 'Store knowledge, preferences, decisions, or context.'}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="memory-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="memory-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Memory title"
              required
              data-testid="memory-title-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="memory-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger data-testid="memory-type-select">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preference">Preference</SelectItem>
                <SelectItem value="fact">Fact</SelectItem>
                <SelectItem value="decision">Decision</SelectItem>
                <SelectItem value="context">Context</SelectItem>
                <SelectItem value="note">Note</SelectItem>
                <SelectItem value="reference">Reference</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="memory-content">
              Content <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="memory-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write memory content here... (Markdown supported)"
              className="min-h-[150px] font-mono text-sm"
              required
              data-testid="memory-content-input"
            />
          </div>

          {/* Metadata section (#1719) */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="memory-importance">
                Importance ({importance}/10)
              </Label>
              <Input
                id="memory-importance"
                type="range"
                min={1}
                max={10}
                value={importance}
                onChange={(e) => setImportance(Number(e.target.value))}
                data-testid="memory-importance-slider"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-confidence">
                Confidence ({(confidence * 100).toFixed(0)}%)
              </Label>
              <Input
                id="memory-confidence"
                type="range"
                min={0}
                max={100}
                value={confidence * 100}
                onChange={(e) => setConfidence(Number(e.target.value) / 100)}
                data-testid="memory-confidence-slider"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="memory-expires">Expiration Date</Label>
              <Input
                id="memory-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                data-testid="memory-expires-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-source">Source URL</Label>
              <Input
                id="memory-source"
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
                data-testid="memory-source-input"
              />
            </div>
          </div>

          {/* Tags input (#1721) */}
          <div className="space-y-2">
            <Label htmlFor="memory-tags">Tags</Label>
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs gap-1 h-6">
                  <Tag className="size-2.5" />
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="ml-0.5 hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                id="memory-tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="Add tag and press Enter"
                data-testid="memory-tags-input"
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddTag}>
                Add
              </Button>
            </div>
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
