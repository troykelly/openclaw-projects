import * as React from 'react';
import { FileText, Folder, Target, Layers, MoreVertical, Pencil, Trash2, Pin } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { MemoryTtlBadge } from './memory-ttl-badge';
import type { MemoryItem } from './types';
import { formatDate } from '@/ui/lib/date-format';

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

/** Max tags shown inline before showing "+N more" */
const MAX_VISIBLE_TAGS = 3;

/** Determine special tag styling based on tag prefix/value */
function getTagClassName(tag: string): string {
  if (tag.startsWith('day-memory:')) {
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
  }
  if (tag.startsWith('week-memory:')) {
    return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400';
  }
  if (tag === 'ephemeral') {
    return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
  }
  return '';
}

export interface MemoryCardProps {
  memory: MemoryItem;
  onClick?: (memory: MemoryItem) => void;
  onEdit?: (memory: MemoryItem) => void;
  onDelete?: (memory: MemoryItem) => void;
  onSupersededClick?: (targetId: string) => void;
  className?: string;
}

export function MemoryCard({ memory, onClick, onEdit, onDelete, onSupersededClick, className }: MemoryCardProps) {
  const preview = memory.content.slice(0, 150) + (memory.content.length > 150 ? '...' : '');
  const isSuperseded = !!memory.superseded_by;
  const isEphemeral = !!memory.expires_at;

  return (
    <div
      data-testid="memory-card"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        'group relative rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50',
        onClick && 'cursor-pointer',
        isSuperseded && 'opacity-60',
        isEphemeral && 'border-dashed',
        className,
      )}
      onClick={() => onClick?.(memory)}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick(memory);
        }
      }}
    >
      {/* Pinned indicator */}
      {memory.pinned && (
        <div
          className="absolute right-2 top-2 text-muted-foreground"
          aria-label="Memory is pinned"
        >
          <Pin className="size-4" />
        </div>
      )}

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

      {/* Lifecycle indicators */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {memory.expires_at && (
          <MemoryTtlBadge expiresAt={memory.expires_at} />
        )}

        {isSuperseded && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Memory is superseded"
            onClick={(e) => {
              e.stopPropagation();
              onSupersededClick?.(memory.superseded_by!);
            }}
          >
            Superseded
          </button>
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

        <span>{formatDate(new Date(memory.updated_at))}</span>
      </div>

      {/* Tags */}
      {memory.tags && memory.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {memory.tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
            <Badge key={tag} variant="secondary" className={cn('text-xs', getTagClassName(tag))}>
              {tag}
            </Badge>
          ))}
          {memory.tags.length > MAX_VISIBLE_TAGS && (
            <Badge variant="secondary" className="text-xs text-muted-foreground">
              +{memory.tags.length - MAX_VISIBLE_TAGS} more
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
