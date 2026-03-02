/**
 * Dev Prompts management page.
 *
 * Displays a filterable list of dev prompt templates with category,
 * system/user, and search filtering. Supports creating, editing,
 * and previewing Handlebars templates.
 *
 * @see Issue #2016
 */
import React, { useState } from 'react';
import { FileCode2, Plus } from 'lucide-react';
import { PromptList } from '@/ui/components/dev-prompts/prompt-list';
import { PromptEditor } from '@/ui/components/dev-prompts/prompt-editor';
import { CreatePromptDialog } from '@/ui/components/dev-prompts/create-prompt-dialog';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent } from '@/ui/components/ui/card';
import { Input } from '@/ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import type { DevPrompt } from '@/ui/lib/api-types';

const ALL_CATEGORIES = 'all';

const CATEGORY_OPTIONS = [
  { value: ALL_CATEGORIES, label: 'All categories' },
  { value: 'identification', label: 'Identification' },
  { value: 'creation', label: 'Creation' },
  { value: 'triage', label: 'Triage' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'general', label: 'General' },
  { value: 'custom', label: 'Custom' },
] as const;

export function DevPromptsPage(): React.JSX.Element {
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES);
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<DevPrompt | null>(null);

  if (editingPrompt) {
    return (
      <div data-testid="page-dev-prompts" className="h-full flex flex-col p-6">
        <PromptEditor
          prompt={editingPrompt}
          onClose={() => setEditingPrompt(null)}
        />
      </div>
    );
  }

  return (
    <div data-testid="page-dev-prompts" className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileCode2 className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Dev Prompts</h1>
            <p className="text-sm text-muted-foreground">
              Manage Handlebars prompt templates for agent workflows
            </p>
          </div>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          data-testid="create-prompt-button"
        >
          <Plus className="mr-2 size-4" />
          New Prompt
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]" data-testid="category-filter">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Search prompts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {/* Prompt list */}
      <Card className="flex-1">
        <CardContent className="p-6">
          <PromptList
            categoryFilter={categoryFilter === ALL_CATEGORIES ? undefined : categoryFilter}
            searchQuery={searchQuery || undefined}
            onEdit={setEditingPrompt}
          />
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <CreatePromptDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
