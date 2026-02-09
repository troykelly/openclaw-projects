/**
 * Skill Store viewer page.
 *
 * Admin/debugging page for inspecting skill store data. Provides:
 * - Skill selector dropdown (populated from the admin API)
 * - Collection browser with item counts
 * - Item list view with search and filter by status/tags
 * - Item detail panel showing all fields including formatted JSONB data
 * - Schedule list view with cron, last run, status, enable/disable toggle
 * - Basic operations (delete item, trigger schedule, pause/resume)
 *
 * Uses TanStack Query hooks for data fetching and mutations.
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  Search,
  Package,
  Database,
  Clock,
  Trash2,
  Play,
  Pause,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Tag,
  Calendar,
  X,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { SkillStoreItem, SkillStoreCollection, SkillStoreSchedule, SkillStoreSearchResponse } from '@/ui/lib/api-types';
import { Skeleton, SkeletonList, ErrorState, EmptyState } from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent } from '@/ui/components/ui/card';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Separator } from '@/ui/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs';
import { Switch } from '@/ui/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/ui/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import {
  useSkillStoreSkills,
  useSkillStoreCollections,
  useSkillStoreItems,
  useSkillStoreSchedules,
  useDeleteSkillStoreItem,
  useTriggerSchedule,
  usePauseSchedule,
  useResumeSchedule,
  useSkillStoreSearch,
} from '@/ui/hooks/queries/use-skill-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a date string for display. */
function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Format a relative time from now. */
function formatRelative(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return formatDate(dateStr);
}

/** Get badge color for item status. */
function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20';
    case 'archived':
      return 'bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-500/20';
    case 'processing':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20';
    default:
      return '';
  }
}

/** Get badge color for schedule run status. */
function getRunStatusBadgeClass(status: string | null): string {
  switch (status) {
    case 'success':
      return 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20';
    case 'failed':
      return 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20';
    case 'running':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20';
    default:
      return 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20';
  }
}

/** Header names that contain sensitive values. */
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'x-secret',
  'api-key',
  'token',
  'x-token',
  'cookie',
  'x-auth-token',
  'proxy-authorization',
]);

/** Check if a header name is sensitive. */
function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_HEADER_NAMES.has(lower) || lower.includes('secret') || lower.includes('password');
}

/** Pretty-print JSON with syntax highlighting via simple span coloring. */
function JsonViewer({ data }: { data: unknown }): React.JSX.Element {
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }, [data]);

  return (
    <pre className="text-xs font-mono bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto">{formatted}</pre>
  );
}

/** Display webhook headers with sensitive values redacted by default. */
function HeadersViewer({ headers }: { headers: Record<string, string> }): React.JSX.Element {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={() => setRevealed(!revealed)}
          aria-label={revealed ? 'Hide sensitive header values' : 'Reveal sensitive header values'}
        >
          {revealed ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          {revealed ? 'Hide values' : 'Show values'}
        </Button>
      </div>
      <div className="text-xs font-mono bg-muted/50 rounded-md p-3 space-y-1">
        {Object.entries(headers).map(([name, value]) => (
          <div key={name} className="flex gap-2">
            <span className="text-muted-foreground">{name}:</span>
            <span className="text-foreground">{!revealed && isSensitiveHeader(name) ? '••••••••' : value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkillStorePage
// ---------------------------------------------------------------------------

export function SkillStorePage(): React.JSX.Element {
  const [selectedSkillId, setSelectedSkillId] = useState<string>('');
  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<SkillStoreItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SkillStoreItem | null>(null);
  const [activeTab, setActiveTab] = useState<string>('items');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [itemsOffset, setItemsOffset] = useState(0);
  const ITEMS_PER_PAGE = 50;

  // Data fetching
  const skillsQuery = useSkillStoreSkills();
  const collectionsQuery = useSkillStoreCollections(selectedSkillId);
  const itemsQuery = useSkillStoreItems({
    skillId: selectedSkillId,
    collection: selectedCollection || undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
    limit: ITEMS_PER_PAGE,
    offset: itemsOffset,
  });
  const schedulesQuery = useSkillStoreSchedules(selectedSkillId);

  // Mutations
  const deleteItemMutation = useDeleteSkillStoreItem();
  const triggerScheduleMutation = useTriggerSchedule();
  const pauseScheduleMutation = usePauseSchedule();
  const resumeScheduleMutation = useResumeSchedule();
  const searchMutation = useSkillStoreSearch();

  // Auto-select first skill when skills load
  React.useEffect(() => {
    if (skillsQuery.data?.skills?.length && !selectedSkillId) {
      setSelectedSkillId(skillsQuery.data.skills[0].skill_id);
    }
  }, [skillsQuery.data?.skills, selectedSkillId]);

  // Stable ref to searchMutation to avoid unstable deps in useCallback
  const searchMutationRef = useRef(searchMutation);
  searchMutationRef.current = searchMutation;

  // Items to display: search results or regular items
  const searchData = searchMutation.data;
  const displayItems = useMemo(() => {
    if (activeSearch && searchData) {
      return searchData.items;
    }
    return itemsQuery.data?.items ?? [];
  }, [activeSearch, searchData, itemsQuery.data?.items]);

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim() || !selectedSkillId) {
      setActiveSearch('');
      return;
    }
    setActiveSearch(searchQuery.trim());
    setMutationError(null);
    searchMutationRef.current.mutate({
      skill_id: selectedSkillId,
      query: searchQuery.trim(),
      collection: selectedCollection || undefined,
      limit: 50,
    });
  }, [searchQuery, selectedSkillId, selectedCollection]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setActiveSearch('');
  }, []);

  const handleItemClick = useCallback((item: SkillStoreItem) => {
    setSelectedItem(item);
    setDetailOpen(true);
  }, []);

  const handleDeleteItem = useCallback(
    async (item: SkillStoreItem) => {
      setMutationError(null);
      try {
        await deleteItemMutation.mutateAsync(item.id);
        setDeleteTarget(null);
        if (selectedItem?.id === item.id) {
          setDetailOpen(false);
          setSelectedItem(null);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setMutationError(`Failed to delete item: ${msg}`);
      }
    },
    [deleteItemMutation, selectedItem],
  );

  const handleTriggerSchedule = useCallback(
    async (schedule: SkillStoreSchedule) => {
      setMutationError(null);
      try {
        await triggerScheduleMutation.mutateAsync(schedule.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setMutationError(`Failed to trigger schedule: ${msg}`);
      }
    },
    [triggerScheduleMutation],
  );

  const handleToggleSchedule = useCallback(
    async (schedule: SkillStoreSchedule) => {
      setMutationError(null);
      try {
        if (schedule.enabled) {
          await pauseScheduleMutation.mutateAsync(schedule.id);
        } else {
          await resumeScheduleMutation.mutateAsync(schedule.id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setMutationError(`Failed to toggle schedule: ${msg}`);
      }
    },
    [pauseScheduleMutation, resumeScheduleMutation],
  );

  const handleSkillChange = useCallback((skillId: string) => {
    setSelectedSkillId(skillId);
    setSelectedCollection('');
    setActiveSearch('');
    setSearchQuery('');
    setStatusFilter('all');
    setItemsOffset(0);
    setMutationError(null);
  }, []);

  const handleCollectionChange = useCallback((value: string) => {
    setSelectedCollection(value === 'all' ? '' : value);
    setActiveSearch('');
    setSearchQuery('');
    setItemsOffset(0);
  }, []);

  // Loading state
  if (skillsQuery.isLoading) {
    return (
      <div data-testid="page-skill-store" className="p-6">
        <div className="mb-6">
          <Skeleton width={250} height={32} />
          <Skeleton width={180} height={20} className="mt-2" />
        </div>
        <Skeleton width="100%" height={40} className="mb-4" />
        <SkeletonList count={5} variant="card" />
      </div>
    );
  }

  // Error state
  if (skillsQuery.isError) {
    return (
      <div data-testid="page-skill-store" className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load Skill Store"
          description={skillsQuery.error instanceof Error ? skillsQuery.error.message : 'Unknown error'}
          onRetry={() => skillsQuery.refetch()}
        />
      </div>
    );
  }

  const skills = skillsQuery.data?.skills ?? [];
  const collections = collectionsQuery.data?.collections ?? [];
  const schedules = schedulesQuery.data?.schedules ?? [];
  const totalItems = activeSearch ? (searchData?.total ?? 0) : (itemsQuery.data?.total ?? 0);

  return (
    <TooltipProvider delayDuration={300}>
      <div data-testid="page-skill-store" className="p-6 h-full flex flex-col">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <Package className="size-6" />
              Skill Store
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Inspect and manage skill store data, collections, and schedules.</p>
          </div>
        </div>

        {/* Skill Selector */}
        {skills.length === 0 ? (
          <Card>
            <CardContent className="p-8">
              <EmptyState
                variant="documents"
                title="No skills registered"
                description="No skills have stored data yet. Skills will appear here once they write data to the skill store."
              />
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select value={selectedSkillId} onValueChange={handleSkillChange}>
                <SelectTrigger className="w-[280px]" data-testid="skill-selector">
                  <Database className="mr-2 size-4 text-muted-foreground" />
                  <SelectValue placeholder="Select a skill" />
                </SelectTrigger>
                <SelectContent>
                  {skills.map((skill) => (
                    <SelectItem key={skill.skill_id} value={skill.skill_id}>
                      <span className="flex items-center gap-2">
                        {skill.skill_id}
                        <Badge variant="secondary" className="text-xs ml-1">
                          {skill.item_count} items
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedSkillId && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {skills.find((s) => s.skill_id === selectedSkillId) && (
                    <>
                      <span>{skills.find((s) => s.skill_id === selectedSkillId)?.collection_count ?? 0} collections</span>
                      <span className="text-border">|</span>
                      <span>Last activity: {formatRelative(skills.find((s) => s.skill_id === selectedSkillId)?.last_activity)}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {selectedSkillId && (
              <>
                {/* Mutation error banner */}
                {mutationError && (
                  <div
                    className="mb-3 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                    role="alert"
                    data-testid="mutation-error-banner"
                  >
                    <AlertCircle className="size-4 shrink-0" />
                    <span className="flex-1">{mutationError}</span>
                    <button onClick={() => setMutationError(null)} className="shrink-0 text-destructive/70 hover:text-destructive" aria-label="Dismiss error">
                      <X className="size-4" />
                    </button>
                  </div>
                )}

                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
                  <TabsList>
                    <TabsTrigger value="items" data-testid="tab-items">
                      <Package className="mr-1.5 size-4" />
                      Items ({totalItems})
                    </TabsTrigger>
                    <TabsTrigger value="collections" data-testid="tab-collections">
                      <Database className="mr-1.5 size-4" />
                      Collections ({collections.length})
                    </TabsTrigger>
                    <TabsTrigger value="schedules" data-testid="tab-schedules">
                      <Clock className="mr-1.5 size-4" />
                      Schedules ({schedules.length})
                    </TabsTrigger>
                  </TabsList>

                  {/* Items Tab */}
                  <TabsContent value="items" className="flex-1 flex flex-col min-h-0">
                    <ItemsPanel
                      items={displayItems}
                      totalItems={totalItems}
                      collections={collections}
                      selectedCollection={selectedCollection}
                      statusFilter={statusFilter}
                      searchQuery={searchQuery}
                      activeSearch={activeSearch}
                      isLoading={itemsQuery.isLoading || searchMutation.isPending}
                      isError={itemsQuery.isError}
                      error={itemsQuery.error}
                      offset={itemsOffset}
                      pageSize={ITEMS_PER_PAGE}
                      onPageChange={setItemsOffset}
                      onCollectionChange={handleCollectionChange}
                      onStatusChange={setStatusFilter}
                      onSearchChange={setSearchQuery}
                      onSearch={handleSearch}
                      onClearSearch={handleClearSearch}
                      onItemClick={handleItemClick}
                      onDeleteItem={(item) => setDeleteTarget(item)}
                      onRefetch={() => itemsQuery.refetch()}
                    />
                  </TabsContent>

                  {/* Collections Tab */}
                  <TabsContent value="collections" className="flex-1 flex flex-col min-h-0">
                    <CollectionsPanel
                      collections={collections}
                      isLoading={collectionsQuery.isLoading}
                      isError={collectionsQuery.isError}
                      error={collectionsQuery.error}
                      onRefetch={() => collectionsQuery.refetch()}
                      onCollectionClick={(name) => {
                        setSelectedCollection(name);
                        setItemsOffset(0);
                        setActiveTab('items');
                      }}
                    />
                  </TabsContent>

                  {/* Schedules Tab */}
                  <TabsContent value="schedules" className="flex-1 flex flex-col min-h-0">
                    <SchedulesPanel
                      schedules={schedules}
                      isLoading={schedulesQuery.isLoading}
                      isError={schedulesQuery.isError}
                      error={schedulesQuery.error}
                      onRefetch={() => schedulesQuery.refetch()}
                      onTrigger={handleTriggerSchedule}
                      onToggle={handleToggleSchedule}
                      isTriggerPending={triggerScheduleMutation.isPending}
                      isTogglePending={pauseScheduleMutation.isPending || resumeScheduleMutation.isPending}
                    />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </>
        )}

        {/* Item Detail Dialog */}
        <ItemDetailDialog
          item={selectedItem}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onDelete={(item) => {
            setDetailOpen(false);
            setDeleteTarget(item);
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
              <DialogTitle>Delete Item</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete &quot;{deleteTarget?.title ?? deleteTarget?.key}&quot;? This performs a soft delete.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteTarget && handleDeleteItem(deleteTarget)}
                disabled={deleteItemMutation.isPending}
                data-testid="confirm-delete-button"
              >
                {deleteItemMutation.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// ItemsPanel
// ---------------------------------------------------------------------------

interface ItemsPanelProps {
  items: SkillStoreItem[];
  totalItems: number;
  collections: SkillStoreCollection[];
  selectedCollection: string;
  statusFilter: string;
  searchQuery: string;
  activeSearch: string;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  offset: number;
  pageSize: number;
  onPageChange: (offset: number) => void;
  onCollectionChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onItemClick: (item: SkillStoreItem) => void;
  onDeleteItem: (item: SkillStoreItem) => void;
  onRefetch: () => void;
}

function ItemsPanel({
  items,
  totalItems,
  collections,
  selectedCollection,
  statusFilter,
  searchQuery,
  activeSearch,
  isLoading,
  isError,
  error,
  offset,
  pageSize,
  onPageChange,
  onCollectionChange,
  onStatusChange,
  onSearchChange,
  onSearch,
  onClearSearch,
  onItemClick,
  onDeleteItem,
  onRefetch,
}: ItemsPanelProps) {
  if (isError) {
    return (
      <ErrorState type="generic" title="Failed to load items" description={error instanceof Error ? error.message : 'Unknown error'} onRetry={onRefetch} />
    );
  }

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search items (full-text)..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch();
            }}
            className="pl-9 pr-8"
            data-testid="item-search-input"
          />
          {activeSearch && (
            <button
              onClick={onClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Collection filter */}
        <Select value={selectedCollection || 'all'} onValueChange={onCollectionChange}>
          <SelectTrigger className="w-[180px]" data-testid="collection-filter">
            <SelectValue placeholder="All collections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All collections</SelectItem>
            {collections.map((c) => (
              <SelectItem key={c.collection} value={c.collection}>
                {c.collection} ({c.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={onStatusChange}>
          <SelectTrigger className="w-[140px]" data-testid="status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
          </SelectContent>
        </Select>

        {activeSearch && (
          <Badge variant="secondary" className="gap-1">
            <Search className="size-3" />
            Searching: &quot;{activeSearch}&quot;
          </Badge>
        )}
      </div>

      {/* Item List */}
      {isLoading ? (
        <SkeletonList count={5} variant="card" />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              variant="documents"
              title={activeSearch ? 'No search results' : 'No items found'}
              description={activeSearch ? 'Try a different search query.' : 'No items match the current filters.'}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <ScrollArea className="flex-1">
            <div className="space-y-2" data-testid="item-list">
              {items.map((item) => (
                <Card
                  key={item.id}
                  data-testid="skill-store-item-card"
                  className="group cursor-pointer transition-colors hover:bg-accent/30"
                  role="button"
                  tabIndex={0}
                  aria-label={`View item: ${item.title || item.key}`}
                  onClick={() => onItemClick(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onItemClick(item);
                    }
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="outline" className={`text-xs ${getStatusBadgeClass(item.status)}`}>
                            {item.status}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {item.collection}
                          </Badge>
                          {item.pinned && (
                            <Badge variant="secondary" className="text-xs bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/20">
                              pinned
                            </Badge>
                          )}
                          {item.priority > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              P{item.priority}
                            </Badge>
                          )}
                        </div>
                        <h3 className="font-medium text-foreground leading-tight">{item.title || item.key}</h3>
                        {item.summary && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.summary}</p>}
                        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="font-mono">{item.key}</span>
                          {item.tags.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Tag className="size-3" />
                              {item.tags.slice(0, 3).join(', ')}
                              {item.tags.length > 3 && ` +${item.tags.length - 3}`}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar className="size-3" />
                            {formatRelative(item.updated_at)}
                          </span>
                        </div>
                      </div>

                      {/* Delete button */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 opacity-0 group-hover:opacity-100 shrink-0 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteItem(item);
                            }}
                            data-testid="item-delete-button"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete item</TooltipContent>
                      </Tooltip>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>

          {/* Pagination controls */}
          {!activeSearch && totalItems > pageSize && (
            <div className="flex items-center justify-between pt-3 border-t" data-testid="pagination-controls">
              <span className="text-sm text-muted-foreground">
                Showing {offset + 1}&ndash;{Math.min(offset + pageSize, totalItems)} of {totalItems}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => onPageChange(Math.max(0, offset - pageSize))}
                  aria-label="Previous page"
                  data-testid="pagination-prev"
                >
                  <ChevronLeft className="size-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + pageSize >= totalItems}
                  onClick={() => onPageChange(offset + pageSize)}
                  aria-label="Next page"
                  data-testid="pagination-next"
                >
                  Next
                  <ChevronRight className="size-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollectionsPanel
// ---------------------------------------------------------------------------

interface CollectionsPanelProps {
  collections: SkillStoreCollection[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onRefetch: () => void;
  onCollectionClick: (name: string) => void;
}

function CollectionsPanel({ collections, isLoading, isError, error, onRefetch, onCollectionClick }: CollectionsPanelProps) {
  if (isError) {
    return (
      <ErrorState
        type="generic"
        title="Failed to load collections"
        description={error instanceof Error ? error.message : 'Unknown error'}
        onRetry={onRefetch}
      />
    );
  }

  if (isLoading) {
    return <SkeletonList count={4} variant="card" />;
  }

  if (collections.length === 0) {
    return (
      <Card>
        <CardContent className="p-8">
          <EmptyState variant="documents" title="No collections" description="This skill has no collections yet." />
        </CardContent>
      </Card>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="collections-grid">
        {collections.map((col) => (
          <Card
            key={col.collection}
            className="cursor-pointer transition-colors hover:bg-accent/30"
            role="button"
            tabIndex={0}
            aria-label={`View collection: ${col.collection} (${col.count} items)`}
            onClick={() => onCollectionClick(col.collection)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onCollectionClick(col.collection);
              }
            }}
            data-testid="collection-card"
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-foreground">{col.collection}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {col.count} item{col.count !== 1 ? 's' : ''}
                  </p>
                </div>
                <Database className="size-5 text-muted-foreground" />
              </div>
              {col.latest_at && (
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                  <Calendar className="size-3" />
                  Latest: {formatRelative(col.latest_at)}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// SchedulesPanel
// ---------------------------------------------------------------------------

interface SchedulesPanelProps {
  schedules: SkillStoreSchedule[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onRefetch: () => void;
  onTrigger: (schedule: SkillStoreSchedule) => void;
  onToggle: (schedule: SkillStoreSchedule) => void;
  isTriggerPending: boolean;
  isTogglePending: boolean;
}

function SchedulesPanel({ schedules, isLoading, isError, error, onRefetch, onTrigger, onToggle, isTriggerPending, isTogglePending }: SchedulesPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isError) {
    return (
      <ErrorState type="generic" title="Failed to load schedules" description={error instanceof Error ? error.message : 'Unknown error'} onRetry={onRefetch} />
    );
  }

  if (isLoading) {
    return <SkeletonList count={3} variant="card" />;
  }

  if (schedules.length === 0) {
    return (
      <Card>
        <CardContent className="p-8">
          <EmptyState variant="documents" title="No schedules" description="This skill has no scheduled jobs." />
        </CardContent>
      </Card>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-2" data-testid="schedules-list">
        {schedules.map((schedule) => {
          const isExpanded = expandedId === schedule.id;
          return (
            <Card key={schedule.id} data-testid="schedule-card">
              <CardContent className="p-4">
                {/* Header Row */}
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} schedule: ${schedule.cron_expression}`}
                    onClick={() => setExpandedId(isExpanded ? null : schedule.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedId(isExpanded ? null : schedule.id);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{schedule.cron_expression}</code>
                      {schedule.collection && (
                        <Badge variant="secondary" className="text-xs">
                          {schedule.collection}
                        </Badge>
                      )}
                      <Badge variant="outline" className={`text-xs ${getRunStatusBadgeClass(schedule.last_run_status)}`}>
                        {schedule.last_run_status ?? 'never run'}
                      </Badge>
                      {!schedule.enabled && (
                        <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20">
                          paused
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      TZ: {schedule.timezone}
                      {schedule.last_run_at && ` | Last run: ${formatRelative(schedule.last_run_at)}`}
                      {schedule.next_run_at && ` | Next: ${formatDate(schedule.next_run_at)}`}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => onTrigger(schedule)}
                          disabled={isTriggerPending}
                          data-testid="trigger-schedule-button"
                        >
                          <Play className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Trigger now</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5">
                          <Switch
                            checked={schedule.enabled}
                            onCheckedChange={() => onToggle(schedule)}
                            disabled={isTogglePending}
                            data-testid="schedule-toggle"
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{schedule.enabled ? 'Pause schedule' : 'Resume schedule'}</TooltipContent>
                    </Tooltip>

                    <button
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : schedule.id)}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? 'Collapse schedule details' : 'Expand schedule details'}
                    >
                      {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Webhook URL</p>
                        <p className="text-foreground break-all font-mono text-xs">{schedule.webhook_url}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Max Retries</p>
                        <p className="text-foreground">{schedule.max_retries}</p>
                      </div>
                    </div>
                    {schedule.webhook_headers && Object.keys(schedule.webhook_headers).length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Headers</p>
                        <HeadersViewer headers={schedule.webhook_headers as Record<string, string>} />
                      </div>
                    )}
                    {schedule.payload_template && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Payload Template</p>
                        <JsonViewer data={schedule.payload_template} />
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground flex gap-3">
                      <span>Created: {formatDate(schedule.created_at)}</span>
                      <span>Updated: {formatDate(schedule.updated_at)}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// ItemDetailDialog
// ---------------------------------------------------------------------------

interface ItemDetailDialogProps {
  item: SkillStoreItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (item: SkillStoreItem) => void;
}

function ItemDetailDialog({ item, open, onOpenChange, onDelete }: ItemDetailDialogProps) {
  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="item-detail-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {item.title || item.key}
            <Badge variant="outline" className={`text-xs ${getStatusBadgeClass(item.status)}`}>
              {item.status}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{item.skill_id}</span> / <span className="font-mono">{item.collection}</span> /{' '}
            <span className="font-mono">{item.key}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">ID</p>
              <p className="text-foreground font-mono text-xs break-all">{item.id}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Priority</p>
              <p className="text-foreground">{item.priority}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Created</p>
              <p className="text-foreground">{formatDate(item.created_at)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Updated</p>
              <p className="text-foreground">{formatDate(item.updated_at)}</p>
            </div>
            {item.user_email && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">User</p>
                <p className="text-foreground">{item.user_email}</p>
              </div>
            )}
            {item.created_by && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Created By</p>
                <p className="text-foreground">{item.created_by}</p>
              </div>
            )}
            {item.embedding_status && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Embedding</p>
                <Badge variant="secondary" className="text-xs">
                  {item.embedding_status}
                </Badge>
              </div>
            )}
            {item.expires_at && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Expires</p>
                <p className="text-foreground">{formatDate(item.expires_at)}</p>
              </div>
            )}
          </div>

          <Separator />

          {/* Tags */}
          {item.tags.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    <Tag className="size-3 mr-1" />
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          {item.summary && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Summary</p>
              <p className="text-sm text-foreground">{item.summary}</p>
            </div>
          )}

          {/* Content */}
          {item.content && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Content</p>
              <div className="text-sm text-foreground bg-muted/30 rounded-md p-3 whitespace-pre-wrap max-h-[200px] overflow-y-auto">{item.content}</div>
            </div>
          )}

          {/* JSONB Data */}
          {item.data !== null && item.data !== undefined && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Data (JSONB)</p>
              <JsonViewer data={item.data} />
            </div>
          )}

          {/* Media / Source URLs */}
          {(item.media_url || item.source_url) && (
            <div className="flex flex-col gap-2">
              {item.media_url && (
                <div className="flex items-center gap-2 text-sm">
                  <ExternalLink className="size-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Media:</span>
                  <a href={item.media_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all text-xs">
                    {item.media_url}
                  </a>
                  {item.media_type && (
                    <Badge variant="secondary" className="text-xs">
                      {item.media_type}
                    </Badge>
                  )}
                </div>
              )}
              {item.source_url && (
                <div className="flex items-center gap-2 text-sm">
                  <ExternalLink className="size-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Source:</span>
                  <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all text-xs">
                    {item.source_url}
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="destructive" onClick={() => onDelete(item)}>
            <Trash2 className="mr-2 size-4" />
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
