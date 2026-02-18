import * as React from 'react';
import { FileText, Folder, Target, Layers, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import type { MemoryItem } from './types';

function getLinkedItemIcon(kind: MemoryItem['linked_item_kind']) {
  switch (kind) {
    case 'project':
      return <Folder className="size-3" />;
    case 'initiative':
      return <Target className="size-3" />;
    case 'epic':
      return <Layers className="size-3" />;
    case 'issue':
      return <FileText className="size-3" />;
    default:
      return null;
  }
}

export interface MemoryCardProps {
  memory: MemoryItem;
  onClick?: (memory: MemoryItem) => void;
  onEdit?: (memory: MemoryItem) => void;
  onDelete?: (memory: MemoryItem) => void;
  className?: string;
}

export function MemoryCard({ memory, onClick, onEdit, onDelete, className }: MemoryCardProps) {
  const preview = memory.content.slice(0, 150) + (memory.content.length > 150 ? '...' : '');

  return (
    <div
      data-testid="memory-card"
      className={cn('group relative rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50', onClick && 'cursor-pointer', className)}
      onClick={() => onClick?.(memory)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium leading-tight">{memory.title}</h3>

        {(onEdit || onDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(memory);
                  }}
                >
                  <Pencil className="mr-2 size-4" />
                  Edit
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(memory);
                  }}
                >
                  <Trash2 className="mr-2 size-4" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Preview */}
      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{preview}</p>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {memory.linked_item_kind && memory.linked_item_title && (
            <span className="flex items-center gap-1">
              {getLinkedItemIcon(memory.linked_item_kind)}
              <span className="truncate max-w-[120px]">{memory.linked_item_title}</span>
            </span>
          )}
        </div>

        <span>{memory.updated_at.toLocaleDateString()}</span>
      </div>

      {/* Tags */}
      {memory.tags && memory.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {memory.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
