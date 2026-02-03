/**
 * Label manager component for creating, editing, and deleting labels
 */
import * as React from 'react';
import { PlusIcon, TrashIcon, SearchIcon } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
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
import { cn } from '@/ui/lib/utils';
import { LabelBadge } from './label-badge';
import { ADDITIONAL_COLORS, getRandomColor } from './color-palette';
import type { LabelManagerProps, CreateLabelData, Label as LabelType } from './types';

export function LabelManager({
  labels,
  onCreate,
  onUpdate,
  onDelete,
  className,
}: LabelManagerProps) {
  const [search, setSearch] = React.useState('');
  const [showCreate, setShowCreate] = React.useState(false);
  const [newLabelName, setNewLabelName] = React.useState('');
  const [newLabelColor, setNewLabelColor] = React.useState(() => getRandomColor());
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const filteredLabels = React.useMemo(() => {
    if (!search.trim()) return labels;
    const searchLower = search.toLowerCase();
    return labels.filter((label) =>
      label.name.toLowerCase().includes(searchLower)
    );
  }, [labels, search]);

  const handleCreate = () => {
    if (!newLabelName.trim()) return;

    const data: CreateLabelData = {
      name: newLabelName.trim(),
      color: newLabelColor,
    };

    onCreate(data);
    setNewLabelName('');
    setNewLabelColor(getRandomColor());
    setShowCreate(false);
  };

  const handleDelete = () => {
    if (deleteId) {
      onDelete(deleteId);
      setDeleteId(null);
    }
  };

  const labelToDelete = labels.find((l) => l.id === deleteId);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center gap-4 p-4 border-b">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search labels..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setShowCreate(true)} aria-label="New label">
          <PlusIcon className="h-4 w-4 mr-2" />
          New Label
        </Button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="p-4 border-b bg-muted/50 space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="label-name">Label name</Label>
              <Input
                id="label-name"
                placeholder="Label name"
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-1">
                {ADDITIONAL_COLORS.slice(0, 8).map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewLabelColor(color)}
                    className={cn(
                      'h-8 w-8 rounded border-2',
                      newLabelColor === color
                        ? 'border-foreground'
                        : 'border-transparent'
                    )}
                    style={{ backgroundColor: color }}
                    aria-label={`Select color ${color}`}
                  />
                ))}
              </div>
            </div>
          </div>
          {newLabelName.trim() && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Preview:</span>
              <LabelBadge
                label={{ id: 'preview', name: newLabelName.trim(), color: newLabelColor }}
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={!newLabelName.trim()}>
              Create
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreate(false);
                setNewLabelName('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Label List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {filteredLabels.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {search ? 'No labels found' : 'No labels yet'}
            </p>
          ) : (
            filteredLabels.map((label) => (
              <div
                key={label.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3">
                  <LabelBadge label={label} />
                  {label.description && (
                    <span className="text-sm text-muted-foreground">
                      {label.description}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteId(label.id)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  aria-label={`Delete ${label.name}`}
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Label</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the label{' '}
              {labelToDelete && (
                <LabelBadge label={labelToDelete} size="sm" />
              )}
              ? This will remove it from all work items.
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
