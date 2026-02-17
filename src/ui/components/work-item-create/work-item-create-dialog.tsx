import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Textarea } from '@/ui/components/ui/textarea';
import { Label } from '@/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Loader2, FileText } from 'lucide-react';
import { apiClient } from '@/ui/lib/api-client';
import type { WorkItemCreateDialogProps, WorkItemKind, WorkItemCreatePayload, CreatedWorkItem, ParentSelectorItem } from './types';

const kindLabels: Record<WorkItemKind, string> = {
  project: 'Project',
  initiative: 'Initiative',
  epic: 'Epic',
  issue: 'Issue',
};

const kindDescriptions: Record<WorkItemKind, string> = {
  project: 'Top-level container for initiatives',
  initiative: 'Strategic goal or theme (belongs to a project)',
  epic: 'Large body of work (belongs to an initiative)',
  issue: 'Specific task or bug (belongs to an epic)',
};

// Maps child kind to allowed parent kind
const parentKindMap: Record<WorkItemKind, WorkItemKind | null> = {
  project: null, // Projects have no parent
  initiative: 'project',
  epic: 'initiative',
  issue: 'epic',
};

type ApiTreeItem = {
  id: string;
  title: string;
  kind: string;
  parent_id: string | null;
  children: ApiTreeItem[];
};

function flattenTree(items: ApiTreeItem[], depth = 0): ParentSelectorItem[] {
  const result: ParentSelectorItem[] = [];
  for (const item of items) {
    result.push({
      id: item.id,
      title: item.title,
      kind: item.kind as WorkItemKind,
      depth,
    });
    if (item.children?.length > 0) {
      result.push(...flattenTree(item.children, depth + 1));
    }
  }
  return result;
}

export function WorkItemCreateDialog({ open, onOpenChange, onCreated, defaultParentId, defaultKind = 'issue' }: WorkItemCreateDialogProps) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<WorkItemKind>(defaultKind);
  const [description, setDescription] = useState('');
  const [parent_id, setParentId] = useState<string | undefined>(defaultParentId);
  const [estimateMinutes, setEstimateMinutes] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Parent options state
  const [parentOptions, setParentOptions] = useState<ParentSelectorItem[]>([]);
  const [loadingParents, setLoadingParents] = useState(false);

  // Load parent options when dialog opens
  useEffect(() => {
    if (!open) return;

    async function loadParents() {
      setLoadingParents(true);
      try {
        const data = await apiClient.get<{ items: ApiTreeItem[] }>('/api/work-items/tree');
        setParentOptions(flattenTree(data.items));
      } catch {
        // Silently fail - parent selection will just be empty
      } finally {
        setLoadingParents(false);
      }
    }

    loadParents();
  }, [open]);

  const resetForm = useCallback(() => {
    setTitle('');
    setKind(defaultKind);
    setDescription('');
    setParentId(defaultParentId);
    setEstimateMinutes('');
    setError(null);
    setValidationErrors({});
  }, [defaultKind, defaultParentId]);

  const validate = useCallback((): boolean => {
    const errors: Record<string, string> = {};

    if (!title.trim()) {
      errors.title = 'Title is required';
    }

    // Validate parent requirement for non-project kinds (except issues which can be top-level)
    const requiredParentKind = parentKindMap[kind];
    if (requiredParentKind && !parent_id && kind !== 'issue') {
      errors.parent = `${kindLabels[kind]} requires a parent ${kindLabels[requiredParentKind]}`;
    }

    // Validate parent kind matches
    if (parent_id && requiredParentKind) {
      const selectedParent = parentOptions.find((p) => p.id === parent_id);
      if (selectedParent && selectedParent.kind !== requiredParentKind) {
        errors.parent = `${kindLabels[kind]} parent must be a ${kindLabels[requiredParentKind]}`;
      }
    }

    // Validate estimate
    if (estimateMinutes) {
      const minutes = parseInt(estimateMinutes, 10);
      if (isNaN(minutes) || minutes < 0 || minutes > 525600) {
        errors.estimate = 'Estimate must be between 0 and 525600 minutes';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [title, kind, parent_id, parentOptions, estimateMinutes]);

  const handleSubmit = useCallback(async () => {
    if (isLoading) return;

    if (!validate()) return;

    setIsLoading(true);
    setError(null);

    const payload: WorkItemCreatePayload = {
      title: title.trim(),
      kind,
      description: description.trim() || undefined,
      parent_id: parent_id ?? null,
      estimateMinutes: estimateMinutes ? parseInt(estimateMinutes, 10) : null,
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
  }, [title, kind, description, parent_id, estimateMinutes, isLoading, validate, onCreated, onOpenChange, resetForm]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        resetForm();
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, resetForm],
  );

  // Filter parent options based on selected kind
  const allowedParentKind = parentKindMap[kind];
  const filteredParentOptions = allowedParentKind ? parentOptions.filter((p) => p.kind === allowedParentKind) : [];

  const showParentSelector = kind !== 'project';
  const showEstimate = kind === 'issue' || kind === 'epic';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5" />
            Create Work Item
          </DialogTitle>
          <DialogDescription>Fill in the details to create a new work item.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Enter title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={!!validationErrors.title}
              autoFocus
            />
            {validationErrors.title && <p className="text-sm text-destructive">{validationErrors.title}</p>}
          </div>

          {/* Kind */}
          <div className="space-y-2">
            <Label htmlFor="kind">Kind</Label>
            <Select
              value={kind}
              onValueChange={(value) => {
                setKind(value as WorkItemKind);
                // Clear parent when kind changes if it's no longer valid
                if (parent_id) {
                  const newAllowedParent = parentKindMap[value as WorkItemKind];
                  const selectedParent = parentOptions.find((p) => p.id === parent_id);
                  if (selectedParent?.kind !== newAllowedParent) {
                    setParentId(undefined);
                  }
                }
              }}
            >
              <SelectTrigger id="kind" aria-label="Kind">
                <SelectValue placeholder="Select kind" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(kindLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    <span className="flex flex-col">
                      <span>{label}</span>
                      <span className="text-xs text-muted-foreground">{kindDescriptions[value as WorkItemKind]}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Parent */}
          {showParentSelector && (
            <div className="space-y-2">
              <Label htmlFor="parent">Parent</Label>
              <Select
                value={parent_id ?? '__none__'}
                onValueChange={(value) => setParentId(value === '__none__' ? undefined : value)}
                disabled={kind === 'project' || loadingParents}
              >
                <SelectTrigger id="parent" aria-label="Parent" disabled={kind === 'project' || loadingParents}>
                  <SelectValue
                    placeholder={
                      loadingParents
                        ? 'Loading...'
                        : filteredParentOptions.length === 0
                          ? `No ${allowedParentKind ? kindLabels[allowedParentKind] + 's' : 'parents'} available`
                          : 'Select parent...'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {filteredParentOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      <span style={{ paddingLeft: `${option.depth * 12}px` }}>{option.title}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {validationErrors.parent && <p className="text-sm text-destructive">{validationErrors.parent}</p>}
            </div>
          )}

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" placeholder="Enter description..." value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>

          {/* Estimate (for issues/epics) */}
          {showEstimate && (
            <div className="space-y-2">
              <Label htmlFor="estimate">Estimate (minutes)</Label>
              <Input
                id="estimate"
                type="number"
                placeholder="e.g., 60"
                value={estimateMinutes}
                onChange={(e) => setEstimateMinutes(e.target.value)}
                min={0}
                max={525600}
                aria-invalid={!!validationErrors.estimate}
              />
              {validationErrors.estimate && <p className="text-sm text-destructive">{validationErrors.estimate}</p>}
            </div>
          )}

          {/* General error */}
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
