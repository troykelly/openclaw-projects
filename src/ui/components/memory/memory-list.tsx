import * as React from 'react';
import { useState, useMemo, useCallback } from 'react';
import { Search, Plus, FileText } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { MemoryCard } from './memory-card';
import type { MemoryItem, MemoryFilter, MemoryLifecycleFilter, MemorySortOption } from './types';

const LIFECYCLE_FILTERS: { value: MemoryLifecycleFilter; label: string }[] = [
  { value: 'ephemeral', label: 'Ephemeral' },
  { value: 'permanent', label: 'Permanent' },
  { value: 'expired', label: 'Expired' },
  { value: 'pinned', label: 'Pinned' },
  { value: 'superseded', label: 'Superseded' },
];

/** Check if a memory matches a lifecycle filter. */
function matchesLifecycleFilter(m: MemoryItem, f: MemoryLifecycleFilter): boolean {
  switch (f) {
    case 'ephemeral':
      return m.expires_at != null && m.is_active !== false;
    case 'permanent':
      return m.expires_at == null && m.is_active !== false;
    case 'expired':
      return m.is_active === false;
    case 'pinned':
      return m.pinned === true;
    case 'superseded':
      return m.superseded_by != null;
  }
}

export interface MemoryListProps {
  memories: MemoryItem[];
  onMemoryClick?: (memory: MemoryItem) => void;
  onAddMemory?: () => void;
  onEditMemory?: (memory: MemoryItem) => void;
  onDeleteMemory?: (memory: MemoryItem) => void;
  onBulkSupersede?: (memoryIds: string[], targetId: string) => void;
  className?: string;
}

export function MemoryList({ memories, onMemoryClick, onAddMemory, onEditMemory, onDeleteMemory, className }: MemoryListProps) {
  const [filter, setFilter] = useState<MemoryFilter>({});
  const [sortBy, setSortBy] = useState<MemorySortOption>('updated_at');

  const toggleLifecycleFilter = useCallback((value: MemoryLifecycleFilter) => {
    setFilter((prev) => {
      const current = prev.lifecycle ?? [];
      const next = current.includes(value) ? current.filter((f) => f !== value) : [...current, value];
      return { ...prev, lifecycle: next.length > 0 ? next : undefined };
    });
  }, []);

  const filteredMemories = useMemo(() => {
    let result = memories;

    if (filter.search?.trim()) {
      const query = filter.search.toLowerCase();
      result = result.filter(
        (m) => m.title.toLowerCase().includes(query) || m.content.toLowerCase().includes(query) || m.tags?.some((t) => t.toLowerCase().includes(query)),
      );
    }

    if (filter.linked_item_kind) {
      result = result.filter((m) => m.linked_item_kind === filter.linked_item_kind);
    }

    // Lifecycle filters (union — match any active filter)
    if (filter.lifecycle && filter.lifecycle.length > 0) {
      result = result.filter((m) => filter.lifecycle!.some((f) => matchesLifecycleFilter(m, f)));
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'expiring_soonest': {
          const aExp = a.expires_at ? new Date(a.expires_at).getTime() : Infinity;
          const bExp = b.expires_at ? new Date(b.expires_at).getTime() : Infinity;
          return aExp - bExp;
        }
        case 'recently_superseded': {
          const aHas = a.superseded_by ? 1 : 0;
          const bHas = b.superseded_by ? 1 : 0;
          if (aHas !== bHas) return bHas - aHas;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        }
        case 'created_at':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'updated_at':
        default:
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
    });

    return result;
  }, [memories, filter, sortBy]);

  const hasActiveFilters = !!(filter.search || filter.linked_item_kind || (filter.lifecycle && filter.lifecycle.length > 0));

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Memory Items</h2>
        {onAddMemory && (
          <Button size="sm" onClick={onAddMemory}>
            <Plus className="mr-1 size-4" />
            Add Memory
          </Button>
        )}
      </div>

      {/* Search + type filter */}
      <div className="flex gap-2 border-b p-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter.search ?? ''}
            onChange={(e) => setFilter((prev) => ({ ...prev, search: e.target.value }))}
            placeholder="Search memories..."
            className="pl-9"
          />
        </div>
        <Select
          value={filter.linked_item_kind ?? 'all'}
          onValueChange={(v) =>
            setFilter((prev) => ({
              ...prev,
              linked_item_kind: v === 'all' ? undefined : (v as MemoryFilter['linked_item_kind']),
            }))
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="project">Projects</SelectItem>
            <SelectItem value="initiative">Initiatives</SelectItem>
            <SelectItem value="epic">Epics</SelectItem>
            <SelectItem value="issue">Issues</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as MemorySortOption)}>
          <SelectTrigger className="w-[160px]" aria-label="Sort memories">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated_at">Updated</SelectItem>
            <SelectItem value="created_at">Created</SelectItem>
            <SelectItem value="expiring_soonest">Expiring soonest</SelectItem>
            <SelectItem value="recently_superseded">Recently superseded</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lifecycle filter chips */}
      <div className="flex flex-wrap gap-2 border-b px-4 py-2" role="group" aria-label="Memory lifecycle filters">
        {LIFECYCLE_FILTERS.map(({ value, label }) => {
          const active = filter.lifecycle?.includes(value) ?? false;
          return (
            <Button
              key={value}
              variant={active ? 'default' : 'outline'}
              size="sm"
              onClick={() => toggleLifecycleFilter(value)}
              aria-pressed={active}
            >
              {label}
            </Button>
          );
        })}
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMemories.map((memory) => (
            <MemoryCard key={memory.id} memory={memory} onClick={onMemoryClick} onEdit={onEditMemory} onDelete={onDeleteMemory} />
          ))}

          {filteredMemories.length === 0 && (
            <div className="col-span-full py-12 text-center">
              <FileText className="mx-auto size-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground">{hasActiveFilters ? 'No memories found' : 'No memories yet'}</p>
              {!hasActiveFilters && onAddMemory && (
                <Button variant="outline" size="sm" className="mt-4" onClick={onAddMemory}>
                  Create your first memory
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
