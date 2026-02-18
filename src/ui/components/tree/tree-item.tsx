import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, Folder, Target, Layers, FileText, MoreHorizontal, Plus, Pencil, Trash2, GripVertical, FolderInput } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import type { TreeItem, TreeItemKind, TreeItemStatus } from './types';
import { InlineEditableText } from '@/ui/components/inline-edit';

function getKindIcon(kind: TreeItemKind) {
  switch (kind) {
    case 'project':
      return <Folder className="size-4" />;
    case 'initiative':
      return <Target className="size-4" />;
    case 'epic':
      return <Layers className="size-4" />;
    case 'issue':
      return <FileText className="size-4" />;
  }
}

function getStatusColor(status: TreeItemStatus): string {
  switch (status) {
    case 'not_started':
      return 'bg-muted-foreground/30';
    case 'in_progress':
      return 'bg-blue-500';
    case 'blocked':
      return 'bg-red-500';
    case 'done':
      return 'bg-green-500';
    case 'cancelled':
      return 'bg-muted-foreground';
  }
}

function getChildKind(kind: TreeItemKind): TreeItemKind | null {
  switch (kind) {
    case 'project':
      return 'initiative';
    case 'initiative':
      return 'epic';
    case 'epic':
      return 'issue';
    case 'issue':
      return null;
  }
}

export interface TreeItemRowProps {
  item: TreeItem;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onAddChild?: (parent_id: string, kind: TreeItemKind) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Called when user requests to move the item via "Move to..." menu */
  onMoveRequest?: (item: TreeItem) => void;
  /** Called when title is changed via inline edit */
  onTitleChange?: (id: string, newTitle: string) => void;
}

export function TreeItemRow({
  item,
  depth,
  isExpanded,
  isSelected,
  onToggleExpand,
  onSelect,
  onAddChild,
  onEdit,
  onDelete,
  onMoveRequest,
  onTitleChange,
}: TreeItemRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: {
      item_id: item.id,
      kind: item.kind,
      parent_id: item.parent_id,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const hasChildren = (item.children && item.children.length > 0) || (item.childCount && item.childCount > 0);
  const childKind = getChildKind(item.kind);
  const canAddChild = childKind !== null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSelect(item.id);
        break;
      case 'ArrowRight':
        if (hasChildren && !isExpanded) {
          e.preventDefault();
          onToggleExpand(item.id);
        }
        break;
      case 'ArrowLeft':
        if (isExpanded) {
          e.preventDefault();
          onToggleExpand(item.id);
        }
        break;
    }
  };

  const combinedStyle = {
    paddingLeft: `${depth * 16 + 8}px`,
    ...style,
  };

  return (
    <div
      ref={setNodeRef}
      data-testid="tree-item"
      className={cn(
        'group flex items-center gap-1 rounded-md px-2 py-1.5 outline-none transition-colors',
        'hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring',
        isSelected && 'bg-muted',
        isDragging && 'opacity-50',
      )}
      style={combinedStyle}
      tabIndex={0}
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={isSelected}
      onClick={() => onSelect(item.id)}
      onKeyDown={handleKeyDown}
    >
      {/* Drag handle */}
      <div {...attributes} {...listeners} className="cursor-grab opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Drag to reorder">
        <GripVertical className="size-4 text-muted-foreground" />
      </div>

      {/* Expand/collapse button */}
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggleExpand(item.id);
        }}
        disabled={!hasChildren}
        aria-label={isExpanded ? 'Collapse' : 'Expand'}
      >
        <ChevronRight className={cn('size-4 transition-transform', isExpanded && 'rotate-90', !hasChildren && 'invisible')} />
      </Button>

      {/* Status indicator */}
      <div className={cn('size-2 shrink-0 rounded-full', getStatusColor(item.status))} title={item.status.replace('_', ' ')} />

      {/* Kind icon */}
      <span className="shrink-0 text-muted-foreground">{getKindIcon(item.kind)}</span>

      {/* Title */}
      {onTitleChange ? (
        <InlineEditableText
          value={item.title}
          onSave={(newTitle) => onTitleChange(item.id, newTitle)}
          doubleClick
          selectOnFocus
          className="min-w-0 flex-1 truncate text-sm"
          validate={(v) => v.trim().length > 0}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
      )}

      {/* Child count badge */}
      {hasChildren && (
        <Badge variant="secondary" className="shrink-0 px-1.5 text-xs">
          {item.children?.length ?? item.childCount}
        </Badge>
      )}

      {/* Quick actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canAddChild && onAddChild && (
            <DropdownMenuItem onClick={() => onAddChild(item.id, childKind)}>
              <Plus className="mr-2 size-4" />
              Add {childKind}
            </DropdownMenuItem>
          )}
          {onEdit && (
            <DropdownMenuItem onClick={() => onEdit(item.id)}>
              <Pencil className="mr-2 size-4" />
              Edit
            </DropdownMenuItem>
          )}
          {onMoveRequest && item.kind !== 'project' && (
            <DropdownMenuItem onClick={() => onMoveRequest(item)}>
              <FolderInput className="mr-2 size-4" />
              Move to...
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem onClick={() => onDelete(item.id)} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 size-4" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
