/**
 * Clone Dialog component for duplicating work items
 */
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { Label } from '@/ui/components/ui/label';
import type { CloneDialogProps, CloneOptions } from './types';

export function CloneDialog({
  open,
  item,
  onClone,
  onCancel,
  isCloning = false,
}: CloneDialogProps) {
  const [title, setTitle] = React.useState(`${item.title} (Copy)`);
  const [includeChildren, setIncludeChildren] = React.useState(false);
  const [includeTodos, setIncludeTodos] = React.useState(false);

  // Reset state when item changes
  React.useEffect(() => {
    setTitle(`${item.title} (Copy)`);
    setIncludeChildren(false);
    setIncludeTodos(false);
  }, [item.id, item.title]);

  const canClone = title.trim().length > 0 && !isCloning;

  const handleClone = React.useCallback(() => {
    if (!canClone) return;
    const options: CloneOptions = {
      title: title.trim(),
      includeChildren,
      includeTodos,
    };
    onClone(options);
  }, [canClone, title, includeChildren, includeTodos, onClone]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && canClone) {
        e.preventDefault();
        handleClone();
      }
    },
    [canClone, handleClone]
  );

  const handleDialogKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [onCancel]
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent onKeyDown={handleDialogKeyDown}>
        <DialogHeader>
          <DialogTitle>Clone {item.kind}</DialogTitle>
          <DialogDescription>
            Create a copy of this {item.kind} with optional children and todos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Title input */}
          <div className="space-y-2">
            <Label htmlFor="clone-title">Title</Label>
            <Input
              id="clone-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter title for cloned item"
            />
          </div>

          {/* Clone options */}
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Clone item only</p>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="include-children"
                checked={includeChildren}
                onCheckedChange={(checked) =>
                  setIncludeChildren(checked === true)
                }
                disabled={!item.hasChildren}
                aria-label="Include children"
              />
              <Label
                htmlFor="include-children"
                className={!item.hasChildren ? 'text-muted-foreground' : ''}
              >
                Include children
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="include-todos"
                checked={includeTodos}
                onCheckedChange={(checked) => setIncludeTodos(checked === true)}
                disabled={!item.hasTodos}
                aria-label="Include todos"
              />
              <Label
                htmlFor="include-todos"
                className={!item.hasTodos ? 'text-muted-foreground' : ''}
              >
                Include todos
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isCloning}>
            Cancel
          </Button>
          <Button onClick={handleClone} disabled={!canClone}>
            {isCloning ? 'Cloning...' : 'Clone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
