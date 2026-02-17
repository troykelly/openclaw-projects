/**
 * Dialog for saving a work item as a template
 */
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Textarea } from '@/ui/components/ui/textarea';
import { Checkbox } from '@/ui/components/ui/checkbox';
import type { SaveTemplateDialogProps, WorkItemTemplate, TemplateCategory, TemplateStructure } from './types';

const CATEGORIES: { value: TemplateCategory; label: string }[] = [
  { value: 'sprint', label: 'Sprint' },
  { value: 'feature', label: 'Feature' },
  { value: 'bugfix', label: 'Bug Fix' },
  { value: 'project', label: 'Project' },
  { value: 'custom', label: 'Custom' },
];

export function SaveTemplateDialog({ open, item, onSave, onCancel }: SaveTemplateDialogProps) {
  const [name, setName] = React.useState(item.title);
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState<TemplateCategory>('custom');
  const [includeChildren, setIncludeChildren] = React.useState(true);

  React.useEffect(() => {
    setName(item.title);
    setDescription('');
    setCategory('custom');
    setIncludeChildren(true);
  }, [item.id, item.title]);

  const hasChildren = item.children && item.children.length > 0;
  const canSave = name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;

    const structure: TemplateStructure = {
      kind: item.kind as TemplateStructure['kind'],
      title: name.trim(),
      description: description.trim() || undefined,
      children:
        includeChildren && item.children
          ? item.children.map((child) => ({
              kind: child.kind as TemplateStructure['kind'],
              title: child.title,
            }))
          : undefined,
    };

    const template: Omit<WorkItemTemplate, 'id' | 'created_at'> = {
      name: name.trim(),
      description: description.trim(),
      category,
      structure,
    };

    onSave(template);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as Template</DialogTitle>
          <DialogDescription>Create a reusable template from this {item.kind}.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">Template Name</Label>
            <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter template name" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-description">Description</Label>
            <Textarea
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this template..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-category">Category</Label>
            <select
              id="template-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCategory)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Category"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {hasChildren && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="include-children"
                checked={includeChildren}
                onCheckedChange={(checked) => setIncludeChildren(checked === true)}
                aria-label="Include children"
              />
              <Label htmlFor="include-children">Include children ({item.children?.length} items)</Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
