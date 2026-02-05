/**
 * Notebook form dialog component.
 * Part of Epic #338, Issue #659 (component splitting).
 *
 * Extracted from NotesPage.tsx to reduce component size.
 */
import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Textarea } from '@/ui/components/ui/textarea';
import type {
  CreateNotebookBody,
  UpdateNotebookBody,
} from '@/ui/lib/api-types';
import type { Notebook as UINotebook } from '@/ui/components/notes/types';

interface NotebookFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebook?: UINotebook;
  onSubmit: (data: CreateNotebookBody | UpdateNotebookBody) => Promise<void>;
  isSubmitting: boolean;
}

export function NotebookFormDialog({
  open,
  onOpenChange,
  notebook,
  onSubmit,
  isSubmitting,
}: NotebookFormDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6366f1');

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setName(notebook?.name ?? '');
      setDescription(notebook?.description ?? '');
      setColor(notebook?.color ?? '#6366f1');
    }
  }, [open, notebook]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      color,
    });
  };

  const isValid = name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="notebook-form-dialog">
        <DialogHeader>
          <DialogTitle>
            {notebook ? 'Edit Notebook' : 'New Notebook'}
          </DialogTitle>
          <DialogDescription>
            {notebook
              ? 'Update the notebook details below.'
              : 'Create a new notebook to organize your notes.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notebook-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="notebook-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Notebook"
              required
              data-testid="notebook-name-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notebook-description">Description</Label>
            <Textarea
              id="notebook-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
              data-testid="notebook-description-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notebook-color">Color</Label>
            <div className="flex items-center gap-2">
              <input
                id="notebook-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border"
                data-testid="notebook-color-input"
              />
              <span className="text-sm text-muted-foreground">{color}</span>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || isSubmitting}
              data-testid="notebook-form-submit"
            >
              {notebook ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
