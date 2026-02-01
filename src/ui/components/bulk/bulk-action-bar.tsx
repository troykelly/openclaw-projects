import * as React from 'react';
import { useCallback, useState } from 'react';
import { X, Trash2, FolderTree, CheckCircle2, AlertCircle, Circle, Clock } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { useBulkSelection } from '@/ui/hooks/use-bulk-selection';

export type BulkAction = 'status' | 'priority' | 'parent' | 'delete';

interface BulkActionBarProps {
  onAction?: (action: BulkAction, value?: string | null) => Promise<void>;
  availableStatuses?: string[];
  availablePriorities?: string[];
}

const defaultStatuses = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'];
const defaultPriorities = ['P0', 'P1', 'P2', 'P3', 'P4'];

export function BulkActionBar({
  onAction,
  availableStatuses = defaultStatuses,
  availablePriorities = defaultPriorities,
}: BulkActionBarProps) {
  const { count, hasSelection, deselectAll, selectedIds } = useBulkSelection();
  const [isLoading, setIsLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleStatusChange = useCallback(
    async (status: string) => {
      setIsLoading(true);
      try {
        await onAction?.('status', status);
      } finally {
        setIsLoading(false);
      }
    },
    [onAction]
  );

  const handlePriorityChange = useCallback(
    async (priority: string) => {
      setIsLoading(true);
      try {
        await onAction?.('priority', priority);
      } finally {
        setIsLoading(false);
      }
    },
    [onAction]
  );

  const handleDelete = useCallback(async () => {
    setShowDeleteConfirm(false);
    setIsLoading(true);
    try {
      await onAction?.('delete');
    } finally {
      setIsLoading(false);
    }
  }, [onAction]);

  if (!hasSelection) return null;

  const statusIcon = (status: string) => {
    switch (status) {
      case 'done':
        return <CheckCircle2 className="size-3" />;
      case 'in_progress':
        return <Clock className="size-3" />;
      case 'cancelled':
        return <X className="size-3" />;
      case 'review':
        return <AlertCircle className="size-3" />;
      default:
        return <Circle className="size-3" />;
    }
  };

  return (
    <>
      <div
        data-testid="bulk-action-bar"
        className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-surface p-3 shadow-lg"
      >
        <div className="flex items-center gap-2 border-r border-border pr-3">
          <span className="text-sm font-medium">{count} selected</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={deselectAll}
            className="size-6 p-0"
            aria-label="Clear selection"
          >
            <X className="size-4" />
          </Button>
        </div>

        <Select onValueChange={handleStatusChange} disabled={isLoading}>
          <SelectTrigger className="w-[140px]" aria-label="Change status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {availableStatuses.map((status) => (
              <SelectItem key={status} value={status}>
                <span className="flex items-center gap-2">
                  {statusIcon(status)}
                  {status.replace('_', ' ')}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={handlePriorityChange} disabled={isLoading}>
          <SelectTrigger className="w-[100px]" aria-label="Change priority">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            {availablePriorities.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {priority}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={isLoading}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="mr-1 size-4" />
          Delete
        </Button>
      </div>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {count} items?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. All selected items and their children will be
              permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
