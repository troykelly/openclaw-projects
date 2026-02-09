/**
 * Individual dependency item display
 * Issue #390: Implement dependency creation UI
 */
import * as React from 'react';
import { ArrowLeft, ArrowRight, Folder, Target, Layers, FileText, X } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import type { WorkItemKind, WorkItemStatus } from '@/ui/components/detail/types';
import type { DependencyDirection, DependencyType } from './types';
import { getDependencyTypeLabel } from './dependency-utils';

export interface DependencyItemProps {
  id: string;
  title: string;
  kind: WorkItemKind;
  status: WorkItemStatus;
  direction: DependencyDirection;
  type?: DependencyType;
  onClick?: () => void;
  onRemove?: (id: string) => void;
  className?: string;
}

function getKindIcon(kind: WorkItemKind) {
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
  return status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function DependencyItem({ id, title, kind, status, direction, type, onClick, onRemove, className }: DependencyItemProps) {
  const isSatisfied = direction === 'blocked_by' && status === 'done';
  const DirectionIcon = direction === 'blocks' ? ArrowRight : ArrowLeft;

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.(id);
  };

  return (
    <div
      data-testid="dependency-item"
      data-satisfied={isSatisfied}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5',
        'hover:bg-muted/50 transition-colors',
        onClick && 'cursor-pointer',
        isSatisfied && 'opacity-60',
        className,
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`${title} - ${direction === 'blocks' ? 'blocks' : 'blocked by'}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      {/* Direction indicator */}
      <span data-testid="direction-indicator" className={cn('text-muted-foreground', direction === 'blocks' ? 'text-amber-500' : 'text-blue-500')}>
        <DirectionIcon className="size-4" />
      </span>

      {/* Kind icon */}
      <span data-testid="kind-icon" className="text-muted-foreground">
        {getKindIcon(kind)}
      </span>

      {/* Title */}
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>

      {/* Dependency type */}
      {type && <span className="text-xs text-muted-foreground shrink-0">{getDependencyTypeLabel(type)}</span>}

      {/* Status badge */}
      <Badge variant={getStatusVariant(status)} className="shrink-0 text-xs">
        {getStatusLabel(status)}
      </Badge>

      {/* Remove button */}
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={handleRemove}
          aria-label="Remove dependency"
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}
