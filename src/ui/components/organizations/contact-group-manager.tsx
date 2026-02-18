/**
 * Manager for contact group assignments
 * Issue #394: Implement contact groups and organization hierarchy
 */
import * as React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import { ContactGroupBadge } from './contact-group-badge';
import type { ContactGroup } from './types';

export interface ContactGroupManagerProps {
  contact_id: string;
  assignedGroups: ContactGroup[];
  availableGroups: ContactGroup[];
  onAddToGroup: (contact_id: string, group_id: string) => void;
  onRemoveFromGroup: (contact_id: string, group_id: string) => void;
  className?: string;
}

export function ContactGroupManager({ contact_id, assignedGroups, availableGroups, onAddToGroup, onRemoveFromGroup, className }: ContactGroupManagerProps) {
  const [open, setOpen] = React.useState(false);

  // Filter out already assigned groups
  const unassignedGroups = React.useMemo(() => {
    const assignedIds = new Set(assignedGroups.map((g) => g.id));
    return availableGroups.filter((g) => !assignedIds.has(g.id));
  }, [assignedGroups, availableGroups]);

  const handleAddGroup = (group_id: string) => {
    onAddToGroup(contact_id, group_id);
    setOpen(false);
  };

  const handleRemoveGroup = (group_id: string) => {
    onRemoveFromGroup(contact_id, group_id);
  };

  return (
    <div className={cn('space-y-2', className)}>
      {/* Assigned groups */}
      <div className="flex flex-wrap gap-1.5">
        {assignedGroups.map((group) => (
          <ContactGroupBadge key={group.id} group={group} removable onRemove={handleRemoveGroup} />
        ))}

        {assignedGroups.length === 0 && <span className="text-sm text-muted-foreground">No groups assigned</span>}
      </div>

      {/* Add group button */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7" disabled={unassignedGroups.length === 0}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add to Group
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <div className="p-2 border-b">
            <div className="text-sm font-medium">Available Groups</div>
          </div>
          <ScrollArea className="max-h-48">
            <div className="p-1" role="listbox">
              {unassignedGroups.map((group) => (
                <button
                  key={group.id}
                  role="option"
                  className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm', 'hover:bg-muted transition-colors text-left')}
                  onClick={() => handleAddGroup(group.id)}
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                  <span className="flex-1 truncate">{group.name}</span>
                  <span className="text-xs text-muted-foreground">{group.memberCount}</span>
                </button>
              ))}

              {unassignedGroups.length === 0 && <div className="px-2 py-4 text-center text-sm text-muted-foreground">No more groups available</div>}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}
