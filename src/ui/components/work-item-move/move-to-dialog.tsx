import * as React from 'react';
import { useState, useMemo } from 'react';
import { Search, FolderTree, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Badge } from '@/ui/components/ui/badge';
import { cn } from '@/ui/lib/utils';
import { canMoveToParent, getValidParentKinds } from './hierarchy-validation';
import type { MoveToDialogProps, PotentialParent } from './types';
import type { TreeItemKind } from '@/ui/components/tree/types';

const kindIcons: Record<TreeItemKind, string> = {
  project: '📁',
  initiative: '🎯',
  epic: '📚',
  issue: '📄',
};

const kindColors: Record<TreeItemKind, string> = {
  project: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  initiative: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
  epic: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  issue: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
};

export function MoveToDialog({ open, onOpenChange, item, items, potentialParents, onMove, isMoving }: MoveToDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);

  const isBulk = items && items.length > 0;
  const movingItem = item;
  const itemKind = movingItem?.kind;
  const currentParentId = movingItem?.currentParentId;

  // Filter parents based on hierarchy rules and search
  const filteredParents = useMemo(() => {
    if (!itemKind) return [];

    const validKinds = getValidParentKinds(itemKind);

    return potentialParents.filter((parent) => {
      // Must be a valid kind
      if (!validKinds.includes(parent.kind)) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return parent.title.toLowerCase().includes(query);
      }

      return true;
    });
  }, [potentialParents, itemKind, searchQuery]);

  const handleSelect = (parent_id: string) => {
    setSelectedParentId(parent_id);
  };

  const handleMove = () => {
    if (selectedParentId !== null) {
      onMove(selectedParentId);
    }
  };

  const handleCancel = () => {
    setSearchQuery('');
    setSelectedParentId(null);
    onOpenChange(false);
  };

  // Reset state when dialog opens/closes
  React.useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setSelectedParentId(null);
    }
  }, [open]);

  const getTitle = () => {
    if (isBulk) {
      return `Move ${items.length} items`;
    }
    return `Move "${movingItem?.title}"`;
  };

  const getDescription = () => {
    if (isBulk) {
      return `Select a new parent for ${items.length} items.`;
    }
    if (movingItem?.currentParentTitle) {
      return `Currently under "${movingItem.currentParentTitle}". Select a new parent.`;
    }
    return 'Select a new parent for this item.';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
          <DialogDescription>{getDescription()}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search parents..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
          </div>

          {/* Parent list */}
          <ScrollArea className="h-64">
            <div className="space-y-1">
              {filteredParents.map((parent) => {
                const isCurrent = parent.id === currentParentId;
                const isSelected = parent.id === selectedParentId;

                return (
                  <button
                    key={parent.id}
                    data-current={isCurrent ? 'true' : undefined}
                    onClick={() => handleSelect(parent.id)}
                    disabled={isCurrent || isMoving}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      isSelected && 'bg-primary/10 ring-1 ring-primary',
                      isCurrent && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <span className="text-lg">{kindIcons[parent.kind]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{parent.title}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className={cn('text-xs', kindColors[parent.kind])}>
                          {parent.kind}
                        </Badge>
                        {isCurrent && <span className="text-xs text-muted-foreground">(current)</span>}
                      </div>
                    </div>
                    {isSelected && <ChevronRight className="size-4 text-primary" />}
                  </button>
                );
              })}

              {filteredParents.length === 0 && (
                <div className="py-8 text-center text-muted-foreground">
                  <FolderTree className="mx-auto mb-2 size-8 opacity-50" />
                  <p className="text-sm">{searchQuery ? 'No matching parents found' : 'No valid parents available'}</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isMoving}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={selectedParentId === null || isMoving}>
            {isMoving ? 'Moving...' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
