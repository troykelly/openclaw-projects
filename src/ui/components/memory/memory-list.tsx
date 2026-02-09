import * as React from 'react';
import { useState, useMemo } from 'react';
import { Search, Plus, FileText } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { MemoryCard } from './memory-card';
import type { MemoryItem, MemoryFilter } from './types';

export interface MemoryListProps {
  memories: MemoryItem[];
  onMemoryClick?: (memory: MemoryItem) => void;
  onAddMemory?: () => void;
  onEditMemory?: (memory: MemoryItem) => void;
  onDeleteMemory?: (memory: MemoryItem) => void;
  className?: string;
}

export function MemoryList({ memories, onMemoryClick, onAddMemory, onEditMemory, onDeleteMemory, className }: MemoryListProps) {
  const [filter, setFilter] = useState<MemoryFilter>({});

  const filteredMemories = useMemo(() => {
    let result = memories;

    if (filter.search?.trim()) {
      const query = filter.search.toLowerCase();
      result = result.filter(
        (m) => m.title.toLowerCase().includes(query) || m.content.toLowerCase().includes(query) || m.tags?.some((t) => t.toLowerCase().includes(query)),
      );
    }

    if (filter.linkedItemKind) {
      result = result.filter((m) => m.linkedItemKind === filter.linkedItemKind);
    }

    return result;
  }, [memories, filter]);

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

      {/* Filters */}
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
          value={filter.linkedItemKind ?? 'all'}
          onValueChange={(v) =>
            setFilter((prev) => ({
              ...prev,
              linkedItemKind: v === 'all' ? undefined : (v as MemoryFilter['linkedItemKind']),
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
              <p className="mt-4 text-muted-foreground">{filter.search || filter.linkedItemKind ? 'No memories found' : 'No memories yet'}</p>
              {!filter.search && !filter.linkedItemKind && onAddMemory && (
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
