/**
 * Card displaying a dev prompt's key info, badges, and actions.
 * Issue #2016.
 */
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu';
import { MoreHorizontal, Pencil } from 'lucide-react';
import type { DevPrompt } from '@/ui/lib/api-types';

export interface PromptCardProps {
  prompt: DevPrompt;
  onEdit?: (prompt: DevPrompt) => void;
  onDelete?: (id: string) => void;
}

export function PromptCard({ prompt, onEdit, onDelete }: PromptCardProps) {
  return (
    <div className="rounded-md border p-4 text-sm hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between">
        <div
          className="flex-1 cursor-pointer"
          onClick={() => onEdit?.(prompt)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onEdit?.(prompt);
          }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{prompt.title}</span>
            <Badge variant="outline">{prompt.category}</Badge>
            {prompt.is_system && <Badge variant="secondary">system</Badge>}
            {!prompt.is_active && <Badge variant="destructive">inactive</Badge>}
          </div>
          {prompt.description && (
            <p className="mt-1 text-xs text-muted-foreground">{prompt.description}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground font-mono">{prompt.prompt_key}</p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-testid={`prompt-card-menu-${prompt.id}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit?.(prompt)}>
              <Pencil className="mr-2 h-3 w-3" />
              Edit
            </DropdownMenuItem>
            {!prompt.is_system && onDelete && (
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete(prompt.id)}
              >
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
