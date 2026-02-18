import * as React from 'react';
import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Loader2, Plus } from 'lucide-react';
import { apiClient } from '@/ui/lib/api-client';
import type { QuickAddDialogProps, WorkItemKind, WorkItemCreatePayload, CreatedWorkItem } from './types';

const kindLabels: Record<WorkItemKind, string> = {
  project: 'Project',
  initiative: 'Initiative',
  epic: 'Epic',
  issue: 'Issue',
};

export function QuickAddDialog({ open, onOpenChange, onCreated, defaultParentId, defaultKind = 'issue' }: QuickAddDialogProps) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<WorkItemKind>(defaultKind);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setTitle('');
    setKind(defaultKind);
    setError(null);
  }, [defaultKind]);

  const handleSubmit = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    const payload: WorkItemCreatePayload = {
      title: title.trim(),
      kind,
      parent_id: defaultParentId ?? null,
    };

    try {
      const createdItem = await apiClient.post<CreatedWorkItem>('/api/work-items', payload);
      onCreated?.(createdItem);
      resetForm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsLoading(false);
    }
  }, [title, kind, defaultParentId, isLoading, onCreated, onOpenChange, resetForm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    },
    [handleSubmit, onOpenChange],
  );

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        resetForm();
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, resetForm],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-5" />
            Quick Add
          </DialogTitle>
          <DialogDescription>Create a new work item quickly.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center gap-3">
            <Select value={kind} onValueChange={(value) => setKind(value as WorkItemKind)}>
              <SelectTrigger className="w-[140px]" aria-label="Kind">
                <SelectValue placeholder="Kind" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(kindLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input placeholder="Title..." value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={handleKeyDown} className="flex-1" autoFocus />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
