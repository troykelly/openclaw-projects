/**
 * Dialog for adding dependencies between work items
 * Issue #390: Implement dependency creation UI
 */
import * as React from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Folder, Target, Layers, FileText, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Badge } from '@/ui/components/ui/badge';
import { cn } from '@/ui/lib/utils';
import type { WorkItemKind, WorkItemStatus } from '@/ui/components/detail/types';
import type { DependencyType, DependencyDirection, WorkItemSummary, CreateDependencyParams } from './types';
import { detectCircularDependency, getDependencyTypeLabel, getDependencyTypeDescription, isValidDependency, type DependencyGraph } from './dependency-utils';

export interface AddDependencyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceItemId: string;
  sourceItemTitle: string;
  availableItems: WorkItemSummary[];
  existingDependencyIds: string[];
  onAddDependency: (params: CreateDependencyParams) => void;
  dependencyGraph: DependencyGraph;
  initialDirection?: DependencyDirection;
}

const DEPENDENCY_TYPES: DependencyType[] = ['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'];

function getKindIcon(kind: WorkItemKind) {
  switch (kind) {
    case 'project':
      return <Folder className="size-4" />;
    case 'initiative':
      return <Target className="size-4" />;
    case 'epic':
      return <Layers className="size-4" />;
    case 'issue':
      return <FileText className="size-4" />;
  }
}

function getStatusVariant(status: WorkItemStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'in_progress':
      return 'default';
    case 'done':
      return 'secondary';
    case 'blocked':
      return 'destructive';
    default:
      return 'outline';
  }
}

function getStatusLabel(status: WorkItemStatus): string {
  return status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AddDependencyDialog({
  open,
  onOpenChange,
  sourceItemId,
  sourceItemTitle,
  availableItems,
  existingDependencyIds,
  onAddDependency,
  dependencyGraph,
  initialDirection = 'blocks',
}: AddDependencyDialogProps) {
  const [direction, setDirection] = React.useState<DependencyDirection>(initialDirection);
  const [dependencyType, setDependencyType] = React.useState<DependencyType>('finish_to_start');
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setDirection(initialDirection);
      setDependencyType('finish_to_start');
      setSelectedItemId(null);
      setSearchQuery('');
    }
  }, [open, initialDirection]);

  // Filter and validate available items
  const filteredItems = React.useMemo(() => {
    return availableItems.filter((item) => {
      // Must be a valid dependency
      if (!isValidDependency(item, sourceItemId, existingDependencyIds)) {
        return false;
      }

      // Must match search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return item.title.toLowerCase().includes(query);
      }

      return true;
    });
  }, [availableItems, sourceItemId, existingDependencyIds, searchQuery]);

  // Check for circular dependencies
  const wouldCreateCycle = React.useCallback(
    (item_id: string): boolean => {
      if (direction === 'blocks') {
        // Source blocks target: source -> target
        return detectCircularDependency(dependencyGraph, sourceItemId, item_id);
      } else {
        // Target blocks source: target -> source
        return detectCircularDependency(dependencyGraph, item_id, sourceItemId);
      }
    },
    [dependencyGraph, sourceItemId, direction],
  );

  // Check if any item would create a cycle
  const hasCircularWarning = React.useMemo(() => {
    return filteredItems.some((item) => wouldCreateCycle(item.id));
  }, [filteredItems, wouldCreateCycle]);

  // Get selected item
  const selectedItem = React.useMemo(() => {
    return filteredItems.find((item) => item.id === selectedItemId);
  }, [filteredItems, selectedItemId]);

  // Check if selection is valid
  const isSelectionValid = React.useMemo(() => {
    if (!selectedItemId) return false;
    return !wouldCreateCycle(selectedItemId);
  }, [selectedItemId, wouldCreateCycle]);

  // Handle add
  const handleAdd = () => {
    if (!selectedItemId || !isSelectionValid) return;

    onAddDependency({
      targetId: selectedItemId,
      direction,
      type: dependencyType,
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Dependency</DialogTitle>
          <DialogDescription>Create a dependency relationship for "{sourceItemTitle}"</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Direction selector */}
          <div className="space-y-2">
            <Label>Relationship</Label>
            <div className="flex gap-2" role="radiogroup" aria-label="Dependency direction">
              <label
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 p-3 rounded-md border cursor-pointer transition-colors',
                  direction === 'blocks' ? 'border-primary bg-primary/10' : 'border-muted hover:border-muted-foreground',
                )}
              >
                <input
                  type="radio"
                  name="direction"
                  value="blocks"
                  checked={direction === 'blocks'}
                  onChange={() => setDirection('blocks')}
                  className="sr-only"
                  aria-label="Blocks"
                />
                <ArrowRight className="size-4" />
                <span className="text-sm font-medium">Blocks</span>
              </label>
              <label
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 p-3 rounded-md border cursor-pointer transition-colors',
                  direction === 'blocked_by' ? 'border-primary bg-primary/10' : 'border-muted hover:border-muted-foreground',
                )}
              >
                <input
                  type="radio"
                  name="direction"
                  value="blocked_by"
                  checked={direction === 'blocked_by'}
                  onChange={() => setDirection('blocked_by')}
                  className="sr-only"
                  aria-label="Blocked by"
                />
                <ArrowLeft className="size-4" />
                <span className="text-sm font-medium">Blocked by</span>
              </label>
            </div>
          </div>

          {/* Dependency type selector */}
          <div className="space-y-2">
            <Label>Dependency Type</Label>
            <div className="grid grid-cols-2 gap-2">
              {DEPENDENCY_TYPES.map((type) => (
                <label
                  key={type}
                  className={cn(
                    'flex flex-col p-2 rounded-md border cursor-pointer transition-colors',
                    dependencyType === type ? 'border-primary bg-primary/10' : 'border-muted hover:border-muted-foreground',
                  )}
                >
                  <input
                    type="radio"
                    name="dependencyType"
                    value={type}
                    checked={dependencyType === type}
                    onChange={() => setDependencyType(type)}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium">{getDependencyTypeLabel(type)}</span>
                  <span className="text-xs text-muted-foreground">{getDependencyTypeDescription(type)}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Search */}
          <div className="space-y-2">
            <Label>Select Item</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="Search items..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
            </div>
          </div>

          {/* Circular dependency warning */}
          {hasCircularWarning && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="text-sm">Some items would create a circular dependency and cannot be selected.</span>
            </div>
          )}

          {/* Item list */}
          <ScrollArea className="h-48 rounded-md border">
            <div className="p-2 space-y-1">
              {filteredItems.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No items available</p>
              ) : (
                filteredItems.map((item) => {
                  const isCircular = wouldCreateCycle(item.id);
                  const isSelected = item.id === selectedItemId;

                  return (
                    <button
                      key={item.id}
                      data-testid={`dependency-option-${item.id}`}
                      disabled={isCircular}
                      className={cn(
                        'w-full flex items-center gap-2 p-2 rounded-md text-left transition-colors',
                        isSelected ? 'bg-primary/10 border border-primary' : 'hover:bg-muted',
                        isCircular && 'opacity-50 cursor-not-allowed',
                      )}
                      onClick={() => !isCircular && setSelectedItemId(item.id)}
                    >
                      <span className="text-muted-foreground">{getKindIcon(item.kind)}</span>
                      <span className="flex-1 truncate text-sm">{item.title}</span>
                      <Badge variant={getStatusVariant(item.status)} className="shrink-0 text-xs">
                        {getStatusLabel(item.status)}
                      </Badge>
                      {isCircular && <span className="text-xs text-amber-600 dark:text-amber-400">Circular</span>}
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>

          {/* Preview */}
          {selectedItem && (
            <div className="p-3 rounded-md bg-muted text-sm">
              {direction === 'blocks' ? (
                <p>
                  <strong>{sourceItemTitle}</strong> will block <strong>{selectedItem.title}</strong>
                </p>
              ) : (
                <p>
                  <strong>{sourceItemTitle}</strong> will be blocked by <strong>{selectedItem.title}</strong>
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!isSelectionValid} aria-label="Add dependency">
            Add Dependency
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
