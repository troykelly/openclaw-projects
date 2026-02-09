/**
 * Template selector component for choosing a template when creating new items
 */
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import { useTemplates } from './use-templates';
import type { WorkItemTemplate, TemplateSelectorProps, TemplateCategory } from './types';

const CATEGORIES: { value: TemplateCategory; label: string }[] = [
  { value: 'sprint', label: 'Sprint' },
  { value: 'feature', label: 'Feature' },
  { value: 'bugfix', label: 'Bug Fix' },
  { value: 'project', label: 'Project' },
  { value: 'custom', label: 'Custom' },
];

interface TemplateCardProps {
  template: WorkItemTemplate;
  selected: boolean;
  onSelect: () => void;
}

function TemplateCard({ template, selected, onSelect }: TemplateCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left p-4 rounded-lg border transition-colors',
        'hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring',
        selected && 'border-primary bg-primary/5',
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-medium">{template.name}</h4>
          <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
        </div>
        {template.isBuiltIn && <span className="text-xs bg-muted px-2 py-0.5 rounded">Built-in</span>}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Root: {template.structure.kind}
        {template.structure.children && template.structure.children.length > 0 && <span> • {template.structure.children.length} children</span>}
      </div>
    </button>
  );
}

export function TemplateSelector({ open, onSelect, onCancel, filterCategory }: TemplateSelectorProps) {
  const { templates, getTemplatesByCategory } = useTemplates();
  const [selectedTemplate, setSelectedTemplate] = React.useState<WorkItemTemplate | null>(null);
  const [activeCategory, setActiveCategory] = React.useState<TemplateCategory>(filterCategory || 'sprint');

  const displayedTemplates = React.useMemo(() => {
    if (filterCategory) {
      return getTemplatesByCategory(filterCategory);
    }
    return getTemplatesByCategory(activeCategory);
  }, [filterCategory, activeCategory, getTemplatesByCategory]);

  const handleSelect = () => {
    if (selectedTemplate) {
      onSelect(selectedTemplate);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a Template</DialogTitle>
          <DialogDescription>Select a template to create a new item with pre-defined structure.</DialogDescription>
        </DialogHeader>

        {!filterCategory && (
          <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as TemplateCategory)}>
            <TabsList className="grid grid-cols-5 w-full">
              {CATEGORIES.map((cat) => (
                <TabsTrigger key={cat.value} value={cat.value}>
                  {cat.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        <ScrollArea className="h-[300px] pr-4">
          <div className="space-y-2">
            {displayedTemplates.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No templates in this category</p>
            ) : (
              displayedTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  selected={selectedTemplate?.id === template.id}
                  onSelect={() => setSelectedTemplate(template)}
                />
              ))
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={!selectedTemplate}>
            Use Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
