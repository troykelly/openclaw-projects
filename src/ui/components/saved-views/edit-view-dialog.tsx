/**
 * Edit View Dialog component
 * Issue #406: Implement saved views with sharing
 */
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import type { SavedView, UpdateViewInput } from './types';

export interface EditViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: SavedView;
  onSave: (view: UpdateViewInput) => void;
}

export function EditViewDialog({ open, onOpenChange, view, onSave }: EditViewDialogProps) {
  const [name, setName] = React.useState(view.name);
  const [description, setDescription] = React.useState(view.description || '');

  React.useEffect(() => {
    setName(view.name);
    setDescription(view.description || '');
  }, [view]);

  const canSave = name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;

    onSave({
      id: view.id,
      name: name.trim(),
      description: description.trim() || undefined,
      config: view.config,
    });

    onOpenChange(false);
  };

  const handleCancel = () => {
    setName(view.name);
    setDescription(view.description || '');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit View</DialogTitle>
          <DialogDescription className="sr-only">Edit the view name and settings</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-view-name">Name</Label>
            <Input id="edit-view-name" placeholder="View name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-view-description">Description</Label>
            <Input id="edit-view-description" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
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
