import * as React from 'react';
import { useState } from 'react';
import {
  Folder,
  Target,
  Layers,
  FileText,
  ChevronRight,
  Pencil,
  Check,
  X,
  Trash2,
} from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import type { WorkItemKind, WorkItemStatus } from './types';

function getKindIcon(kind: WorkItemKind) {
  switch (kind) {
    case 'project':
      return <Folder className="size-5" />;
    case 'initiative':
      return <Target className="size-5" />;
    case 'epic':
      return <Layers className="size-5" />;
    case 'issue':
      return <FileText className="size-5" />;
  }
}

function getKindLabel(kind: WorkItemKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function getStatusVariant(status: WorkItemStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'in_progress':
      return 'default';
    case 'done':
      return 'secondary';
    case 'blocked':
      return 'destructive';
    default:
      return 'outline';
  }
}

function getStatusLabel(status: WorkItemStatus): string {
  return status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export interface ItemHeaderProps {
  title: string;
  kind: WorkItemKind;
  status: WorkItemStatus;
  parentTitle?: string;
  onTitleChange?: (title: string) => void;
  onParentClick?: () => void;
  onDelete?: () => void;
  className?: string;
}

export function ItemHeader({
  title,
  kind,
  status,
  parentTitle,
  onTitleChange,
  onParentClick,
  onDelete,
  className,
}: ItemHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);

  const handleStartEdit = () => {
    setEditValue(title);
    setIsEditing(true);
  };

  const handleSave = () => {
    if (editValue.trim() && editValue !== title) {
      onTitleChange?.(editValue.trim());
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(title);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      {/* Breadcrumb */}
      {parentTitle && (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <button
            className="hover:text-foreground hover:underline"
            onClick={onParentClick}
          >
            {parentTitle}
          </button>
          <ChevronRight className="size-4" />
        </div>
      )}

      {/* Title row */}
      <div className="flex items-start gap-3">
        <span className="mt-1 text-muted-foreground">{getKindIcon(kind)}</span>

        <div className="min-w-0 flex-1 space-y-2">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                className="text-xl font-semibold"
              />
              <Button variant="ghost" size="icon" onClick={handleSave}>
                <Check className="size-4" />
                <span className="sr-only">Save</span>
              </Button>
              <Button variant="ghost" size="icon" onClick={handleCancel}>
                <X className="size-4" />
                <span className="sr-only">Cancel</span>
              </Button>
            </div>
          ) : (
            <div className="group flex items-start gap-2">
              <h1 className="text-xl font-semibold">{title}</h1>
              {onTitleChange && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-0.5 size-6 opacity-0 group-hover:opacity-100"
                  onClick={handleStartEdit}
                >
                  <Pencil className="size-3" />
                  <span className="sr-only">Edit title</span>
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-0.5 size-6 opacity-0 text-destructive hover:text-destructive group-hover:opacity-100"
                  onClick={onDelete}
                >
                  <Trash2 className="size-3" />
                  <span className="sr-only">Delete</span>
                </Button>
              )}
            </div>
          )}

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{getKindLabel(kind)}</Badge>
            <Badge variant={getStatusVariant(status)}>{getStatusLabel(status)}</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
