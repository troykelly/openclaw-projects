/**
 * Dialog for adding watchers to a work item
 * Issue #401: Implement watchers/followers on work items
 */
import * as React from 'react';
import { Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select';
import { cn } from '@/ui/lib/utils';
import {
  getInitials,
  NOTIFICATION_LEVELS,
  type NotificationLevel,
  type WatcherUser,
} from './types';

export interface AddWatcherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: WatcherUser[];
  existingWatcherIds: string[];
  onAdd: (userId: string, notificationLevel?: NotificationLevel) => void;
  className?: string;
}

export function AddWatcherDialog({
  open,
  onOpenChange,
  users,
  existingWatcherIds,
  onAdd,
  className,
}: AddWatcherDialogProps) {
  const [search, setSearch] = React.useState('');
  const [notificationLevel, setNotificationLevel] =
    React.useState<NotificationLevel>('all');

  // Filter out existing watchers and apply search
  const availableUsers = React.useMemo(() => {
    const existing = new Set(existingWatcherIds);
    return users
      .filter((user) => !existing.has(user.id))
      .filter((user) =>
        user.name.toLowerCase().includes(search.toLowerCase())
      );
  }, [users, existingWatcherIds, search]);

  const handleSelect = (userId: string) => {
    onAdd(userId, notificationLevel);
    onOpenChange(false);
    setSearch('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-md', className)}>
        <DialogHeader>
          <DialogTitle>Add watcher</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Notification level selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Notification level</label>
            <Select
              value={notificationLevel}
              onValueChange={(value) =>
                setNotificationLevel(value as NotificationLevel)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTIFICATION_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* User list */}
          <div className="max-h-60 overflow-y-auto space-y-1">
            {availableUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-muted text-left"
                onClick={() => handleSelect(user.id)}
              >
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                    {getInitials(user.name)}
                  </div>
                )}
                <span className="text-sm">{user.name}</span>
              </button>
            ))}

            {availableUsers.length === 0 && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                No users found
              </div>
            )}
          </div>

          {/* Cancel button */}
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
