/**
 * Template manager component for viewing, editing, and deleting templates
 */
import * as React from 'react';
import { TrashIcon, SearchIcon } from 'lucide-react';
import { Input } from '@/ui/components/ui/input';
import { Button } from '@/ui/components/ui/button';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import { useTemplates } from './use-templates';
import type { WorkItemTemplate, TemplateCategory } from './types';

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  sprint: 'Sprint',
  feature: 'Feature',
  bugfix: 'Bug Fix',
  project: 'Project',
  custom: 'Custom',
};

interface TemplateManagerProps {
  className?: string;
}

export function TemplateManager({ className }: TemplateManagerProps) {
  const { templates, deleteTemplate } = useTemplates();
  const [search, setSearch] = React.useState('');
  const [selectedCategory, setSelectedCategory] =
    React.useState<TemplateCategory | 'all'>('all');

  const filteredTemplates = React.useMemo(() => {
    let result = templates;

    if (selectedCategory !== 'all') {
      result = result.filter((t) => t.category === selectedCategory);
    }

    if (search.trim()) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(searchLower) ||
          t.description.toLowerCase().includes(searchLower)
      );
    }

    return result;
  }, [templates, selectedCategory, search]);

  const handleDelete = (template: WorkItemTemplate) => {
    if (template.isBuiltIn) return;
    if (
      window.confirm(`Delete template "${template.name}"? This cannot be undone.`)
    ) {
      deleteTemplate(template.id);
    }
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center gap-4 p-4 border-b">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) =>
            setSelectedCategory(e.target.value as TemplateCategory | 'all')
          }
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Filter by category"
        >
          <option value="all">All Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {filteredTemplates.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No templates found
            </p>
          ) : (
            filteredTemplates.map((template) => (
              <div
                key={template.id}
                data-template={template.id}
                className="p-4 rounded-lg border bg-card"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{template.name}</h4>
                      <span className="text-xs bg-muted px-2 py-0.5 rounded">
                        {CATEGORY_LABELS[template.category]}
                      </span>
                      {template.isBuiltIn && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                          Built-in
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {template.description}
                    </p>
                  </div>
                  {!template.isBuiltIn && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(template)}
                      aria-label="Delete template"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  <span>Root: {template.structure.kind}</span>
                  {template.structure.children &&
                    template.structure.children.length > 0 && (
                      <span className="ml-2">
                        • {countTotalItems(template.structure)} items total
                      </span>
                    )}
                  {template.structure.todos &&
                    template.structure.todos.length > 0 && (
                      <span className="ml-2">
                        • {template.structure.todos.length} todos
                      </span>
                    )}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function countTotalItems(
  structure: WorkItemTemplate['structure'],
  count = 1
): number {
  if (structure.children) {
    for (const child of structure.children) {
      count = countTotalItems(child, count + 1);
    }
  }
  return count;
}
