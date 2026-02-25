/**
 * Floating action bar for bulk memory operations.
 * Issue #1750: Memory bulk operations
 */
import * as React from 'react';
import { Trash2, Tag, X } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';

export interface BulkMemoryActionBarProps {
  selectedCount: number;
  onDelete: () => void;
  onUpdateType: (type: string) => void;
  onClearSelection: () => void;
}

export function BulkMemoryActionBar({ selectedCount, onDelete, onUpdateType, onClearSelection }: BulkMemoryActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      data-testid="bulk-action-bar"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg"
    >
      <span className="text-sm font-medium">
        {selectedCount} selected
      </span>

      <Select onValueChange={onUpdateType}>
        <SelectTrigger className="w-[140px] h-8" data-testid="bulk-update-type">
          <Tag className="mr-1 size-3" />
          <SelectValue placeholder="Update Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="preference">Preference</SelectItem>
          <SelectItem value="fact">Fact</SelectItem>
          <SelectItem value="decision">Decision</SelectItem>
          <SelectItem value="context">Context</SelectItem>
        </SelectContent>
      </Select>

      <Button variant="destructive" size="sm" onClick={onDelete} data-testid="bulk-delete">
        <Trash2 className="mr-1 size-3" />
        Delete
      </Button>

      <Button variant="ghost" size="icon" className="size-7" onClick={onClearSelection} data-testid="clear-selection">
        <X className="size-4" />
      </Button>
    </div>
  );
}
