import * as React from 'react';
import { Plus, FileText, Link2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { MemoryCard } from './memory-card';
import type { MemoryItem } from './types';

export interface ItemMemoriesProps {
  memories: MemoryItem[];
  onMemoryClick?: (memory: MemoryItem) => void;
  onAddMemory?: () => void;
  onLinkMemory?: () => void;
  onEditMemory?: (memory: MemoryItem) => void;
  onDeleteMemory?: (memory: MemoryItem) => void;
  className?: string;
}

export function ItemMemories({ memories, onMemoryClick, onAddMemory, onLinkMemory, onEditMemory, onDeleteMemory, className }: ItemMemoriesProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Memories</h3>
          <Badge variant="secondary" className="text-xs">
            {memories.length}
          </Badge>
        </div>

        <div className="flex gap-1">
          {onLinkMemory && (
            <Button variant="ghost" size="sm" onClick={onLinkMemory}>
              <Link2 className="mr-1 size-3" />
              Link
            </Button>
          )}
          {onAddMemory && (
            <Button variant="ghost" size="sm" onClick={onAddMemory}>
              <Plus className="mr-1 size-3" />
              Add
            </Button>
          )}
        </div>
      </div>

      {/* Memory list */}
      {memories.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {memories.map((memory) => (
            <MemoryCard key={memory.id} memory={memory} onClick={onMemoryClick} onEdit={onEditMemory} onDelete={onDeleteMemory} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <FileText className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">No memories attached</p>
          {(onAddMemory || onLinkMemory) && (
            <div className="mt-3 flex justify-center gap-2">
              {onAddMemory && (
                <Button variant="outline" size="sm" onClick={onAddMemory}>
                  <Plus className="mr-1 size-3" />
                  Create new
                </Button>
              )}
              {onLinkMemory && (
                <Button variant="outline" size="sm" onClick={onLinkMemory}>
                  <Link2 className="mr-1 size-3" />
                  Link existing
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
