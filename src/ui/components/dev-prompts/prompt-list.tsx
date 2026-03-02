/**
 * List of dev prompts with filtering by category, system/user, and search.
 * Issue #2016.
 */
import { useDevPrompts, useDeleteDevPrompt } from '@/ui/hooks/queries/use-dev-prompts';
import { PromptCard } from './prompt-card';
import type { DevPrompt } from '@/ui/lib/api-types';

export interface PromptListProps {
  categoryFilter?: string;
  systemFilter?: boolean;
  searchQuery?: string;
  onEdit?: (prompt: DevPrompt) => void;
}

export function PromptList({ categoryFilter, systemFilter, searchQuery, onEdit }: PromptListProps) {
  const { data, isLoading } = useDevPrompts({
    category: categoryFilter,
    is_system: systemFilter,
    search: searchQuery,
  });
  const deleteMutation = useDeleteDevPrompt();

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading prompts...</div>;
  }

  const items = Array.isArray(data?.items) ? data.items : [];

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No dev prompts found.</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((prompt) => (
        <PromptCard
          key={prompt.id}
          prompt={prompt}
          onEdit={onEdit}
          onDelete={(id) => deleteMutation.mutate(id)}
        />
      ))}
    </div>
  );
}
