/**
 * Notebook form dialog component.
 * Part of Epic #338, Issue #659 (component splitting).
 *
 * Extracted from NotesPage.tsx to reduce component size.
 * Updated with client-side validation (#656).
 */
import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Textarea } from '@/ui/components/ui/textarea';
import type { CreateNotebookBody, UpdateNotebookBody } from '@/ui/lib/api-types';
import type { Notebook as UINotebook } from '@/ui/components/notes/types';
import { validateNotebook, getValidationErrorMessage } from '@/ui/lib/validation';

/** Default color for new notebooks (indigo-500) */
const DEFAULT_NOTEBOOK_COLOR = '#6366f1';

interface NotebookFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebook?: UINotebook;
  onSubmit: (data: CreateNotebookBody | UpdateNotebookBody) => Promise<void>;
  isSubmitting: boolean;
}

export function NotebookFormDialog({ open, onOpenChange, notebook, onSubmit, isSubmitting }: NotebookFormDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(DEFAULT_NOTEBOOK_COLOR);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setName(notebook?.name ?? '');
      setDescription(notebook?.description ?? '');
      setColor(notebook?.color ?? DEFAULT_NOTEBOOK_COLOR);
      setValidationError(null);
    }
  }, [open, notebook]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Client-side validation before API call
    const validation = validateNotebook({
      name: name.trim(),
      description: description.trim() || undefined,
      color,
    });

    if (!validation.valid) {
      setValidationError(getValidationErrorMessage(validation));
      return;
    }

    setValidationError(null);
    await onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      color,
    });
  };

  // Validate on input change to provide real-time feedback
  const validation = validateNotebook({
    name: name.trim(),
    description: description.trim() || undefined,
    color,
  });
  const isValid = validation.valid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="notebook-form-dialog">
        <DialogHeader>
          <DialogTitle>{notebook ? 'Edit Notebook' : 'New Notebook'}</DialogTitle>
          <DialogDescription>{notebook ? 'Update the notebook details below.' : 'Create a new notebook to organize your notes.'}</DialogDescription>
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

          {/* Validation error display */}
          {validationError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="notebook-validation-error">
              {validationError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || isSubmitting} data-testid="notebook-form-submit">
              {notebook ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
