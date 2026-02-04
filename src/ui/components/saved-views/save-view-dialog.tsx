/**
 * Save View Dialog component
 * Issue #406: Implement saved views with sharing
 */
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Badge } from '@/ui/components/ui/badge';
import type { ViewConfig, SaveViewInput } from './types';

export interface SaveViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ViewConfig;
  onSave: (view: SaveViewInput) => void;
}

function getFilterCount(filters?: Record<string, unknown>): number {
  if (!filters) return 0;
  return Object.keys(filters).length;
}

export function SaveViewDialog({
  open,
  onOpenChange,
  config,
  onSave,
}: SaveViewDialogProps) {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');

  const filterCount = getFilterCount(config.filters);
  const canSave = name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;

    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      config,
    });

    setName('');
    setDescription('');
    onOpenChange(false);
  };

  const handleCancel = () => {
    setName('');
    setDescription('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save View</DialogTitle>
          <DialogDescription className="sr-only">Save the current view configuration</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="view-name">Name</Label>
            <Input
              id="view-name"
              placeholder="View name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="view-description">Description</Label>
            <Input
              id="view-description"
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>View Configuration</Label>
            <div className="flex flex-wrap gap-2">
              {config.viewType && (
                <Badge variant="secondary">{config.viewType}</Badge>
              )}
              {filterCount > 0 && (
                <Badge variant="outline">
                  {filterCount} filter{filterCount !== 1 ? 's' : ''}
                </Badge>
              )}
              {config.sort && (
                <Badge variant="outline">
                  Sort: {config.sort.field} ({config.sort.direction})
                </Badge>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
