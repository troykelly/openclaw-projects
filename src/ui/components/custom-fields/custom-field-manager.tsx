/**
 * Manager component for creating, editing, and deleting custom field definitions
 */
import * as React from 'react';
import { PlusIcon, TrashIcon, GripVerticalIcon } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Textarea } from '@/ui/components/ui/textarea';
import { Checkbox } from '@/ui/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/components/ui/alert-dialog';
import { Badge } from '@/ui/components/ui/badge';
import { cn } from '@/ui/lib/utils';
import { fieldTypeHasOptions, fieldTypeHasValidation } from './validation';
import type {
  CustomFieldManagerProps,
  CustomFieldType,
  CreateCustomFieldData,
  FIELD_TYPE_LABELS,
} from './types';

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'longtext', label: 'Long Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
  { value: 'multiselect', label: 'Multi-Select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'URL' },
];

export function CustomFieldManager({
  projectId,
  fields,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
  className,
}: CustomFieldManagerProps) {
  const [showCreate, setShowCreate] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  // Create form state
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<CustomFieldType>('text');
  const [description, setDescription] = React.useState('');
  const [required, setRequired] = React.useState(false);
  const [options, setOptions] = React.useState('');
  const [minValue, setMinValue] = React.useState('');
  const [maxValue, setMaxValue] = React.useState('');

  const sortedFields = React.useMemo(
    () => [...fields].sort((a, b) => a.order - b.order),
    [fields]
  );

  const resetForm = () => {
    setName('');
    setType('text');
    setDescription('');
    setRequired(false);
    setOptions('');
    setMinValue('');
    setMaxValue('');
  };

  const handleCreate = () => {
    const data: CreateCustomFieldData = {
      name: name.trim(),
      type,
      description: description.trim() || undefined,
      required,
    };

    if (fieldTypeHasOptions(type) && options.trim()) {
      data.options = options
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean);
    }

    if (fieldTypeHasValidation(type)) {
      const validation: Record<string, number> = {};
      if (minValue) validation.min = Number(minValue);
      if (maxValue) validation.max = Number(maxValue);
      if (Object.keys(validation).length > 0) {
        data.validation = validation;
      }
    }

    onCreate(data);
    setShowCreate(false);
    resetForm();
  };

  const handleDelete = () => {
    if (deleteId) {
      onDelete(deleteId);
      setDeleteId(null);
    }
  };

  const fieldToDelete = fields.find((f) => f.id === deleteId);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Custom Fields</h3>
          <p className="text-sm text-muted-foreground">
            Define custom fields for work items in this project
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} aria-label="Add field">
          <PlusIcon className="h-4 w-4 mr-2" />
          Add Field
        </Button>
      </div>

      {/* Field list */}
      <div className="space-y-2">
        {sortedFields.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No custom fields defined yet
          </p>
        ) : (
          sortedFields.map((field) => (
            <div
              key={field.id}
              className="flex items-center gap-3 p-3 rounded-lg border bg-card"
            >
              <GripVerticalIcon className="h-4 w-4 text-muted-foreground cursor-grab" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{field.name}</span>
                  <Badge variant="secondary">{field.type}</Badge>
                  {field.required && (
                    <Badge variant="outline" className="text-destructive">
                      Required
                    </Badge>
                  )}
                </div>
                {field.description && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {field.description}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteId(field.id)}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                aria-label={`Delete ${field.name}`}
              >
                <TrashIcon className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Custom Field</DialogTitle>
            <DialogDescription>
              Add a new custom field for work items in this project.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="field-name">Field Name</Label>
              <Input
                id="field-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Sprint, Story Points"
                aria-label="Field name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="field-type">Field Type</Label>
              <select
                id="field-type"
                value={type}
                onChange={(e) => setType(e.target.value as CustomFieldType)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Field type"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="field-description">Description (optional)</Label>
              <Input
                id="field-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Help text for this field"
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="field-required"
                checked={required}
                onCheckedChange={(checked) => setRequired(checked === true)}
              />
              <Label htmlFor="field-required">Required field</Label>
            </div>

            {fieldTypeHasOptions(type) && (
              <div className="space-y-2">
                <Label htmlFor="field-options">Options (one per line)</Label>
                <Textarea
                  id="field-options"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                  placeholder="Option 1&#10;Option 2&#10;Option 3"
                  rows={4}
                />
              </div>
            )}

            {type === 'number' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="field-min">Min Value</Label>
                  <Input
                    id="field-min"
                    type="number"
                    value={minValue}
                    onChange={(e) => setMinValue(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="field-max">Max Value</Label>
                  <Input
                    id="field-max"
                    type="number"
                    value={maxValue}
                    onChange={(e) => setMaxValue(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreate(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Field</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the field "{fieldToDelete?.name}"?
              This will remove all values from existing work items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
