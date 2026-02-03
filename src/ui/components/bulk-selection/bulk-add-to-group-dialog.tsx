/**
 * Dialog for adding contacts to a group
 * Issue #397: Implement bulk contact operations
 */
import * as React from 'react';
import { Loader2, Users } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import type { ContactGroup } from './types';

export interface BulkAddToGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  groups: ContactGroup[];
  onConfirm: (groupId: string) => void;
  loading?: boolean;
}

export function BulkAddToGroupDialog({
  open,
  onOpenChange,
  selectedCount,
  groups,
  onConfirm,
  loading = false,
}: BulkAddToGroupDialogProps) {
  const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null);

  const handleConfirm = () => {
    if (selectedGroupId) {
      onConfirm(selectedGroupId);
    }
  };

  // Reset selection when dialog opens
  React.useEffect(() => {
    if (open) {
      setSelectedGroupId(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle>Add {selectedCount} contacts to group</DialogTitle>
          </div>
          <DialogDescription>
            Select a group to add the selected contacts to.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-64 border rounded-md">
          <div className="p-2 space-y-1">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                data-selected={selectedGroupId === group.id}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left',
                  'hover:bg-muted transition-colors',
                  selectedGroupId === group.id && 'bg-muted ring-1 ring-primary'
                )}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{group.name}</div>
                  {group.description && (
                    <div className="text-xs text-muted-foreground truncate">
                      {group.description}
                    </div>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {group.memberCount} members
                </span>
              </button>
            ))}

            {groups.length === 0 && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                No groups available
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !selectedGroupId}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              'Add to Group'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
